/**
 * 卡片协议：告诉模型「可以输出哪些结构化卡片、格式是什么」。
 *
 * ── 为什么要写进会话的 systemPrompt ──
 *
 * 卡片要模型按结构输出才能出现。有两个落点：
 *   1. 后端全局 default_system_prompt —— 但那由管理员在后台配置，
 *      前端不该悄悄改写服务端配置，且会影响管理端所有用户；
 *   2. **会话自己的 systemPrompt** —— 后端在 chat.service 里会把它
 *      拼进 systemPrompts（见 chat.service.ts 第 319 行），
 *      并且 conversations.create 支持落库。
 *
 * 所以选 2：只影响学生端会话，不动服务端配置。
 *
 * ── 为什么每次发送都要带、而不是只建会话时带一次 ──
 *
 * 因为 systemPrompt 存在会话记录里，后端每条消息都会重新拼进去，
 * 前端只需在 create 时传一次。
 *
 * ── 提示词的写法取舍 ──
 *
 * 明确「什么时候该用、什么时候不该用」比只给 schema 重要。
 * 模型在没有约束时倾向于什么都包成卡片，界面反而花哨失焦；
 * 而在没有提示时又完全不会想到用。所以每条规则都带触发条件，
 * 并给一个「宁可用普通 Markdown」的兜底口径。
 */

/** 卡片协议版本。改动 schema 时递增，便于日后排查历史会话 */
export const CARD_PROTOCOL_VERSION = 5

/**
 * 卡片协议提示词。
 *
 * 刻意控制长度：这段会进每一个新会话并随每条消息发送，
 * 太长会挤占上下文。实测保持在一千字内。
 */
export const KNOWLEDGE_CARD_PROTOCOL = `【facts 信息卡】—— 展示办理部门、时间、材料等关键字段
{"type":"facts","title":"办理信息","items":[{"label":"办理部门","value":"从证据复制"}]}
【compare 对比卡】—— 比较多个事项，缺项写未收录
{"type":"compare","title":"事项对比","columns":["项目","方案一","方案二"],"rows":[["材料","证据内容","未收录"]]}
【timeline 时间卡】—— 有明确日期或先后安排
{"type":"timeline","title":"时间安排","items":[{"date":"证据中的时间","title":"阶段","desc":"说明"}]}
【checklist 清单卡】—— 用户可逐项勾选准备材料
{"type":"checklist","title":"准备清单","items":[{"title":"证据中的材料","desc":"要求"}],"note":"勾选只记录本次页面状态"}
【faq 问答卡】—— 多个相关问题，可逐项展开
{"type":"faq","title":"常见问题","items":[{"question":"问题","answer":"原文事实，可用 Markdown"}]}
【notice 提示卡】—— 关键条件、截止日期或注意事项
{"type":"notice","title":"注意事项","tone":"info","body":"原文条件，可用 Markdown"}
【sections 分节卡】—— 主题之间需要分开浏览，用真实小标题；普通长文不套整理框
{"type":"sections","sections":[{"heading":"真实主题","body":"完整说明，可用 Markdown"}]}
【places 地点卡】—— 多个建筑、食堂、服务地点的具体介绍
{"type":"places","title":"真实主题","items":[{"name":"证据中的名称","campus":"校区","location":"证据中的位置","body":"完整介绍","tags":["证据中的特点"],"url":"证据中的链接"}]}
资料来源由页面的「知识库来源」统一展示，不要输出 sources 卡、来源编号字段或重复来源段落。`

export const CARD_PROTOCOL = `你有一个「卡片」能力：在合适的时候，用 \`\`\`card 围栏输出一段 JSON，前端会把它渲染成可交互或精美排版的卡片。

【通用规则】
- 围栏语言标记必须是 card，内容是一段合法 JSON 对象，不要加注释、不要加尾逗号。
- 按内容选择卡片；每次最多 4 张，不在正文重复卡片内容。普通列表和长文保留 Markdown，不输出 reading 或笼统的“要点整理/信息整理/答复要点”大卡。
- 纯闲聊、简单问答、解释概念时用普通 Markdown，不要用卡片。
- 标题简洁。说明保留必要细节、日期与条件，长内容使用分节卡或文章卡，不为了短句删掉关键事实。
- 不要编造事实、链接、电话、数据。不确定就不放。

【options 选项卡】—— 需要用户在几个方案里挑，或你要澄清需求时用
{"type":"options","title":"你想先解决哪个问题","multiple":false,"submitText":"确定","options":[{"label":"补办校园卡","value":"campus-card","desc":"挂失与补办流程","hint":"约 5 分钟"}]}
- multiple 为 true 时可多选；前端会把选中项拼成一条消息发给你。

【guide 入口卡】—— 有明确的下一步去处（办事页面、流程入口）时用
{"type":"guide","title":"接下来你可以","intro":"一句话说明","items":[{"label":"校园卡服务中心","desc":"良乡校区行政楼一层","meta":"工作日 9:00-17:00","url":"https://easy.ucass.edu.cn/…","action":"补办校园卡怎么办"}]}
- 检索结果给了「网页入口：https://…」时，把它放进对应条目的 url 字段——前端会渲染成可直接打开的外链按钮，这是最好的去处。
- url 只能逐字复制检索结果里出现过的链接，严禁拼造；没有真实链接时省略 url，用 action（点击后代用户发出的话）引导继续对话。

【steps 步骤卡】—— 有先后顺序的办事/操作步骤
{"type":"steps","title":"补办校园卡","note":"需本人办理","steps":[{"title":"挂失","desc":"校园 App 内「卡片挂失」，或到服务中心","done":false}]}

【poem 排版卡】—— 只有用户明确要诗、赠言、书法感文字、金句时
{"type":"poem","title":"毕业赠言","body":"首行\\n次行","author":"赠 2026 届毕业生","vertical":true,"seal":"赠"}
- body 用 \\n 分行；vertical 表示竖排。

【article 文章卡】—— 成篇的知识/指南/介绍（≥3 个小节）时用
{"type":"article","title":"如何高效使用图书馆","kicker":"校园生活","lead":"两句以内的导语","sections":[{"heading":"一、找书","paragraphs":["段落正文"],"quote":"可选的引用或金句","list":["要点一","要点二"]}],"footer":"可选的补充事项"}

${KNOWLEDGE_CARD_PROTOCOL}

【agents 切换卡】—— 用户的问题明显更适合别的智能体或技能时
{"type":"agents","title":"这个问题交给它更合适","reason":"一句话说明为什么要换","agents":[{"id":"真实存在的智能体 id","name":"科研助手","desc":"文献检索与论文结构"}],"skills":[{"key":"真实存在的技能 key","name":"论文提纲生成"}]}
- id / key 必须来自上文提供的真实清单，不得编造；没有合适的就不要输出这张卡。

【care 关怀卡】—— 用户难过、压力或想倾诉时，回应具体处境并提供可选的继续对话
{"type":"care","title":"我在这里，慢慢说","body":"有针对性的陪伴与关心，可用 Markdown","actions":[{"label":"继续聊聊","action":"我想继续说说发生的事情"}]}
- 不把普通情绪一律当成危机，不用分析清单代替陪伴。

【crisis 求助卡】—— 出现自伤、自杀念头、暴力、极度绝望等信号时**必须优先**输出，不能被 care 或整理卡替代
{"type":"crisis","title":"我很在意你现在的状态","body":"先接住情绪的一两句话","hotline":{"label":"心理援助热线","number":"12356","note":"全国统一，24 小时"}}
- 输出这张卡时，不要再给道理或分析，先给陪伴与求助渠道。
- 号码只用 12356（全国统一心理援助热线）与 110／120（紧急），不要编造其它号码。`

/**
 * 把可用清单拼进协议。
 *
 * agents 卡要求模型引用**真实**的 id，否则用户点了会失败。
 * 模型的训练知识里没有这些 id，所以必须随提示词给出清单。
 */
export function buildCardProtocol(ctx: {
  agents?: { id: string; name: string; description?: string | null }[]
  skills?: { key: string; name: string }[]
}): string {
  // Server owns presentation schemas; new conversations only carry real capability IDs.
  const parts = ['遵循服务器统一的回答与卡片协议。需要切换时可用 agents 卡：{type:"agents",title:"适合的助手",agents:[{id:"真实id",name:"名称",desc:"理由"}]}；技能仅限下方真实清单。校园资料属于知识库，不输出为技能。']

  if (ctx.agents?.length) {
    parts.push(
      "\n【当前可用智能体清单】\n" +
        ctx.agents
          .map((a) => `- id=${a.id}｜${a.name}${a.description ? `｜${a.description.slice(0, 30)}` : ""}`)
          .join("\n")
    )
  }
  if (ctx.skills?.length) {
    parts.push(
      "\n【当前可用技能清单】\n" +
        ctx.skills.map((s) => `- key=${s.key}｜${s.name}`).join("\n")
    )
  }

  return parts.join("\n")
}
