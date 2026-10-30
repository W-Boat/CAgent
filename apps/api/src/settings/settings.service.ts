import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"
import { AuditService } from "../common/services/audit.service"
import { SETTING_DEFS, SETTING_MAP } from "./setting-defs"

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /** 返回按分组组织的设置项（含当前值与元信息） */
  /**
   * 分组设置（后台表单据此渲染）。
   *
   * @param grantedPermissions 调用者权限：superAdminOnly 的项对
   *   非超管**不返回**，而不是返回一个改不动的开关 ——
   *   看得见却存不下，比看不见更让人困惑。
   */
  async grouped(grantedPermissions: string[] = [], roles: string[] = []) {
    const granted = new Set(grantedPermissions)
    const isSuper = roles.includes('super_admin') || granted.has("*") || granted.has("feature:toggle")
    const rows = await this.prisma.setting.findMany()
    const rowMap = new Map(rows.map((r) => [r.key, r]))

    const result: Record<
      string,
      {
        key: string
        label: string
        description?: string
        type: string
        options?: { label: string; value: unknown }[]
        value: unknown
        updatedAt?: Date
      }[]
    > = {}

    for (const def of SETTING_DEFS) {
      // 超管专属项对非超管不出现（见方法注释）
      if (def.superAdminOnly && !isSuper) continue
      const row = rowMap.get(def.key)
      const item = {
        key: def.key,
        label: def.label,
        description: def.description,
        type: def.type,
        options: def.options,
        value: row ? (row.value as unknown) : def.defaultValue,
        updatedAt: row?.updatedAt
      }
      if (!result[def.group]) result[def.group] = []
      result[def.group].push(item)
    }

    return result
  }

  /** 扁平键值，供前端一次性读取 */
  async all(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.setting.findMany()
    const valueMap = new Map(rows.map((r) => [r.key, r.value as unknown]))
    const result: Record<string, unknown> = {}
    for (const def of SETTING_DEFS) {
      result[def.key] = valueMap.has(def.key)
        ? valueMap.get(def.key)
        : def.defaultValue
    }
    return result
  }

  async get<T = unknown>(key: string, fallback?: T): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } })
    if (row) return row.value as T
    const def = SETTING_MAP.get(key)
    if (def) return def.defaultValue as T
    if (fallback !== undefined) return fallback
    return undefined as unknown as T
  }

  /**
   * 批量更新，键必须是已登记的设置项。
   *
   * @param grantedPermissions 调用者的权限码。用于拦截 superAdminOnly
   *   的设置项—— 这类开关只有超管能改。
   */
  async updateMany(
    payload: Record<string, unknown>,
    operator?: { id: string; email: string; permissions?: string[]; roles?: string[] }
  ) {
    const unknownKeys = Object.keys(payload).filter(
      (k) => !SETTING_MAP.has(k)
    )
    if (unknownKeys.length > 0) {
      throw new BadRequestException(
        `未识别的设置项：${unknownKeys.join(", ")}`
      )
    }

    /*
     * 超管专属开关的写入拦截。
     *
     * 放在这里而不是加 @RequirePermissions：那会让「保存整张设置表单」
     * 在普通管理员手里整体 403，连改站点名称都做不了。
     * 这里只针对**被改到的那几个 key** 判权限，其余照常。
     */
    const granted = new Set(operator?.permissions ?? [])
    const isSuper = operator?.roles?.includes('super_admin') || granted.has("*") || granted.has("feature:toggle")
    if (!isSuper) {
      const blocked = Object.keys(payload).filter(
        (k) => SETTING_MAP.get(k)?.superAdminOnly
      )
      if (blocked.length > 0) {
        throw new ForbiddenException(
          `以下设置仅超级管理员可修改：${blocked
            .map((k) => SETTING_MAP.get(k)?.label ?? k)
            .join("、")}`
        )
      }
    }

    // Validate the whole request before committing any settings.
    for (const [key,value] of Object.entries(payload)) {
      const def=SETTING_MAP.get(key)!
      this.validate(def.type,key,value)
      if(key==='web_search_count'&&(!Number.isInteger(value)||Number(value)<1||Number(value)>8))throw new BadRequestException('搜索结果数量须为1–8的整数')
      if(key==='knowledge_retrieval_depth'&&(!Number.isInteger(value)||Number(value)<1||Number(value)>8))throw new BadRequestException('知识库检索深度须为 1–8 的整数')
      if(key==='answer_cache_days'&&(!Number.isInteger(value)||Number(value)<1||Number(value)>30))throw new BadRequestException('回答缓存保留天数须为 1–30 的整数')
      if(def.options?.length&&!def.options.some(option=>option.value===value))throw new BadRequestException(`设置项 ${def.label} 的选项无效`)
      if(key==='default_accent_color'&&value!==''&&!/^#[0-9a-fA-F]{6}$/.test(value as string))throw new BadRequestException('主题色需要六位十六进制色值，如 #4f46e5')
      if(key==='student_logo_url'&&value){const logo=value as string;let valid=logo.startsWith('/')&&!logo.startsWith('//')&&!logo.includes('\\');try{const url=new URL(logo);valid=url.protocol==='https:'&&!url.username&&!url.password}catch{};if(!valid||logo.length>2048)throw new BadRequestException('Logo 需要 HTTPS 图片地址或站内相对路径')}
      const limits:Record<string,number>={student_brand_subtitle:60,student_welcome_title:80,student_welcome_description:500,student_input_placeholder:160,student_footer_text:300}
      if(limits[key]&&(value as string).length>limits[key])throw new BadRequestException(`设置项 ${def.label} 最多 ${limits[key]} 字`)
      if(key==='student_recommended_questions'&&(!Array.isArray(value)||value.length>12||value.some(item=>typeof item!=='string'||!item.trim()||item.length>120)))throw new BadRequestException('推荐问题最多 12 条，每条需为 1–120 字文本')
    }
    await this.prisma.$transaction(Object.entries(payload).map(([key,value])=>{
      const def=SETTING_MAP.get(key)!
      return this.prisma.setting.upsert({where:{key},create:{key,value:value as any,group:def.group,description:def.description??null},update:{value:value as any}})
    }))

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "setting.update",
      resource: "setting",
      detail: payload as Record<string, unknown>
    })

    return this.all()
  }

  /** 补齐缺失的默认设置（seed / 升级时调用） */
  async ensureDefaults() {
    const existing = await this.prisma.setting.findMany({
      select: { key: true }
    })
    const existingKeys = new Set(existing.map((r) => r.key))
    const missing = SETTING_DEFS.filter((d) => !existingKeys.has(d.key))

    if (missing.length > 0) {
      await this.prisma.setting.createMany({
        data: missing.map((d) => ({
          key: d.key,
          value: d.defaultValue as any,
          group: d.group,
          description: d.description ?? null
        })),
        skipDuplicates: true
      })
    }
    return { added: missing.length }
  }

  private validate(type: string, key: string, value: unknown) {
    switch (type) {
      case "boolean":
        if (typeof value !== "boolean") {
          throw new BadRequestException(`设置项 ${key} 需要布尔值`)
        }
        break
      case "number":
        if (typeof value !== "number" || Number.isNaN(value)) {
          throw new BadRequestException(`设置项 ${key} 需要数字`)
        }
        break
      case "string":
      case "text":
        if (typeof value !== "string") {
          throw new BadRequestException(`设置项 ${key} 需要字符串`)
        }
        break
      case "json":
        if (value !== null && typeof value !== "object") {
          throw new BadRequestException(`设置项 ${key} 需要 JSON 对象或数组`)
        }
        break
    }
  }
}
