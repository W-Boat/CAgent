/**
 * 技能清单的公共清洗工具。
 *
 * ── 为什么需要 ──
 *
 * /skills/available 不去重（实测 23 条里只有 18 个可区分能力），重复有两类：
 *   1. 同一工具的两套 key（内置下划线 couple_context vs seed 连字符 couple-context），
 *      显示名与描述完全一样；后端组装工具时已按归一化名去重，
 *      但 available 接口本身不去重。
 *   2. 误重复导入：同名技能被「重名自动改名」导入多次（key 各不相同）。
 *
 * 之前去重逻辑写在学生端视图里，管理端聊天页的选择器仍会把重复项
 * 摆给用户（「论文选题顾问」×4）。提到公共层让所有消费方共用一份判据。
 *
 * 判据用「名字 + 描述」而不是只用名字：
 *   - 只用名字会误杀真正同名不同义的两个技能；
 *   - 只用归一化 key 合不掉第 2 类（四条 key 各不相同）。
 * 两者都相同才是复制粘贴出来的噪音。保留先出现的那条
 * （列表按 sort, name 排序，先出现即管理员排得靠前的）。
 */
export interface DedupeSkillItem {
  key: string
  name?: string | null
  description?: string | null
}

export function dedupeSkills<T extends DedupeSkillItem>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const s of list) {
    const k = `${(s.name || "").trim().toLowerCase()}::${(s.description || "").trim().toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}
