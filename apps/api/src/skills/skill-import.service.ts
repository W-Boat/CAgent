import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { SkillType } from "@prisma/client"
import AdmZip from "adm-zip"

/** 解析后的技能草稿：字段与 CreateSkillDto 对齐，另带来源信息供界面提示 */
export interface ParsedSkill {
  key: string
  name: string
  description: string
  type: SkillType
  category: string
  icon: string | null
  systemPrompt: string | null
  inputSchema: Record<string, unknown> | null
  config: Record<string, unknown> | null
  /** 解析过程中发现的问题（不阻断导入，界面可以用来提醒） */
  warnings: string[]
  /** 识别出的来源格式 */
  format: "json" | "markdown" | "text" | "zip"
  /** zip 包内的文件清单（非 zip 来源为空） */
  files?: string[]
}

/** zip 包内单个文件的大小上限，避免压缩炸弹把内存吃满 */
const MAX_ENTRY_SIZE = 2 * 1024 * 1024
/** zip 包解压后的总大小上限 */
const MAX_TOTAL_SIZE = 8 * 1024 * 1024
/** zip 内文件数量上限（技能包不该有几百个文件） */
const MAX_ENTRIES = 200

/** 允许的技能类型，用于校验导入内容 */
const VALID_TYPES: SkillType[] = ["PROMPT", "TOOL", "HTTP", "BROWSER"]

/** 从名称推导 key：保留字母数字，其余转连字符 */
function slugify(input: string): string {
  const ascii = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (ascii.length >= 2) return ascii.slice(0, 64)

  // 纯中文名推不出有意义的 slug，用拼音式的稳定兜底：skill-<hash>
  let h = 0
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0
  return `skill-${Math.abs(h).toString(36)}`
}

/**
 * 技能导入解析器。
 *
 * 支持三种来源，按内容自动识别，不需要用户选格式：
 *   1. JSON —— 本平台自己导出的结构，或 { key,name,description,... } 形式的对象
 *   2. Markdown（SKILL.md）—— 常见于 Claude Skills 风格的技能包：
 *      一级标题当名称，开头段落当描述，正文整体作为 PROMPT 型系统提示词
 *   3. 纯文本 —— 整体当作提示词，名称取第一行
 *
 * 只做解析与规整，不落库；落库仍走 SkillsEngineService.create，
 * 这样权限校验、审计日志、唯一性检查都只有一处实现。
 */
@Injectable()
export class SkillImportService {
  private readonly logger = new Logger(SkillImportService.name)

  parse(raw: string, fallbackName?: string): ParsedSkill {
    const text = (raw ?? "").trim()
    if (!text) throw new BadRequestException("导入内容为空")

    if (text.length > 400_000) {
      throw new BadRequestException("导入内容过大（上限约 400KB）")
    }

    const asJson = this.tryParseJson(text)
    if (asJson) return this.fromJson(asJson)

    if (/^#{1,3}\s+\S/m.test(text)) return this.fromMarkdownText(text, fallbackName)

    return this.fromText(text, fallbackName)
  }

  /**
   * 解析技能包（zip）。
   *
   * 兼容常见的技能包结构（Claude Skills / 自建包）：
   *   skill-name/
   *     SKILL.md          ← 主文档，取名称/描述/正文
   *     skill.json        ← 可选，结构化定义（优先级高于 md）
   *     *.md / *.txt      ← 其余文档作为补充资料
   *
   * 关键取舍：技能包里的附件（脚本、模板等）**不落盘**，
   * 只在提示词里列出清单并说明用途——避免上传可执行文件带来的安全面。
   */
  parseZip(buffer: Buffer, fallbackName?: string): ParsedSkill {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException("压缩包为空")
    }
    if (buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException("压缩包过大（上限 10MB）")
    }

    let zip: AdmZip
    try {
      zip = new AdmZip(buffer)
    } catch (err) {
      throw new BadRequestException(`无法读取压缩包：${(err as Error).message}`)
    }

    const entries = zip.getEntries().filter((e) => !e.isDirectory)
    if (entries.length === 0) {
      throw new BadRequestException("压缩包里没有文件")
    }
    if (entries.length > MAX_ENTRIES) {
      throw new BadRequestException(
        `压缩包内文件过多（${entries.length} 个，上限 ${MAX_ENTRIES}）`
      )
    }

    const warnings: string[] = []
    const files: string[] = []
    let totalSize = 0

    /** 文本类文件的内容，按路径索引 */
    const textFiles = new Map<string, string>()
    /** 需要提醒用户「已忽略」的非文本资源 */
    const skippedBinary: string[] = []

    for (const entry of entries) {
      // 规范化路径：去掉顶层目录名，只保留相对路径
      const name = entry.entryName.replace(/\\/g, "/")
      const parts = name.split("/").filter(Boolean)
      const rel = parts.length > 1 ? parts.slice(1).join("/") : parts[0]
      // 隐藏文件与 macOS 打包产生的垃圾条目直接跳过
      if (!rel || rel.startsWith(".") || rel.startsWith("__MACOSX")) continue

      files.push(rel)

      const size = entry.header?.size ?? 0
      totalSize += size
      if (size > MAX_ENTRY_SIZE) {
        warnings.push(`「${rel}」超过 2MB，已忽略`)
        continue
      }
      if (totalSize > MAX_TOTAL_SIZE) {
        throw new BadRequestException("压缩包解压后过大（上限 8MB）")
      }

      const lower = rel.toLowerCase()
      const isText =
        lower.endsWith(".md") ||
        lower.endsWith(".markdown") ||
        lower.endsWith(".txt") ||
        lower.endsWith(".json") ||
        lower.endsWith(".yaml") ||
        lower.endsWith(".yml")

      if (!isText) {
        skippedBinary.push(rel)
        continue
      }

      try {
        textFiles.set(rel, entry.getData().toString("utf8"))
      } catch (err) {
        warnings.push(`「${rel}」读取失败：${(err as Error).message}`)
      }
    }

    if (textFiles.size === 0) {
      throw new BadRequestException(
        "压缩包里没有可识别的文本文件（需要 SKILL.md / skill.json / .md / .txt）"
      )
    }

    /*
     * 优先 skill.json（结构化定义最完整），
     * 其次 SKILL.md（技能包约定俗成的主文档），
     * 最后随便挑一个 md 作为兜底。
     */
    const findByName = (target: string) =>
      Array.from(textFiles.keys()).find(
        (k) => k.toLowerCase() === target || k.toLowerCase().endsWith(`/${target}`)
      )

    const jsonKey = findByName("skill.json")
    /*
     * 主文档优先 SKILL.md。
     *
     * 注意不要用「第一个 .md」当主文档：包内文件按字典序排列时
     * examples.md 会排在 SKILL.md 前面，于是示例文档被当成正文，
     * 真正的 SKILL.md 反而被当成附件，语义完全颠倒。
     */
    const mdKey = findByName("skill.md") || findByName("readme.md")
    const anyMd = Array.from(textFiles.keys()).find((k) => k.toLowerCase().endsWith(".md"))

    /** 实际用作主体的那个文件；附件过滤时排除它 */
    const mainDocKey = mdKey || anyMd

    let parsed: ParsedSkill

    if (jsonKey) {
      const asJson = this.tryParseJson(textFiles.get(jsonKey) || "")
      if (asJson) {
        parsed = this.fromJson(asJson)
        // 若 json 里没有提示词，用 md 正文补上，避免导入后是个空技能
        if (!parsed.systemPrompt && mainDocKey) {
          parsed.systemPrompt = textFiles.get(mainDocKey) || null
          warnings.push("skill.json 未提供 systemPrompt，已用 Markdown 正文补齐")
        }
      } else {
        warnings.push("skill.json 解析失败，改用 Markdown 主体")
        parsed = this.fromMarkdownText(
          textFiles.get(mainDocKey || "") || "",
          fallbackName
        )
      }
    } else if (mainDocKey) {
      parsed = this.fromMarkdownText(textFiles.get(mainDocKey) || "", fallbackName)
    } else {
      const first = textFiles.values().next().value as string
      parsed = this.fromText(first, fallbackName)
    }

    // 其余文档作为补充资料附在提示词后面，让模型知道包里还有什么
    const others = Array.from(textFiles.keys()).filter(
      (k) => k !== jsonKey && k !== mainDocKey
    )
    if (others.length > 0) {
      const supplement = others
        .slice(0, 10)
        .map((k) => {
          const body = (textFiles.get(k) || "").trim()
          // 每个附件最多带 2000 字，避免提示词被撑爆
          return `\n\n## 附件：${k}\n${body.slice(0, 2000)}${body.length > 2000 ? "\n…（已截断）" : ""}`
        })
        .join("")
      parsed.systemPrompt = `${parsed.systemPrompt || ""}${supplement}`.trim() || null
      if (others.length > 10) {
        warnings.push(`另有 ${others.length - 10} 个附件未并入提示词`)
      }
    }

    if (skippedBinary.length > 0) {
      // 二进制资源不落盘：明确告知，避免用户以为它们被保存了
      parsed.systemPrompt = `${parsed.systemPrompt || ""}\n\n## 技能包内的其他资源（未导入）\n${skippedBinary
        .slice(0, 20)
        .map((f) => `- ${f}`)
        .join("\n")}`.trim()
      warnings.push(
        `包内有 ${skippedBinary.length} 个非文本文件（脚本/模板等），出于安全未导入，仅在提示词中列出文件名`
      )
    }

    parsed.format = "zip"
    parsed.files = files
    parsed.warnings = [...warnings, ...parsed.warnings]

    return parsed
  }

  /** 依次尝试：整体 JSON、```json 代码块、内嵌的第一个大括号对象 */
  private tryParseJson(text: string): Record<string, unknown> | null {
    const candidates: string[] = [text]

    const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/)
    if (fenced) candidates.push(fenced[1].trim())

    const first = text.indexOf("{")
    const last = text.lastIndexOf("}")
    if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1))

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
      } catch {
        /* 试下一个 */
      }
    }
    return null
  }

  private fromJson(obj: Record<string, unknown>): ParsedSkill {
    const warnings: string[] = []

    // 兼容 {"skill": {...}} / {"data": {...}} 这类外层包装
    const inner =
      (obj.skill as Record<string, unknown>) ||
      (obj.data as Record<string, unknown>) ||
      obj

    const name = this.str(inner.name) || this.str(inner.title)
    if (!name) throw new BadRequestException("JSON 里缺少 name 字段，无法确定技能名称")

    let key = this.str(inner.key) || this.str(inner.id) || slugify(name)
    key = this.normalizeKey(key, warnings)

    let type = (this.str(inner.type) || "").toUpperCase() as SkillType
    if (!VALID_TYPES.includes(type)) {
      if (type) warnings.push(`类型 "${type}" 无法识别，已按 TOOL 处理`)
      type = inner.systemPrompt || inner.system_prompt ? "PROMPT" : "TOOL"
    }

    const description =
      this.str(inner.description) || this.str(inner.summary) || this.str(inner.desc) || ""
    if (!description) warnings.push("缺少 description，建议补充便于学生理解")

    const systemPrompt =
      this.str(inner.systemPrompt) || this.str(inner.system_prompt) || null

    const inputSchema =
      (inner.inputSchema as Record<string, unknown>) ||
      (inner.input_schema as Record<string, unknown>) ||
      null

    const config =
      (inner.config as Record<string, unknown>) ||
      (inner.parameters as Record<string, unknown>) ||
      null

    // PROMPT 型必须有提示词，否则导入后是个空技能
    if (type === "PROMPT" && !systemPrompt) {
      warnings.push("PROMPT 型技能没有 systemPrompt，导入后不会生效")
    }

    return {
      key,
      name: name.slice(0, 64),
      description: description.slice(0, 512),
      type,
      category: this.str(inner.category) || "通用",
      icon: this.str(inner.icon) || null,
      systemPrompt,
      inputSchema,
      config,
      warnings,
      format: "json"
    }
  }

  /**
   * 解析 SKILL.md 风格文档。
   *
   * 约定：第一个一级/二级标题是技能名；标题后到下一个标题之间的段落是描述；
   * 其余正文整体作为系统提示词——这样导进来的技能立刻可用。
   */
  private fromMarkdownText(text: string, fallbackName?: string): ParsedSkill {
    const warnings: string[] = []
    const lines = text.split(/\r?\n/)

    let name = ""
    let nameLine = -1
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^#{1,3}\s+(.+?)\s*$/)
      if (m) {
        name = m[1].trim()
        nameLine = i
        break
      }
    }
    if (!name) name = (fallbackName || "未命名技能").trim()

    // 标题之后、下一个标题之前的非空段落拼成描述
    const descParts: string[] = []
    for (let i = nameLine + 1; i < lines.length; i++) {
      if (/^#{1,6}\s+/.test(lines[i])) break
      const line = lines[i].trim()
      if (line) descParts.push(line)
      // 描述取够一两段就停，避免把整篇正文塞进 description
      if (descParts.join(" ").length > 180) break
    }
    let description = descParts
      .join(" ")
      .replace(/[*_`>#]/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (description.length > 300) description = description.slice(0, 297) + "…"
    if (!description) {
      description = `${name}（由文档导入）`
      warnings.push("文档里没找到描述段落，已用名称占位")
    }

    const key = this.normalizeKey(slugify(name), warnings)

    return {
      key,
      name: name.slice(0, 64),
      description: description.slice(0, 512),
      type: "PROMPT",
      category: "导入",
      icon: null,
      // 正文即提示词，保留原格式（标题、列表对模型理解层级有帮助）
      systemPrompt: text,
      inputSchema: null,
      config: null,
      warnings,
      format: "markdown"
    }
  }

  private fromText(text: string, fallbackName?: string): ParsedSkill {
    const warnings: string[] = []
    const firstLine = text.split(/\r?\n/).find((l) => l.trim())?.trim() || ""
    const name = (fallbackName || firstLine || "未命名技能").slice(0, 64)
    const key = this.normalizeKey(slugify(name), warnings)

    if (text.length < 30) warnings.push("内容很短，作为提示词可能效果有限")
    warnings.push("未识别出结构化格式，已整体作为 PROMPT 型提示词导入")

    return {
      key,
      name,
      description: `由文本导入：${firstLine.slice(0, 120)}`,
      type: "PROMPT",
      category: "导入",
      icon: null,
      systemPrompt: text,
      inputSchema: null,
      config: null,
      warnings,
      format: "text"
    }
  }

  /** key 必须满足模型调用要求：小写字母、数字、连字符 */
  private normalizeKey(raw: string, warnings: string[]): string {
    const key = raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)

    if (key.length >= 2) return key

    const generated = `skill-${Date.now().toString(36)}`
    warnings.push(`原始标识不合法，已自动生成 ${generated}`)
    return generated
  }

  private str(value: unknown): string {
    if (typeof value === "string") return value.trim()
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return ""
  }
}
