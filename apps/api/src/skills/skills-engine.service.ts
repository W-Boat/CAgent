import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common"
import { Prisma } from "@prisma/client"
import {visibleCapabilityWhere,isRetiredCapability,assertVisibleCapability} from '../common/retired-capabilities'
import { PrismaService } from "../prisma/prisma.service"
import { AuditService } from "../common/services/audit.service"
import { QuotaService } from "../common/services/quota.service"
import { BrowserEngineService } from "../browser/browser-engine.service"
import { LlmFactory } from "../chat/llm/llm.factory"
import { ProvidersService } from "../providers/providers.service"
import { CampusGuideService, type GuideMode } from "../campus/campus-guide.service"
import {sourcesFromEvidence,type KnowledgeSource} from '../campus/knowledge-evidence'
import { ToolRegistry } from "../tools/tool-registry"
import type { LlmToolDef } from "../chat/llm/types"
import { KNOWLEDGE_SKILL_COLLECTIONS, isKnowledgeSkill } from '../campus/knowledge-retriever'
import {abortScope,checkAbort} from '../common/abort'
import {parseToolArguments} from '../chat/runtime/tool-validation'
import {selectAutomaticTools} from '../chat/tool-selector'
import {
  CreateSkillDto,
  QuerySkillDto,
  QuerySkillRunDto,
  UpdateSkillDto
} from "./dto/skill.dto"

export interface SkillExecContext {
  userId: string
  conversationId?: string | null
  browserSessionId?: string | null
  input: Record<string, unknown>
  userPermissions?: string[]
  signal?: AbortSignal
  beforeKnowledgeRetrieval?: ()=>void
  onKnowledgeEvidence?: (sources:KnowledgeSource[])=>void
}

/**
 * 技能引擎。
 *
 * 四类技能：
 *   PROMPT  — 只是一段提示词，注入系统消息
 *   TOOL    — 函数调用，由模型在对话中触发，走内置工具或 HTTP
 *   HTTP    — 直接请求外部接口，无需模型
 *   BROWSER — 驱动浏览器完成网页操作
 */
@Injectable()
export class SkillsEngineService {
  private readonly logger = new Logger(SkillsEngineService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
    private readonly browser: BrowserEngineService,
    private readonly llmFactory: LlmFactory,
    private readonly providers: ProvidersService,
    private readonly campusGuide: CampusGuideService
  ) {}

  // ---------- CRUD ----------

  async list(query: QuerySkillDto = {}) {
    const where: Prisma.SkillWhereInput = {...visibleCapabilityWhere}
    if (query.keyword) {
      where.OR = [
        { key: { contains: query.keyword, mode: "insensitive" } },
        { name: { contains: query.keyword, mode: "insensitive" } },
        { description: { contains: query.keyword, mode: "insensitive" } }
      ]
    }
    if (query.category) where.category = query.category
    if (query.type) where.type = query.type
    if (query.enabled === "true") where.enabled = true
    if (query.enabled === "false") where.enabled = false

    const skills = await this.prisma.skill.findMany({
      where,
      orderBy: [{ sort: "asc" }, { createdAt: "desc" }],
      include: { _count: { select: { runs: true, agents: true } } }
    })

    return skills.filter(s=>!isRetiredCapability(s)).map((s) => ({
      ...s,
      runCount: s._count.runs,
      agentCount: s._count.agents
    }))
  }

  /** 对话界面可用的技能（启用中的） */
  async available(userPermissions: string[]) {
    const skills = await this.prisma.skill.findMany({
      where: { ...visibleCapabilityWhere,enabled: true },
      orderBy: [{ sort: "asc" }, { name: "asc" }]
    })
    const isAdmin = userPermissions.includes("*")
    return skills.filter(s=>!isRetiredCapability(s)&&s.type!=="BROWSER"&&!isKnowledgeSkill(s)&&!["web_summary","web_qa"].includes((s.config as any)?.builtin))
      .filter(
        (s) =>
          isAdmin ||
          !s.permissionCode ||
          userPermissions.includes(s.permissionCode)
      )
      .map((s) => ({
        id: s.id,
        key: s.key,
        name: s.name,
        description: s.description,
        type: s.type,
        category: s.category,
        icon: s.icon,
        inputSchema: s.inputSchema
      }))
  }

  async detail(id: string) {
    const skill = await this.prisma.skill.findUnique({
      where: { id },
      include: {
        agents: { include: { agent: { select: { id: true, name: true } } } },
        _count: { select: { runs: true } }
      }
    })
    if (!skill) throw new NotFoundException("技能不存在")
    assertVisibleCapability(skill)
    return {
      ...skill,
      agents: skill.agents.map((a) => a.agent).filter(a=>!isRetiredCapability(a)),
      runCount: skill._count.runs
    }
  }

  async findByKey(key: string) {
    assertVisibleCapability({key})
    const skill = await this.prisma.skill.findUnique({ where: { key } })
    if (!skill) throw new NotFoundException(`技能「${key}」不存在`)
    assertVisibleCapability(skill)
    return skill
  }

  async create(dto: CreateSkillDto, operator?: { id: string; email: string }) {
    assertVisibleCapability(dto)
    const key = dto.key.trim()
    if(dto.agentIds?.length&&await this.prisma.agent.count({where:{...visibleCapabilityWhere,id:{in:dto.agentIds}}})!==new Set(dto.agentIds).size)throw new BadRequestException('存在已下线或无效的智能体')
    const exists = await this.prisma.skill.findUnique({ where: { key } })
    if (exists) throw new BadRequestException("该技能标识已存在")

    const skill = await this.prisma.skill.create({
      data: {
        key,
        name: dto.name,
        description: dto.description,
        type: dto.type ?? "TOOL",
        category: dto.category ?? "通用",
        icon: dto.icon ?? null,
        enabled: dto.enabled ?? true,
        sort: dto.sort ?? 0,
        systemPrompt: dto.systemPrompt ?? null,
        inputSchema: (dto.inputSchema ?? undefined) as any,
        config: (dto.config ?? undefined) as any,
        permissionCode: dto.permissionCode ?? null,
        note: dto.note ?? null,
        createdById: operator?.id ?? null
      }
    })

    if (dto.agentIds && dto.agentIds.length > 0) {
      await this.prisma.agentSkill.createMany({
        data: dto.agentIds.map((agentId) => ({ agentId, skillId: skill.id })),
        skipDuplicates: true
      })
    }

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "skill.create",
      resource: "skill",
      resourceId: skill.id,
      detail: { key, type: skill.type }
    })
    return skill
  }

  async update(
    id: string,
    dto: UpdateSkillDto,
    operator?: { id: string; email: string }
  ) {
    const skill = await this.prisma.skill.findUnique({ where: { id } })
    if (!skill) throw new NotFoundException("技能不存在")
    assertVisibleCapability(skill)
    assertVisibleCapability({...skill,...dto})

    const updated = await this.prisma.skill.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        category: dto.category,
        icon: dto.icon,
        enabled: dto.enabled,
        sort: dto.sort,
        systemPrompt: dto.systemPrompt,
        inputSchema:
          dto.inputSchema === undefined ? undefined : (dto.inputSchema as any),
        config: dto.config === undefined ? undefined : (dto.config as any),
        permissionCode: dto.permissionCode,
        note: dto.note
      }
    })

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "skill.update",
      resource: "skill",
      resourceId: id,
      detail: { fields: Object.keys(dto) }
    })
    return updated
  }

  async remove(id: string, operator?: { id: string; email: string }) {
    const skill = await this.prisma.skill.findUnique({ where: { id } })
    if (!skill) throw new NotFoundException("技能不存在")
    assertVisibleCapability(skill)
    if (skill.isSystem) throw new BadRequestException("内置技能不可删除，可将其禁用")

    await this.prisma.skill.delete({ where: { id } })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "skill.delete",
      resource: "skill",
      resourceId: id,
      detail: { key: skill.key }
    })
    return { success: true }
  }

  async toggle(
    id: string,
    enabled: boolean,
    operator?: { id: string; email: string }
  ) {
    await this.detail(id)
    const skill = await this.prisma.skill.update({
      where: { id },
      data: { enabled }
    })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "skill.toggle",
      resource: "skill",
      resourceId: id,
      detail: { enabled }
    })
    return skill
  }

  async bindAgents(
    id: string,
    agentIds: string[],
    operator?: { id: string; email: string }
  ) {
    await this.detail(id)
    if(agentIds.length&&await this.prisma.agent.count({where:{...visibleCapabilityWhere,id:{in:agentIds}}})!==new Set(agentIds).size)throw new BadRequestException('存在已下线或无效的智能体')
    await this.prisma.agentSkill.deleteMany({ where: { skillId: id } })
    if (agentIds.length > 0) {
      await this.prisma.agentSkill.createMany({
        data: agentIds.map((agentId) => ({ agentId, skillId: id })),
        skipDuplicates: true
      })
    }
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "skill.bind_agents",
      resource: "skill",
      resourceId: id,
      detail: { agentIds }
    })
    return this.detail(id)
  }

  // ---------- 对话集成 ----------

  /** Compact workflow descriptions; full instructions are read only when needed. */
  async promptCatalog(skillIds:string[],permissions:string[],query:string){
    if(!skillIds.length)return []
    const skills=await this.prisma.skill.findMany({where:{OR:[{id:{in:skillIds}},{key:{in:skillIds}}],enabled:true,type:'PROMPT'},select:{id:true,key:true,name:true,description:true,permissionCode:true,systemPrompt:true,type:true,config:true}})
    return skills.filter(s=>!isRetiredCapability(s)&&!isKnowledgeSkill(s)&&s.systemPrompt&&(!s.permissionCode||permissions.includes('*')||permissions.includes(s.permissionCode)))
      .map(s=>({...s,score:selectAutomaticTools(query,[{name:s.key,description:s.name+' '+s.description,parameters:{}}],1).length}))
      .sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key)).slice(0,12)
      .map(({id,key,name,description,score})=>({id,key,name,description:description.slice(0,180),relevant:!!score}))
  }

  async readPromptSkill(key:string,allowedKeys:string[],permissions:string[],offset=0){
    if(!allowedKeys.includes(key))throw new BadRequestException('本轮未授权读取这个技能')
    const skill=await this.prisma.skill.findUnique({where:{key}})
    if(!skill||isRetiredCapability(skill)||!skill.enabled||skill.type!=='PROMPT'||isKnowledgeSkill(skill)||!skill.systemPrompt)throw new BadRequestException('技能指引不存在或已停用')
    if(skill.permissionCode&&!permissions.includes('*')&&!permissions.includes(skill.permissionCode))throw new BadRequestException('没有读取该技能的权限')
    const start=Math.max(0,Math.floor(offset)),text=skill.systemPrompt.slice(start,start+6000),next=start+text.length
    return `【技能指引：${skill.name}】\n${text}`+(next<skill.systemPrompt.length?`\n[尚有后续指引，使用 skill_read 的 offset=${next} 继续读取]`:'')
  }

  /** 把技能转成模型可调用的工具定义 */
  async buildToolDefs(
    skillIds: string[],
    userPermissions: string[]
  ): Promise<LlmToolDef[]> {
    if (skillIds.length === 0) return []
    const skills = await this.prisma.skill.findMany({
      where: { OR: [{id: {in:skillIds}}, {key: {in:skillIds}}], enabled: true, type: {in:['TOOL','HTTP']} }
    })
    const isAdmin = userPermissions.includes("*")
    return skills.filter(s=>!isRetiredCapability(s)&&s.type!=="BROWSER"&&!isKnowledgeSkill(s)&&!["web_summary","web_qa"].includes((s.config as any)?.builtin))
      .filter(
        (s) =>
          isAdmin || !s.permissionCode || userPermissions.includes(s.permissionCode)
      )
      .map((s) => ({
        name: s.key.replace(/[^a-zA-Z0-9_-]/g, "_"),
        knowledgeRetrieval:s.type==='TOOL'&&['campus_guide','knowledge_search'].includes((s.config as any)?.builtin),
        readOnly:s.type==='TOOL'&&ToolRegistry.get((s.config as any)?.builtin||s.key)?.readOnly===true,
        description: s.description,
        parameters: (s.inputSchema as Record<string, unknown>) || {
          type: "object",
          properties: {
            query: { type: "string", description: "调用该技能所需的输入" }
          },
          required: ["query"]
        }
      }))
  }

  /** 汇总选中的 PROMPT 型技能提示词 */
  async collectPromptFragments(
    skillIds: string[],
    userPermissions: string[],
    query?: string
  ): Promise<string[]> {
    if (skillIds.length === 0) return []
    /*
     * 入参同时兼容 id 与 key：不同前端的历史习惯不同 —— 学生端/卡片/技能预设
     * 发的是 key（如 ucass-kb-survival），管理端选择器发的是 id。
     * 曾按 id 单查导致学生侧勾选的技能静默不注入（"技能不可用"的根因）。
     * 同一字符串既是 id 又是 key 的概率为零（cuid vs 可读 key），OR 查询安全。
     */
    const skills = await this.prisma.skill.findMany({
      where: {
        OR: [{ id: { in: skillIds } }, { key: { in: skillIds } }],
        enabled: true,
        type: "PROMPT"
      }
    })
    const isAdmin = userPermissions.includes("*")
    const allowed = skills
      .filter(
        (s) =>
          !isRetiredCapability(s) && !isKnowledgeSkill(s) && s.enabled &&
          (isAdmin || !s.permissionCode || userPermissions.includes(s.permissionCode)) &&
          s.systemPrompt
      )
    return allowed.map(s=>`【技能：${s.name}】\n${s.systemPrompt}`)
  }

  /**
   * 供模型在对话中调用技能（按 key）。
   * 返回值会被序列化后回填为 tool 消息。
   */
  async invokeByKey(
    key: string,
    args: Record<string, unknown>,
    ctx: SkillExecContext
  ): Promise<string> {
    const skill = await this.prisma.skill.findFirst({
      where: {
        OR: [{ key }, { key: key.replace(/_/g, "-") }]
      }
    })
    assertVisibleCapability(skill)
    if (!skill) throw new BadRequestException("技能不存在")
    if (!skill.enabled) throw new BadRequestException(`技能「${skill.name}」已被禁用`)
    if (skill.permissionCode && !ctx.userPermissions?.includes('*') && !ctx.userPermissions?.includes(skill.permissionCode)) throw new BadRequestException('没有执行该技能的权限')
    if (isKnowledgeSkill(skill)) return "这项内容已迁移到知识库，请使用 knowledge_search 查询。"
    if (skill.type === "PROMPT") {
      return `技能「${skill.name}」是提示词型技能，无需调用，其指引已包含在系统提示中。`
    }

    const result = await this.run(skill.id, { ...ctx, input: args })
    if(!result.success)throw new BadRequestException(result.error||'技能执行失败')
    return this.stringifyOutput(result)
  }

  /**
   * 把技能输出转成给模型看的文本。
   *
   * 内置技能常常返回结构化对象（比如校园导览返回 { text, hits, meta }）。
   * 直接 String(obj) 会得到 "[object Object]"，模型等于什么都没拿到——
   * 这是「技能能跑但智能体答不出」的典型原因，所以这里显式做序列化。
   */
  private stringifyOutput(result: { success: boolean; output?: unknown; error?: string | null }): string {
    const { output } = result
    if (output == null) {
      return `技能执行${result.success ? "成功" : "失败"}：${result.error || "（无输出）"}`
    }
    if (typeof output === "string") return output
    if (typeof output === "number" || typeof output === "boolean") return String(output)

    // 结构化输出：优先挑出面向人的正文，再把其余字段作为附注附上
    if (typeof output === "object") {
      const obj = output as Record<string, unknown>
      const preferred = ["text", "answer", "content", "result", "summary", "message"]
        .map((k) => obj[k])
        .find((v) => typeof v === "string" && v.trim().length > 0) as string | undefined

      if (preferred) {
        if (Array.isArray(obj.hits)) return preferred
        const rest = Object.fromEntries(
          Object.entries(obj).filter(([k]) => !["text", "answer", "content", "result"].includes(k))
        )
        const note = Object.keys(rest).length ? `\n\n[结构化字段] ${JSON.stringify(rest)}` : ""
        return preferred + note
      }
    }

    try {
      return JSON.stringify(output)
    } catch {
      return String(output)
    }
  }

  // ---------- 执行 ----------

  async run(skillId: string, ctx: SkillExecContext) {
    checkAbort(ctx.signal)
    const skill = await this.prisma.skill.findUnique({ where: { id: skillId } })
    if (!skill) throw new NotFoundException("技能不存在")
    if (isKnowledgeSkill(skill)) throw new BadRequestException("该内容已迁移到知识库，请直接查询知识资料")
    assertVisibleCapability(skill)
    if (!skill.enabled) throw new BadRequestException("该技能已被禁用")
    if (skill.permissionCode && !ctx.userPermissions?.includes('*') && !ctx.userPermissions?.includes(skill.permissionCode)) throw new BadRequestException('没有执行该技能的权限')
    if(skill.inputSchema)parseToolArguments({name:skill.key,description:skill.description,parameters:skill.inputSchema as Record<string,unknown>},JSON.stringify(ctx.input))

    const run = await this.prisma.skillRun.create({
      data: {
        skillId,
        userId: ctx.userId,
        conversationId: ctx.conversationId ?? null,
        status: "RUNNING",
        input: ctx.input as any
      }
    })

    const started = Date.now()

    try {
      const output = await this.dispatch(skill, ctx, run.id)
      checkAbort(ctx.signal)
      const durationMs = Date.now() - started

      await this.prisma.skillRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCESS",
          output: typeof output === "string" ? output.slice(0, 20000) : JSON.stringify(output).slice(0, 20000),
          durationMs,
          finishedAt: new Date()
        }
      })

      return { runId: run.id, success: true, output, durationMs }
    } catch (err) {
      const message = (err as Error).message
      await this.prisma.skillRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          error: message,
          durationMs: Date.now() - started,
          finishedAt: new Date()
        }
      })
      return { runId: run.id, success: false, error: message, durationMs: Date.now() - started }
    }
  }

  private async dispatch(
    skill: { id: string; key: string; type: string; config: unknown; systemPrompt: string | null; name: string },
    ctx: SkillExecContext,
    runId: string
  ): Promise<unknown> {
    switch (skill.type) {
      case "HTTP":
        return this.runHttp(skill, ctx)
        case "BROWSER":
          throw new BadRequestException('浏览器目前仅开放个人课表读取，请使用 /timetable')
      case "PROMPT":
        return skill.systemPrompt ?? ""
      case "TOOL":
      default:
        return this.runTool(skill, ctx, runId)
    }
  }

  /** HTTP 型：直接请求外部接口 */
  private async runHttp(
    skill: { key: string; name: string; config: unknown },
    ctx: SkillExecContext
  ) {
    const config = (skill.config as any) || {}
    const url: string | undefined = config.url
    if (!url) throw new BadRequestException("该 HTTP 技能未配置 url")

    const method: string = (config.method || "GET").toUpperCase()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(config.headers || {})
    }

    // 允许在 url 与 headers 中引用入参，如 {{city}}
    const render = (tpl: string) =>
      tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
        const value = path
          .split(".")
          .reduce<any>((acc, k) => (acc == null ? acc : acc[k]), ctx.input)
        return value == null ? "" : String(value)
      })

    const finalUrl = render(url)
    for (const k of Object.keys(headers)) headers[k] = render(headers[k])

    const scope=abortScope(ctx.signal,Math.min(120000,Math.max(1000,Number(config.timeout)||20000)))

    try {
      const response = await fetch(finalUrl, {
        method,
        headers,
        body:
          method === "GET" || method === "HEAD"
            ? undefined
            : JSON.stringify(
                config.bodyTemplate
                  ? JSON.parse(render(JSON.stringify(config.bodyTemplate)))
                  : ctx.input
              ),
        signal: scope.signal
      })

      const text = await response.text()
      let parsed: unknown = text
      try {
        parsed = JSON.parse(text)
      } catch {
        /* 非 JSON 就返回原文 */
      }

      if (!response.ok) {
        throw new BadRequestException(
          `接口返回 ${response.status}：${text.slice(0, 500)}`
        )
      }

      await this.quota.recordUsage({
        userId: ctx.userId,
        source: "SKILL",
        providerKey: "skill",
        modelKey: skill.key,
        success: true
      })

      return parsed
    } finally {
      scope.dispose()
    }
  }

  /**
   * BROWSER 型：按配置的步骤脚本驱动浏览器。
   * config.steps 形如 [{action:'goto',value:'{{url}}'}, {action:'extract'}]
   */
  private async runBrowser(
    skill: { key: string; name: string; config: unknown },
    ctx: SkillExecContext,
    _runId: string
  ) {
    const config = (skill.config as any) || {}
    const steps: any[] = config.steps || []
    if (steps.length === 0) {
      throw new BadRequestException("该浏览器技能未配置 steps")
    }

    const render = (tpl: string) =>
      String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
        const value = path
          .split(".")
          .reduce<any>((acc, k) => (acc == null ? acc : acc[k]), ctx.input)
        return value == null ? "" : String(value)
      })

    // 复用已有会话，或临时开一个
    const ownsSession = !ctx.browserSessionId
    const sessionId =
      ctx.browserSessionId ||
      (
        await this.browser.createSession({
          userId: ctx.userId,
          name: `技能：${skill.name}`,
          headless: config.headless ?? true
        })
      ).id

    const results: unknown[] = []
    const cancelBrowser=()=>{if(ownsSession)void this.browser.closeSession(sessionId).catch(()=>undefined)}
    ctx.signal?.addEventListener('abort',cancelBrowser,{once:true})
    try {
      checkAbort(ctx.signal)
      for (const raw of steps) {
        checkAbort(ctx.signal)
        const step = {
          action: raw.action,
          selector: raw.selector ? render(raw.selector) : undefined,
          value: raw.value !== undefined ? render(String(raw.value)) : undefined,
          timeout: raw.timeout
        }
        const result = await this.browser.execute(sessionId, step)
        checkAbort(ctx.signal)
        results.push({
          action: step.action,
          ok: result.ok,
          url: result.url,
          data: result.data,
          error: result.error,
          screenshotPath: result.screenshotPath
        })
        if (!result.ok && raw.required !== false) {
          throw new BadRequestException(
            `浏览器步骤「${step.action}」失败：${result.error}`
          )
        }
      }

      await this.quota.recordUsage({
        userId: ctx.userId,
        source: "BROWSER",
        providerKey: "browser",
        modelKey: skill.key,
        success: true
      })

      return { sessionId, steps: results }
    } finally {
      ctx.signal?.removeEventListener('abort',cancelBrowser)
      if (ownsSession && config.keepAlive !== true) {
        await this.browser.closeSession(sessionId).catch(() => undefined)
      }
    }
  }

  /**
   * TOOL 型：用模型 + 内置能力完成任务。
   * 目前内置：web_search（通过模型自身的知识/或外部 HTTP 技能组合）。
   * 若技能配置了内置工具名，则直接调用。
   */
  private async runTool(
    skill: { id: string; key: string; name: string; config: unknown; systemPrompt: string | null },
    ctx: SkillExecContext,
    _runId: string
  ) {
    const config = (skill.config as any) || {}
    const builtin: string | undefined = config.builtin

    // 内置技能：校园导览（UCASS）——只给路径，不代办
    if (builtin === "campus_guide") {
      return this.runCampusGuide(skill, ctx)
    }
    if (builtin === 'knowledge_search') {
      const query = String(ctx.input.query || ctx.input.question || '').trim()
      if (!query) throw new BadRequestException('请提供 query')
      const conversation = ctx.conversationId ? await this.prisma.conversation.findFirst({where:{id:ctx.conversationId,userId:ctx.userId},select:{agentId:true}}) : null
      ctx.beforeKnowledgeRetrieval?.()
      const evidence=await this.campusGuide.answerEvidence(query, 'guide', 3, {collection:config.collection,agentId:conversation?.agentId,budgetTokens:1200})
      checkAbort(ctx.signal);ctx.onKnowledgeEvidence?.(evidence.sources)
      return evidence.text
    }

    // 内置技能：网页摘要 / 网页问答（浏览器抓取 + 模型总结）
    if (builtin === "web_summary" || builtin === "web_qa") {
      throw new BadRequestException('浏览器目前仅开放个人课表读取，请使用 /timetable')
    }

    // 内置工具库：本地计算、文本处理、免费网络查询等。
    // 这些工具都是自包含的，不需要额外配置，直接按 key 调度。
    if (builtin && ToolRegistry.has(builtin)) {
      return ToolRegistry.run(builtin, {
        signal:ctx.signal,
        userId: ctx.userId,
        conversationId: ctx.conversationId ?? null,
        input: ctx.input || {}
      })
    }

    // 也允许技能 key 本身就是一个内置工具名，省去额外配置
    if (ToolRegistry.has(skill.key)) {
      return ToolRegistry.run(skill.key, {
        signal:ctx.signal,
        userId: ctx.userId,
        conversationId: ctx.conversationId ?? null,
        input: ctx.input || {}
      })
    }

    if (builtin) {
      throw new BadRequestException(
        `未找到内置工具「${builtin}」，可用：${ToolRegistry.all()
          .map((t) => t.key)
          .join(", ")}`
      )
    }

    // 其余 TOOL 技能：调用模型执行 systemPrompt + 入参
    const modelId: string | undefined = config.modelId
    return this.callModel(skill, ctx, modelId)
  }

  /**
   * 内置工具：UCASS 校园事务导览。
   *
   * 严格遵循 skill 的定位——**指路人，不是代办者**：
   *   - 只从本地索引检索，不编造部门/电话/链接
   *   - 默认 guide 模式只给路径；用户在对话里明确要细节才走 full
   *   - 绝不代登录、代填表、代提交；只给链接让学生自己点
   */
  private async runCampusGuide(
    skill: { key: string; name: string; systemPrompt: string | null; config: unknown },
    ctx: SkillExecContext
  ) {
    const config = (skill.config as any) || {}
    const input = ctx.input || {}
    const rawQuery =
      input.query ?? input.q ?? input.keyword ?? input.question ?? ctx.input.text
    const query = String(rawQuery ?? "").trim()
    if (!query) {
      throw new BadRequestException("该技能需要提供 query 入参，例如「校园卡丢了怎么补办」")
    }

    // 用户显式要求细节（或技能配置强制）时才切 full，避免默认倾倒正文
    const wantsFull =
      config.defaultMode === "full" ||
      input.mode === "full" ||
      /详细|细则|全文|原文|材料要几份|具体条款/.test(query)
    const canFull = ctx.userPermissions?.includes('*') || ctx.userPermissions?.includes('campus:full')
    const mode: GuideMode = wantsFull && canFull ? "full" : "guide"
    const limit = Number(input.limit) || Number(config.limit) || 5

    const conversation = ctx.conversationId ? await this.prisma.conversation.findFirst({where:{id:ctx.conversationId,userId:ctx.userId},select:{agentId:true}}) : null
    ctx.beforeKnowledgeRetrieval?.()
    const structured = await this.campusGuide.search(query, mode, limit,{agentId:conversation?.agentId})
    const text = this.campusGuide.renderAnswer(structured)
    checkAbort(ctx.signal)
    ctx.onKnowledgeEvidence?.(sourcesFromEvidence(structured.hits,text,structured.meta.resolvedQuery||query))

    await this.quota.recordUsage({
      userId: ctx.userId,
      conversationId: ctx.conversationId ?? null,
      source: "SKILL",
      providerKey: "campus-guide",
      modelKey: skill.key,
      success: true
    })

    // 同时返回结构化结果，前端/其它调用方可以直接渲染卡片
    return {
      mode,
      query,
      text,
      verifiedAt: structured.meta.verifiedAt,
      hits: structured.hits.map((h) => ({
        title: h.title,
        url: h.url,
        dept: h.dept,
        place: h.place,
        tel: h.tel,
        access: h.access,
        detailStatus: h.detailStatus,
        steps: h.steps,
        keyFacts: h.keyFacts,
        warnings: h.warnings
      })),
      policy: "导览只给路径，请自行打开入口页面完成操作。"
    }
  }

  private async runWebQa(
    skill: { key: string; name: string; systemPrompt: string | null; config: unknown },
    ctx: SkillExecContext
  ) {
    const config = (skill.config as any) || {}
    const url = String(ctx.input.url || "")
    if (!url) throw new BadRequestException("该技能需要提供 url 入参")

    const session = await this.browser.createSession({
      userId: ctx.userId,
      name: `技能：${skill.name}`,
      headless: true
    })

    try {
      await this.browser.execute(session.id, { action: "goto", value: url })
      checkAbort(ctx.signal)
      const extracted = await this.browser.execute(session.id, {
        action: "extract",
        selector: config.selector || undefined
      })
      checkAbort(ctx.signal)

      const pageData = extracted.data as any
      const question = String(ctx.input.question || "请总结这个网页的主要内容")

      const answer = await this.callModel(
        {
          key: skill.key,
          name: skill.name,
          systemPrompt:
            skill.systemPrompt ||
            "你是一个网页内容分析助手。请根据给定的网页内容准确回答问题，不要编造。"
        },
        {
          ...ctx,
          input: {
            question,
            pageTitle: pageData?.title,
            pageUrl: pageData?.url,
            pageText: String(pageData?.text || "").slice(0, 12000)
          }
        },
        config.modelId
      )

      return { url, title: pageData?.title, answer }
    } finally {
      await this.browser.closeSession(session.id).catch(() => undefined)
    }
  }

  /** 用一次非流式模型调用完成技能 */
  private async callModel(
    skill: { key: string; name: string; systemPrompt: string | null },
    ctx: SkillExecContext,
    modelId?: string
  ): Promise<string> {
    const model = modelId
      ? await this.prisma.model.findUnique({
          where: { id: modelId },
          include: { provider: true }
        })
      : await this.prisma.model.findFirst({
          where: { enabled: true, provider: { enabled: true } },
          orderBy: [{ isDefault: "desc" }, { sort: "asc" }],
          include: { provider: true }
        })

    if (!model) throw new BadRequestException("没有可用的模型，请先在后台配置模型")

    await this.quota.assertWithinQuota(ctx.userId)

    const { apiKey, baseUrl } = await this.providers.resolveCredentials(
      model.providerId
    )
    const provider = this.llmFactory.resolve(model.provider.type)

    const started = Date.now()
    let text = ""
    let promptTokens = 0
    let completionTokens = 0
    let error: string | undefined

    const stream = provider.stream({
      signal:ctx.signal,
      model: model.key,
      apiKey,
      baseUrl,
      maxTokens: model.maxOutputTokens,
      messages: [
        {
          role: "system",
          content:
            skill.systemPrompt ||
            `你是技能「${skill.name}」的执行器，请严格按照要求完成任务。`
        },
        {
          role: "user",
          content: JSON.stringify(ctx.input, null, 2)
        }
      ]
    })

    for await (const event of stream) {
      if (event.type === "text") text += event.text
      else if (event.type === "usage") {
        promptTokens = event.usage.promptTokens
        completionTokens = event.usage.completionTokens
      } else if (event.type === "error") error = event.message
      else if(event.type==='done'&&event.finishReason==='aborted')error='技能模型执行已停止'
    }

    const latencyMs = Date.now() - started
    await this.quota.recordUsage({
      userId: ctx.userId,
      conversationId: ctx.conversationId ?? null,
      modelId: model.id,
      providerKey: model.provider.key,
      modelKey: model.key,
      source: "SKILL",
      promptTokens,
      completionTokens,
      latencyMs,
      success: !error,
      errorCode: error ?? null,
      costUsd:
        (promptTokens / 1_000_000) * model.inputPricePerM +
        (completionTokens / 1_000_000) * model.outputPricePerM
    })

    if (error) throw new BadRequestException(`模型调用失败：${error}`)
    return text
  }

  // ---------- 运行记录 ----------

  async listRuns(query: QuerySkillRunDto) {
    const where: Prisma.SkillRunWhereInput = {skill:{is:visibleCapabilityWhere}}
    if (query.skillId) where.skillId = query.skillId
    if (query.userId) where.userId = query.userId
    if (query.status) where.status = query.status as any

    return this.prisma.paginate(
      this.prisma.skillRun,
      {
        where,
        orderBy: { startedAt: "desc" },
        include: {
          skill: { select: { id: true, key: true, name: true, type: true } },
          user: { select: { id: true, email: true, name: true } }
        }
      },
      Number(query.page) || 1,
      Number(query.pageSize) || 20
    )
  }

  async runStats(days = 7) {
    const since = new Date(Date.now() - days * 86400_000)
    const [bySkill, byStatus, bySkillStatus, agg, recent] = await Promise.all([
      this.prisma.skillRun.groupBy({
        by: ["skillId"],
        where: { skill:{is:visibleCapabilityWhere}, startedAt: { gte: since } },
        _count: { _all: true },
        _avg: { durationMs: true }
      }),
      this.prisma.skillRun.groupBy({
        by: ["status"],
        where: { skill:{is:visibleCapabilityWhere}, startedAt: { gte: since } },
        _count: { _all: true }
      }),
      // 按「技能 + 状态」二次分组，用于给出每个技能的成功/失败明细
      this.prisma.skillRun.groupBy({
        by: ["skillId", "status"],
        where: { skill:{is:visibleCapabilityWhere}, startedAt: { gte: since } },
        _count: { _all: true }
      }),
      this.prisma.skillRun.aggregate({
        where: { skill:{is:visibleCapabilityWhere}, startedAt: { gte: since } },
        _count: { _all: true },
        _avg: { durationMs: true }
      }),
      this.prisma.skillRun.findMany({
        where: { skill:{is:visibleCapabilityWhere}, startedAt: { gte: since } },
        select: { startedAt: true, status: true }
      })
    ])

    const skillStatusMap = new Map<string, { success: number; failed: number }>()
    for (const row of bySkillStatus) {
      const bucket = skillStatusMap.get(row.skillId) ?? { success: 0, failed: 0 }
      if (row.status === "SUCCESS") bucket.success += row._count._all
      else if (row.status === "FAILED") bucket.failed += row._count._all
      skillStatusMap.set(row.skillId, bucket)
    }

    const skillIds = bySkill.map((r) => r.skillId)
    const skills = await this.prisma.skill.findMany({
      where: { id: { in: skillIds } },
      select: { id: true, name: true, key: true }
    })
    const nameMap = new Map(skills.map((s) => [s.id, s]))

    const statusMap = new Map(byStatus.map((r) => [r.status, r._count._all]))
    const success = statusMap.get("SUCCESS") ?? 0
    const failed = statusMap.get("FAILED") ?? 0

    // 按天聚合，缺失日期补 0
    const dayMap = new Map<string, { runs: number; failed: number }>()
    for (const row of recent) {
      const key = row.startedAt.toISOString().slice(0, 10)
      const bucket = dayMap.get(key) ?? { runs: 0, failed: 0 }
      bucket.runs += 1
      if (row.status === "FAILED") bucket.failed += 1
      dayMap.set(key, bucket)
    }
    const byDay: { date: string; runs: number; failed: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
      const bucket = dayMap.get(date) ?? { runs: 0, failed: 0 }
      byDay.push({ date, runs: bucket.runs, failed: bucket.failed })
    }

    return {
      total: agg._count._all,
      success,
      failed,
      avgDurationMs: Math.round(agg._avg.durationMs ?? 0),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count._all
      })),
      bySkill: bySkill
        .map((r) => {
          const meta = nameMap.get(r.skillId)
          const stat = skillStatusMap.get(r.skillId) ?? { success: 0, failed: 0 }
          return {
            skill: meta
              ? { id: meta.id, name: meta.name, key: meta.key }
              : { id: r.skillId, name: r.skillId, key: "" },
            runs: r._count._all,
            success: stat.success,
            failed: stat.failed,
            avgDurationMs: Math.round(r._avg.durationMs ?? 0)
          }
        })
        .sort((a, b) => b.runs - a.runs),
      byDay
    }
  }
}
