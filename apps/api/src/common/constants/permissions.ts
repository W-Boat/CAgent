/**
 * 权限码目录：所有权限的唯一来源。
 * seed 时会同步进数据库，前端也从这里取得可勾选的权限树。
 */
export interface PermissionDef {
  code: string
  name: string
  group: string
  description?: string
}

export const PERMISSION_GROUPS: Record<string, string> = {
  user: "用户管理",
  role: "角色权限",
  model: "模型与供应商",
  conversation: "会话审计",
  usage: "用量与配额",
  skill: "Skill 技能",
  browser: "浏览器操控",
  agent: "智能体",
  campus: "校园导览",
  learning: "自学习反馈",
  system: "系统设置",
  audit: "审计日志"
}

export const PERMISSIONS: PermissionDef[] = [
  // 用户
  { code: "user:read", name: "查看用户", group: "user" },
  { code: "user:create", name: "新建用户", group: "user" },
  { code: "user:update", name: "编辑用户", group: "user" },
  { code: "user:delete", name: "删除用户", group: "user" },
  { code: "user:status", name: "启用/禁用用户", group: "user" },
  { code: "user:password", name: "重置用户密码", group: "user" },

  // 角色权限
  { code: "role:read", name: "查看角色", group: "role" },
  { code: "role:create", name: "新建角色", group: "role" },
  { code: "role:update", name: "编辑角色与授权", group: "role" },
  { code: "role:delete", name: "删除角色", group: "role" },
  { code: "permission:read", name: "查看权限列表", group: "role" },

  // 模型与供应商
  { code: "provider:read", name: "查看供应商", group: "model" },
  { code: "provider:write", name: "编辑供应商与密钥", group: "model" },
  { code: "provider:delete", name: "删除供应商", group: "model" },
  { code: "model:read", name: "查看模型", group: "model" },
  { code: "model:write", name: "编辑模型", group: "model" },
  { code: "model:delete", name: "删除模型", group: "model" },
  { code: "model:test", name: "测试模型连通性", group: "model" },

  // 会话审计
  { code: "conversation:read", name: "查看全部会话", group: "conversation" },
  { code: "conversation:delete", name: "删除会话", group: "conversation" },
  { code: "message:read", name: "查看消息明细", group: "conversation" },
  { code: "message:flag", name: "标记违规内容", group: "conversation" },
  { code: "conversation:export", name: "导出会话数据", group: "conversation" },

  // 用量与配额
  { code: "usage:read", name: "查看用量统计", group: "usage" },
  { code: "usage:read:all", name: "查看全员用量", group: "usage" },
  { code: "quota:read", name: "查看配额", group: "usage" },
  { code: "quota:write", name: "设置配额", group: "usage" },

  // Skill
  { code: "skill:read", name: "查看技能", group: "skill" },
  { code: "skill:create", name: "新建技能", group: "skill" },
  { code: "skill:update", name: "编辑技能", group: "skill" },
  { code: "skill:delete", name: "删除技能", group: "skill" },
  { code: "skill:run", name: "运行技能", group: "skill" },
  { code: "skill:read:runs", name: "查看技能执行记录", group: "skill" },

  // 浏览器操控
  { code: "browser:use", name: "使用浏览器操控", group: "browser" },
  { code: "browser:read", name: "查看浏览器会话", group: "browser" },
  { code: "browser:control:all", name: "管理他人浏览器会话", group: "browser" },

  // 智能体
  { code: "agent:read", name: "查看智能体", group: "agent" },
  { code: "agent:create", name: "新建智能体", group: "agent" },
  { code: "agent:update", name: "编辑智能体", group: "agent" },
  { code: "agent:delete", name: "删除智能体", group: "agent" },

  // 校园导览
  { code: "campus:read", name: "浏览校园导览", group: "campus" },
  { code: "campus:guide", name: "打开导览页面", group: "campus" },
  { code: "campus:full", name: "查看完整正文", group: "campus" },
  { code: "campus:admin", name: "维护导览索引", group: "campus" },

  // 系统
  { code: "setting:read", name: "查看系统设置", group: "system" },
  { code: "setting:write", name: "修改系统设置", group: "system" },
  { code: "audit:read", name: "查看审计日志", group: "audit" },

  // 自学习反馈（提交反馈本身对所有登录用户开放，无需权限码）
  { code: "learning:read", name: "查看学习条目", group: "learning" },
  { code: "learning:review", name: "审核学习条目", group: "learning" },
  { code: "dashboard:read", name: "查看数据看板", group: "system" },
  /*
   * 查看学生端。
   *
   * 学生端（/student）是学生的专属外壳：没有后台导航、侧栏只有自己的
   * 会话记录。教师在里面审不了任何东西，看到的是一个空壳，
   * 所以要把教师挡在外面（需求：「教师不进入学生端页面」）。
   *
   * 但**管理员应当保留预览能力** —— 学生反馈「界面不对」时要能自己
   * 进来看一眼，这是平台维护的常规需要，早先的实现就刻意允许
   * （verify-student-ui 里有一条断言守着它）。
   *
   * 两句话合起来需要一个明确的标记位：光看 dashboard:read 分不出
   * 教师与管理员（两者都有）。所以单独立这个权限码，
   * 由「谁能预览学生端」来表达意图，而不是在路由里硬编码角色名。
   */
  { code: "student:preview", name: "查看学生端", group: "system" },
  /*
   * 开关平台的可选功能。
   *
   * 「系统设置」本身已经是超管专属：内置 admin 角色没有 setting:read /
   * setting:write（实测 admin 37 条权限里没有）。这个码是**保险**——
   * 学校若自建带 setting:write 的角色，也不该顺带拿到
   * 「要不要向全校露出某个可选功能」的决定权。
   * 只发给 super_admin（`*` 覆盖；生产环境的超管是显式授权，需迁移时单授）。
   */
  { code: "feature:toggle", name: "开关可选功能", group: "system" }
]

/** 系统内置角色及其权限 */
export const SYSTEM_ROLES = [
  {
    key: "super_admin",
    name: "超级管理员",
    description: "拥有系统全部权限",
    permissions: ["*"]
  },
  {
    key: "admin",
    name: "管理员",
    description: "日常运营管理，不含系统设置与角色授权",
    permissions: [
      "user:read",
      "user:create",
      "user:update",
      "user:status",
      "user:password",
      "role:read",
      "permission:read",
      "provider:read",
      "model:read",
      "model:test",
      "conversation:read",
      "message:read",
      "message:flag",
      "conversation:export",
      "usage:read",
      "usage:read:all",
      "quota:read",
      "quota:write",
      "skill:read",
      "skill:create",
      "skill:update",
      "skill:run",
      "skill:read:runs",
      "browser:use",
      "browser:read",
      "agent:read",
      "agent:create",
      "agent:update",
      "campus:read",
      "campus:guide",
      "campus:full",
      "campus:admin",
      "learning:read",
      "learning:review",
      "dashboard:read",
      "student:preview"
    ]
  },
  {
    /*
     * 教师（小管理）。
     *
     * ── 为什么要有这个角色 ──
     *
     * 原先「是不是学生」的判据是「没有 dashboard:read」，
     * 而教师挂的是普通用户角色（user），于是教师被判成学生、
     * 被重定向进学生聊天端 —— 教师看不到任何审核入口。
     *
     * ── 权限边界（刻意收窄）──
     *
     * 只给「看 + 标记」：
     *   看板     dashboard:read       —— 也是「能进后台」的标记位
     *   问答审核 conversation:read    —— 查看全部会话
     *            message:read         —— 查看消息明细
     *            message:flag         —— 标记违规内容
     *   自学习   learning:read/review
     *   自己的用量 usage:read
     *
     * 另外必须带上的两个**只读**权限（不是可选装饰）：
     *   user:read  —— 会话审计页要拉用户列表做「按学生筛选」，
     *                 缺了它该页会 403，而筛选正是审核的入口。
     *   agent:read —— 自学习审核与记忆页都要拉智能体清单来显示
     *                 「这条是谁答的」，缺了它这两个页面会报错。
     *   两者都只读：教师能看到用户/智能体的**列表**，
     *   但没有 user:update / agent:update，改不了任何东西。
     *
     * 刻意**不给**：
     *   conversation:export —— 导出是「把学生对话成批带走」，
     *     比逐条查看的隐私影响大得多，留在管理员手里。
     *   user:create/update/status/password、role:*、provider:*、
     *     model:*、setting:*、audit:read —— 教师不改配置、不碰账号。
     *   *.delete —— 小管理只做审核，不做删除。
     */
    key: "teacher",
    name: "教师（小管理）",
    description: "查看数据看板、审核学生问答与自学习条目，不改配置",
    permissions: [
      "dashboard:read",
      "conversation:read",
      "message:read",
      "message:flag",
      "learning:read",
      "learning:review",
      "usage:read",
      "user:read",
      "agent:read"
    ]
  },
  {
    key: "user",
    name: "普通用户",
    description: "使用对话与已授权技能",
    permissions: [
      "skill:read",
      "skill:run",
      "agent:read",
      "browser:use",
      "campus:read",
      "campus:guide"
    ]
  }
] as const

export const ALL_PERMISSION_CODES = PERMISSIONS.map((p) => p.code)