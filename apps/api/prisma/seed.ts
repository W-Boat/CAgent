/**
 * 种子数据：
 *   1. 权限目录与内置角色
 *   2. 初始超级管理员
 *   3. 供应商与常用模型
 *   4. 系统设置默认值
 *   5. 内置技能与校园智能体
 *
 * 幂等：可重复执行，已存在的数据不会被覆盖。
 */
import { PrismaClient } from "@prisma/client"
import * as bcrypt from "bcryptjs"
import { createCipheriv, randomBytes, scryptSync } from "node:crypto"
import { PERMISSIONS, SYSTEM_ROLES } from "../src/common/constants/permissions"
import { SETTING_DEFS } from "../src/settings/setting-defs"
import { PROVIDER_PRESETS } from "../src/chat/provider-presets"

const prisma = new PrismaClient()

// ---------- 加密（与 CryptoService 保持一致） ----------
const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "cagent-insecure-default-key"
const key = scryptSync(secret, "cagent-api-key-salt", 32)

function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`
}

function envKeyFor(providerKey: string): string {
  const map: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_GEMINI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    moonshot: "MOONSHOT_API_KEY",
    dashscope: "DASHSCOPE_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    groq: "GROQ_API_KEY",
    azure: "AZURE_OPENAI_API_KEY"
  }
  const name = map[providerKey]
  return name ? process.env[name] || "" : ""
}

// ---------- 1. 权限与角色 ----------
async function seedPermissions() {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        name: p.name,
        group: p.group,
        description: p.description ?? null
      },
      update: { name: p.name, group: p.group }
    })
  }
  console.log(`✓ 权限目录：${PERMISSIONS.length} 项`)
}

async function seedRoles() {
  const allPermissions = await prisma.permission.findMany()

  /** 角色列表显示顺序：超管 → 管理员 → 教师 → 普通用户 */
  const ROLE_SORT: Record<string, number> = {
    super_admin: 0,
    admin: 1,
    teacher: 5,
    user: 9
  }

  for (const def of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        name: def.name,
        description: def.description,
        isSystem: true,
        sort: ROLE_SORT[def.key] ?? 9
      },
      update: { name: def.name, description: def.description, isSystem: true }
    })

    const wanted =
      def.permissions[0] === "*"
        ? allPermissions
        : allPermissions.filter((p) =>
            (def.permissions as readonly string[]).includes(p.code)
          )

    // 重新对齐权限集合
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } })
    await prisma.rolePermission.createMany({
      data: wanted.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true
    })

    console.log(`✓ 角色 ${def.name}：${wanted.length} 项权限`)
  }
}

// ---------- 2. 管理员 ----------
async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || "admin@cagent.local").toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD
  if (!password || password.length < 12) throw new Error("Set a SEED_ADMIN_PASSWORD of at least 12 characters before seeding")
  const name = process.env.SEED_ADMIN_NAME || "超级管理员"

  const role = await prisma.role.findUniqueOrThrow({
    where: { key: "super_admin" }
  })

  const existing = await prisma.user.findUnique({ where: { email } })

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { status: "ACTIVE" }
      })
    : await prisma.user.create({
        data: {
          email,
          name,
          passwordHash: await bcrypt.hash(password, 10),
          status: "ACTIVE",
          department: "信息化中心"
        }
      })

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {}
  })

  await prisma.userQuota.upsert({
    where: { userId: user.id },
    create: { userId: user.id, enabled: false, note: "管理员默认不限额" },
    update: {}
  })

  console.log(`✓ 超级管理员：${email}`)
  return user
}

// ---------- 3. 供应商与模型 ----------
async function seedProviders() {
  let defaultModelId: string | null = null

  for (const preset of PROVIDER_PRESETS) {
    const envKey = envKeyFor(preset.key)

    const existing = await prisma.provider.findUnique({
      where: { key: preset.key }
    })

    const provider = existing
      ? await prisma.provider.update({
          where: { id: existing.id },
          data: {
            name: preset.name,
            type: preset.type,
            baseUrl: existing.baseUrl || preset.baseUrl,
            description: preset.description,
            isSystem: true,
            // 只有原本没有密钥时才从环境变量补
            apiKey: existing.apiKey ? existing.apiKey : envKey ? encrypt(envKey) : null
          }
        })
      : await prisma.provider.create({
          data: {
            key: preset.key,
            name: preset.name,
            type: preset.type,
            baseUrl: preset.baseUrl,
            apiKey: envKey ? encrypt(envKey) : null,
            description: preset.description,
            isSystem: true,
            enabled: true,
            sort: PROVIDER_PRESETS.indexOf(preset)
          }
        })

    for (const model of preset.models) {
      const created = await prisma.model.upsert({
        where: {
          providerId_key: { providerId: provider.id, key: model.key }
        },
        create: {
          key: model.key,
          name: model.name,
          providerId: provider.id,
          enabled: true,
          sort: preset.models.indexOf(model),
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          supportsVision: model.supportsVision ?? false,
          supportsTools: model.supportsTools ?? false,
          inputPricePerM: model.inputPricePerM ?? 0,
          outputPricePerM: model.outputPricePerM ?? 0,
          description: model.description ?? null
        },
        update: {
          name: model.name,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          supportsTools: model.supportsTools ?? false,
          supportsVision: model.supportsVision ?? false
        }
      })

      // 有密钥的供应商里挑选默认模型：优先 deepseek-chat
      if (!defaultModelId && (provider.apiKey || envKey)) {
        if (preset.key === "deepseek" && model.key === "deepseek-chat") {
          defaultModelId = created.id
        }
      }
    }

    console.log(
      `✓ 供应商 ${preset.name}：${preset.models.length} 个模型${
        provider.apiKey ? "（已配置密钥）" : "（待配置密钥）"
      }`
    )
  }

  // 没有默认模型时，退而选择任意一个已配置密钥的模型，再退而选择第一个
  if (!defaultModelId) {
    const withKey = await prisma.model.findFirst({
      where: { provider: { apiKey: { not: null } } },
      orderBy: { sort: "asc" }
    })
    defaultModelId = withKey?.id ?? (await prisma.model.findFirst())?.id ?? null
  }

  if (defaultModelId) {
    await prisma.model.updateMany({ data: { isDefault: false } })
    await prisma.model.update({
      where: { id: defaultModelId },
      data: { isDefault: true }
    })
    await prisma.setting.upsert({
      where: { key: "default_model_id" },
      create: {
        key: "default_model_id",
        value: defaultModelId,
        group: "general",
        description: "默认模型 ID"
      },
      update: { value: defaultModelId }
    })
  }

  return defaultModelId
}

// ---------- 4. 系统设置 ----------
async function seedSettings() {
  for (const def of SETTING_DEFS) {
    await prisma.setting.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        value: def.defaultValue as any,
        group: def.group,
        description: def.description ?? null
      },
      update: {} // 不覆盖管理员已经改过的值
    })
  }
  console.log(`✓ 系统设置：${SETTING_DEFS.length} 项`)
}

// ---------- 5. 技能 ----------
async function seedSkills(adminId: string) {
  const skills = [
    {
      key: "paper-outline",
      name: "论文提纲生成",
      description: "根据研究主题生成结构完整的论文提纲，含各级标题与写作要点，适合开题报告和课程论文",
      type: "PROMPT" as const,
      category: "科研",
      icon: "Document",
      sort: 1,
      systemPrompt:
        "在回答论文相关问题时，请按以下规范输出：\n1. 先判断学科领域与研究方法；\n2. 提纲采用三级标题，一级标题使用「一、二、三」，二级使用「1.1 1.2」，三级使用「(1)(2)」；\n3. 每个二级标题下给出 2-4 条写作要点；\n4. 结尾补充 3-5 篇该主题下值得检索的文献方向（不要编造具体文献条目）。"
    },
    {
      key: "course-planner",
      name: "课程学习规划",
      description: "结合课程大纲与剩余周次，生成可执行的复习计划表，支持期末复习和日常学习安排",
      type: "PROMPT" as const,
      category: "学习",
      icon: "Calendar",
      sort: 2,
      systemPrompt:
        "你是学业规划助手。制定学习计划时：\n1. 先向用户确认课程名称、考试形式、剩余时间和每天可投入时长（缺失就假定合理默认值并说明）；\n2. 用 Markdown 表格输出周计划，列为：周次 / 章节范围 / 每日任务 / 自测方式；\n3. 复习节奏遵循「先框架后细节、先真题后拓展」；\n4. 最后给出 3 条执行建议。"
    },
    {
      key: "web-summary",
      name: "网页内容摘要",
      description: "打开指定网页并总结主要内容，适合整理通知公告、政策文件和学习资料",
      type: "TOOL" as const,
      category: "校园服务",
      icon: "Link",
      sort: 3,
      systemPrompt:
        "你是网页信息整理助手。阅读给定网页内容后：\n1. 用一句话说明这是什么页面；\n2. 分点列出关键信息（时间、地点、对象、材料、流程）；\n3. 如果页面提到截止日期或联系方式，务必单独强调；\n4. 不要编造页面中不存在的信息。",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "要总结的网页地址" },
          question: { type: "string", description: "关注的具体问题，可选" }
        },
        required: ["url"]
      },
      config: { builtin: "web_summary" }
    },
    {
      key: "web-qa",
      name: "网页问答",
      description: "针对指定网页提问，答案严格来自页面内容，适合查询具体政策和办事流程",
      type: "TOOL" as const,
      category: "校园服务",
      icon: "Search",
      sort: 4,
      systemPrompt:
        "你是网页问答助手。只依据提供的网页正文作答：\n- 能找到答案时直接回答，并引用原文关键句；\n- 找不到时明确回复「页面中未提及该信息」，不要推测。",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "网页地址" },
          question: { type: "string", description: "要提问的问题" }
        },
        required: ["url", "question"]
      },
      config: { builtin: "web_qa" }
    },
    {
      key: "campus-notice-crawler",
      name: "校园通知抓取",
      description: "抓取校内通知页面的标题与链接，便于批量汇总最新公告和活动信息",
      type: "BROWSER" as const,
      category: "校园服务",
      icon: "Monitor",
      sort: 5,
      systemPrompt: null,
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "通知列表页地址" }
        },
        required: ["url"]
      },
      config: {
        headless: true,
        keepAlive: false,
        steps: [
          { action: "goto", value: "{{url}}" },
          { action: "wait", timeout: 1200 },
          { action: "extract", selector: "body" }
        ]
      }
    },
    {
      key: "weather-query",
      name: "天气查询",
      description: "通过公开接口查询指定城市的实时天气和未来预报（示例 HTTP 技能）",
      type: "HTTP" as const,
      category: "通用",
      icon: "Sunny",
      sort: 6,
      systemPrompt: null,
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string", description: "城市名称，如 北京" }
        },
        required: ["city"]
      },
      // 示例配置，管理员可在后台改成校内可用的接口
      config: {
        method: "GET",
        url: "https://wttr.in/{{city}}?format=j1",
        timeout: 15000,
        enabled: false
      }
    },
    {
      key: "campus-guide",
      name: "校园门户导览",
      description:
        "社科大校园事务导览：去哪办、点哪里、带什么、注意什么。只给路径不代办，覆盖 4909 条校内事项与系统入口。",
      type: "TOOL" as const,
      category: "校园服务",
      icon: "MapLocation",
      sort: 7,
      permissionCode: "campus:read",
      systemPrompt: null,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "校园事务关键词或问法，例如「校园卡丢了怎么补办」「四六级报名」"
          },
          mode: {
            type: "string",
            description: "guide=只给指引（默认）；full=用户明确要求细节时才用",
            enum: ["guide", "full"]
          },
          limit: { type: "number", description: "返回候选条数，默认 5" }
        },
        required: ["query"]
      },
      config: { builtin: "campus_guide", defaultMode: "guide", limit: 5 }
    }
  ]

  for (const s of skills) {
    await prisma.skill.upsert({
      where: { key: s.key },
      create: {
        key: s.key,
        name: s.name,
        description: s.description,
        type: s.type,
        category: s.category,
        icon: s.icon,
        sort: s.sort,
        systemPrompt: s.systemPrompt,
        permissionCode: s.permissionCode ?? null,
        inputSchema: (s.inputSchema ?? undefined) as any,
        config: (s.config ?? undefined) as any,
        enabled: s.key === "weather-query" ? false : true,
        isSystem: true,
        createdById: adminId
      },
      update: {
        name: s.name,
        description: s.description,
        type: s.type,
        category: s.category,
        icon: s.icon,
        sort: s.sort,
        permissionCode: s.permissionCode ?? null
      }
    })
  }

  console.log(`✓ 内置技能：${skills.length} 个`)
}

// ---------- 6. 智能体 ----------
async function seedAgents(adminId: string, defaultModelId: string | null) {
  const skillKeys = [
    "paper-outline",
    "course-planner",
    "web-summary",
    "web-qa",
    "campus-notice-crawler",
    "campus-guide"
  ]
  const skills = await prisma.skill.findMany({
    where: { key: { in: skillKeys } }
  })
  const byKey = new Map(skills.map((s) => [s.key, s]))

  const agents = [
    {
      key: "ucass-guide",
      name: "社科大校园导览",
      description:
        "指路人：告诉你去哪办、点哪里、带什么、注意什么，并直接为你打开页面。不代办、不代提交。",
      avatar: "🧭",
      greeting:
        "你好，我是社科大校园导览。\n\n告诉我你要办什么事（比如「校园卡丢了」「四六级报名」「报销」），我会：\n1. 告诉你**去哪办、带什么、注意什么**；\n2. 帮你**把对应页面打开**；\n3. 在页面下方用提示框一步步指给你看。\n\n但**操作要你自己完成**——我不代登录、不代填表、不代提交。",
      starters: [
        "校园卡丢了怎么补办？",
        "四六级报名在哪里？",
        "出差报销流程是什么？",
        "怎么连学校 VPN？"
      ],
      systemPrompt: [
        "你是「社科大校园导览」，服务对象是中国社会科学院大学的在校师生。",
        "",
        "## 你的定位：指路人，不是代办者",
        "学生问「怎么办某事」，你告诉他**去哪办、点哪里、带什么、注意什么**，",
        "然后由学生自己打开页面完成操作。不要替学生操作，也不要把整篇政策原文倾倒给他。",
        "",
        "## 一句话原则",
        "给路径，不给全文；给指引，不代操作。",
        "",
        "## 硬性规则",
        "1. **不代替学生操作**：不代登录、不代填表、不代提交、不代打开页面。给链接让学生自己点。",
        "2. **不倾倒正文**：默认只给操作步骤（≤6 条）和关键参数，不要把完整说明整段复述。",
        "   学生明确要「详细说说」「材料要几份」「原文怎么写的」时才切 full 模式。",
        "3. **只用本地索引**，绝不编造链接、部门、电话、办公时间。",
        "4. **一次查询就够**：一条精准关键词，3~5 条候选即可作答。",
        "5. **看「访问方式」决定提示**：",
        "   - 公网 → 直接给链接",
        "   - 校园网/VPN → 必须提醒需在校园网内或用 aTrust VPN",
        "   - 已合并下线 → 说明该平台已并入其他系统",
        "6. **看「详情完整度」决定话术**：",
        "   - full/basic → 有官方办理信息，可转述",
        "   - attachment_only → 明确告诉学生「正文在附件里，需要自己下载看」",
        "   - link_only → 仅入口，说明需登录",
        "   - unavailable → 接口无数据，不要编内容",
        "7. **实时数据只给入口**：余额、课表、成绩、空闲教室、审批进度、失物招领、跳蚤市场",
        "   —— 一律不给具体内容，只指路。",
        "8. **通篇用中文**：不要出现英文开场白或过程说明（如「I'll look that up in the campus index.」「I'll look up…」「Let me search…」），",
        "   调用工具时直接调用、不要先宣告；直接给结论；链接原样给出，不要改写或短链化。",
        "9. **必须告知核实时间**（数据快照 2026-09-23，之后变更不会反映）。",
        "",
        "## 回答格式",
        "```",
        "**校园卡挂失、解挂与补办、退卡**",
        "- 去哪办：网络中心｜新教学综合楼309（望京：办公楼）",
        "- 电话：010-52576021｜时间：8:30–16:30",
        "- 带什么：本人有效身份证件、校园卡、学生证",
        "- 怎么走：",
        "  1. 先挂失 —— 到网络中心，或用一卡通自助圈存机/移动端",
        "  2. 补卡 —— 自助补卡机，或人工窗口缴 15 元工本费",
        "  3. 退卡 —— 先到图书馆清还，再走离校系统",
        "- 入口（自己点开）：https://easy.ucass.edu.cn/v2/matter/detail?id=427",
        "```",
        "步骤用「怎么做」的口吻；结尾提醒「打开链接自己操作」。",
        "",
        "## 工具使用",
        "需要校内办事指引时，调用 `campus-guide` 技能检索本地索引（4909 条）。",
        "需要看某个具体页面时，调用浏览器工具把页面打开给学生看，",
        "但**只打开，不要继续点击、填写或提交**。"
      ].join("\n"),
      allowBrowser: true,
      visibility: "PUBLIC" as const,
      skills: ["campus-guide", "web-qa"],
      sort: -1
    },
    {
      key: "campus-assistant",
      name: "校园百事通",
      description: "熟悉校内办事流程、通知公告与常见问题，可联网查看网页，适合查询办事流程、材料清单和最新通知",
      avatar: "🏫",
      greeting:
        "你好！我是校园百事通。校内办事流程、通知公告、选课与报销等问题都可以问我。如果涉及具体网页，我可以直接打开查看。",
      starters: [
        "报到需要准备哪些材料？",
        "帮我看看学校最新通知",
        "奖学金申请流程是什么？"
      ],
      systemPrompt:
        "你是「校园百事通」，服务对象是本校师生。\n\n工作原则：\n1. 回答校内事务时，优先给出可执行的步骤与所需材料清单；\n2. 涉及具体政策、时间、金额时，说明信息可能随年度调整，建议以官方最新通知为准；\n3. 需要查看具体网页时，调用 browser_control 工具打开该页面再作答，不要凭记忆编造页面内容；\n4. 语气亲切、简洁，能分点就分点。",
      allowBrowser: true,
      visibility: "PUBLIC" as const,
      skills: ["web-summary", "web-qa", "campus-notice-crawler"],
      sort: 0
    },
    {
      key: "study-coach",
      name: "学业规划师",
      description: "制定学习计划、梳理知识框架、生成复习与论文提纲，适合期末复习、课程学习和考试准备",
      avatar: "📚",
      greeting:
        "我是学业规划师。告诉我课程名称、考试时间和每天可用的学习时长，我来帮你排一份可执行的计划。",
      starters: ["帮我制定期末复习计划", "生成一篇课程论文提纲", "怎么高效背单词？"],
      systemPrompt:
        "你是「学业规划师」，擅长把模糊的学习目标拆解为可执行计划。\n\n工作原则：\n1. 先澄清关键信息（目标、期限、当前基础、每天可投入时间），缺失时给出默认假设并明确标注；\n2. 输出结构化计划，尽量用表格；\n3. 推荐具体的学习方法（如费曼技巧、间隔重复）并说明适用场景；\n4. 提醒用户计划要留出缓冲时间。",
      allowBrowser: false,
      visibility: "PUBLIC" as const,
      skills: ["paper-outline", "course-planner"],
      sort: 1
    },
    {
      key: "research-helper",
      name: "科研助手",
      description: "文献检索思路、论文结构与数据整理建议，适合本科生和研究生的科研训练与论文写作",
      avatar: "🔬",
      greeting:
        "我是科研助手。可以帮你梳理研究思路、设计论文结构、推荐检索关键词。",
      starters: ["帮我找这个方向的检索关键词", "设计一个实验方案框架", "论文摘要怎么写？"],
      systemPrompt:
        "你是「科研助手」，面向本科生与研究生的科研训练场景。\n\n工作原则：\n1. 绝不允许编造文献、作者、期刊、DOI 或数据；需要引用时只给出检索方向与关键词组合；\n2. 帮助用户把研究问题拆成可验证的子问题；\n3. 涉及统计方法时说明前提假设与适用条件；\n4. 输出尽量用学术化但易懂的表述。",
      allowBrowser: true,
      visibility: "CAMPUS" as const,
      skills: ["paper-outline", "web-summary"],
      sort: 2
    }
  ]

  for (const a of agents) {
    const agent = await prisma.agent.upsert({
      where: { key: a.key },
      create: {
        key: a.key,
        name: a.name,
        description: a.description,
        avatar: a.avatar,
        greeting: a.greeting,
        starters: a.starters as any,
        systemPrompt: a.systemPrompt,
        modelId: defaultModelId,
        enabled: true,
        visibility: a.visibility,
        isSystem: true,
        allowBrowser: a.allowBrowser,
        sort: a.sort,
        ownerId: adminId
      },
      update: {
        name: a.name,
        description: a.description,
        avatar: a.avatar,
        greeting: a.greeting,
        starters: a.starters as any,
        systemPrompt: a.systemPrompt,
        modelId: defaultModelId,
        visibility: a.visibility,
        allowBrowser: a.allowBrowser
      }
    })

    await prisma.agentSkill.deleteMany({ where: { agentId: agent.id } })
    const bound = a.skills
      .map((k, index) => {
        const skill = byKey.get(k)
        return skill ? { agentId: agent.id, skillId: skill.id, sort: index } : null
      })
      .filter((x): x is { agentId: string; skillId: string; sort: number } => x !== null)

    if (bound.length > 0) {
      await prisma.agentSkill.createMany({ data: bound, skipDuplicates: true })
    }
  }

  console.log(`✓ 内置智能体：${agents.length} 个`)
}

// ---------- 7. 演示用户（可选） ----------
async function seedDemoUsers() {
  if (process.env.SEED_DEMO_USERS !== "true") return

  const role = await prisma.role.findUnique({ where: { key: "user" } })
  if (!role) return

  const demos = [
    {
      email: "student@cagent.local",
      name: "张同学",
      department: "计算机学院",
      studentNo: "2023001"
    },
    {
      email: "teacher@cagent.local",
      name: "李老师",
      department: "计算机学院",
      studentNo: "T1001"
    }
  ]

  const password = process.env.SEED_DEMO_PASSWORD
  if (!password || password.length < 12) throw new Error("Set SEED_DEMO_PASSWORD before enabling demo accounts")

  for (const demo of demos) {
    const existing = await prisma.user.findUnique({
      where: { email: demo.email }
    })
    if (existing) continue

    const user = await prisma.user.create({
      data: {
        ...demo,
        passwordHash: await bcrypt.hash(password, 10),
        status: "ACTIVE"
      }
    })
    await prisma.userRole.create({
      data: { userId: user.id, roleId: role.id }
    })
    await prisma.userQuota.create({
      data: {
        userId: user.id,
        enabled: true,
        dailyTokenLimit: 100000,
        monthlyTokenLimit: 2000000,
        dailyRequestLimit: 200,
        rpmLimit: 20,
        note: "演示账号配额"
      }
    })
  }

  console.log("Demo accounts configured")
}

async function main() {
  console.log("开始写入种子数据…\n")

  await seedPermissions()
  await seedRoles()
  const admin = await seedAdmin()
  const defaultModelId = await seedProviders()
  await seedSettings()
  await seedSkills(admin.id)
  await seedAgents(admin.id, defaultModelId)
  await seedDemoUsers()

  console.log("\n种子数据写入完成 ✅")
}

main()
  .catch((err) => {
    console.error("种子数据写入失败：", err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
