/**
 * 技能预设与默认模型选择的共享配置。
 *
 * ── 技能「自动开启 / 推荐开启」 ──
 *
 * 后端机制：PROMPT 技能只有出现在请求的 skills 列表里才会注入提示词
 * （chat.service.ts 的 collectPromptFragments）。所以「开启」是前端侧的
 * 预勾选：匹配到的技能在会话开始时自动进入 pickedSkills，用户可以摘除。
 *
 * 两组前缀都按 **key 前缀** 匹配（知识包的 key 形如 kb-matters-a1b2c3，
 * 分组段是稳定的，内容哈希段不参与匹配）：
 *   - AUTO_SKILL_PREFIXES        每次新对话**无条件**自动启用。
 *     默认为空是有意的：知识包单包 0.6k~7k tokens，常驻注入会按条计费；
 *     要常驻哪个包，把它的分组前缀加进来即可（如 "kb-takeout"）。
 *   - RECOMMENDED_SKILL_PREFIXES 推荐开启：新对话**预勾选**（可一键摘除），
 *     且在技能选择面板里带「推荐」角标。
 *
 * ── 校园网本地模型的默认选择 ──
 *
 * 用户在进入平台时选择「已连接校园网」后（CampusNetDialog），默认模型
 * 优先从 CAMPUS_MODEL_KEYS 里挑（学校本地化部署的两个模型）；
 * 挑不到（未导入/未启用）再回落到平台默认（isDefault）。
 */

/*
 * 自动/推荐前缀：清空。
 * 参考语料（办事事项/FAQ/通知/文档/机构/课程）已从「PROMPT 技能」改为
 * **检索库**（导入 campus_guide_items，走与校园导览一致的查询机制），
 * 不再作为整段提示词注入 —— 之前把 kb-courses（≈7万 token）自动勾进
 * 每一次新对话是严重的 token 浪费。留空数组保留机制，将来若要常驻某类
 * 小技能再往这里加前缀。
 */
export const AUTO_SKILL_PREFIXES: string[] = []
export const RECOMMENDED_SKILL_PREFIXES: string[] = []

// 所有参考资料统一进入知识库，聊天不再保留固定知识技能白名单。

export function matchesSkillPrefix(key: string | null | undefined, prefixes: string[]): boolean {
  if (!key) return false
  return prefixes.some((p) => key === p || key.startsWith(p + "-") || key.startsWith(p))
}

/** 从技能清单里挑出命中前缀的 key（保持清单顺序） */
export function pickSkillKeysByPrefix<T extends { key?: string | null }>(
  list: T[],
  prefixes: string[]
): string[] {
  return list.filter((s) => matchesSkillPrefix(s.key, prefixes)).map((s) => s.key as string)
}

/** 校园网本地模型（学校本地化部署，仅校园网可达） */
export const CAMPUS_MODEL_KEYS = ["step-3.7-flash", "qwen3.8-27b"]

export interface ModelPickItem {
  id?: string | null
  key?: string | null
  isDefault?: boolean | null
}

/**
 * 默认模型挑选：优先级为
 *   1. 管理端设置的「学生端默认模型」（preferredModelId，须在可用清单里）
 *   2. 校园网模式下的校内本地模型（CAMPUS_MODEL_KEYS）
 *   3. 平台默认（isDefault）
 * 挑不到就逐级回落，模式开关不该让聊天发不出去。
 */
export function pickDefaultModel<T extends ModelPickItem>(
  list: T[],
  campusNet: boolean,
  preferredModelId?: string | null
): T {
  if (preferredModelId) {
    const preferred = list.find((m) => m.id === preferredModelId)
    if (preferred) return preferred
  }
  if (campusNet) {
    const campus = list.find((m) => CAMPUS_MODEL_KEYS.includes(m.key || ""))
    if (campus) return campus
  }
  return list.find((m) => m.isDefault) || list[0]
}
