import type { RouteRecordRaw } from "vue-router"

/*
 * 路由 meta 的类型声明。
 *
 * 不声明的话 meta 是松散类型，写错字段名不会报错
 * （`keepAlive` 曾长期只是个没人读的字符串，正是因为没类型约束）。
 */
declare module "vue-router" {
  interface RouteMeta {
    /** 页面标题，用于浏览器标签与面包屑 */
    title?: string
    /** 无需登录即可访问 */
    public?: boolean
    /** 所需权限码；缺省表示所有登录用户可访问 */
    permission?: string
    /** 内容区占满高度（对话、导览这类沉浸式页面） */
    fullscreen?: boolean
    /**
     * 是否缓存该组件实例。
     *
     * 打开后切换 tab 不会重建组件、不会重新拉数据 —— 这是消除
     * 切换卡顿的关键。**前提是组件声明了 `name` 且与路由 name 一致**，
     * 否则 `<keep-alive :include>` 匹配不上，缓存静默失效。
     */
    keepAlive?: boolean
    /**
     * 学生端是否可访问。
     *
     * 学生（无任何后台权限）只应看到聊天前端，其余路径一律重定向回
     * `/student`。这里用**白名单**而不是黑名单：新增页面默认对学生
     * 关闭，忘记标记时的后果是「学生看不到」而非「学生误入后台」——
     * 前者是可见的小问题，后者是安全问题。
     *
     * 判定逻辑见 router/index.ts。
     */
    studentAllowed?: boolean

    /**
     * 标记「只有学生能进」。
     *
     * 与 studentAllowed 是一对反向开关：
     *   studentAllowed —— 白名单，允许学生进入这条（否则被弹回 /student）
     *   studentOnly    —— 这条只给学生用，管理侧（教师/管理员）进来会被送回 homePath
     *
     * 学生端聊天页需要 studentOnly：它是学生的落地页，但不该同时成为
     * 教师的一个「可访问页面」—— 教师进去看到的是一个没有审核入口的空壳，
     * 只会让他以为系统坏了（实测教师手输 /student 会停在学生端里）。
     */
    studentOnly?: boolean

    /**
     * 依赖的可选功能开关。未开启时该路由重定向回首页，
     * 与菜单隐藏形成「看不见 + 进不去」的双层。
     */
    feature?: FeatureKey
  }
}

/**
 * 可选功能开关的键。
 *
 * 与后端 SETTING_DEFS 里的 `<key>_enabled` 对应；
 * 前端读的是 /api/settings/public 暴露的同名字段。
 */
export type FeatureKey = "memory"

/**
 * 侧边栏菜单配置。
 * `permission` 为空表示所有登录用户可见；
 * `anyPermission` 命中任意一个即可见（用于后台模块）。
 */
export interface MenuItem {
  title: string
  path: string
  icon: string
  permission?: string | string[]
  badge?: string
  /**
   * 依赖的可选功能开关（对应公开设置里的 `<feature>_enabled`）。
   * 未开启时该菜单项不渲染。与 permission 是两个维度：
   * permission 管「你有没有资格」，feature 管「这个平台开没开」。
   */
  feature?: FeatureKey
}

export interface MenuGroup {
  title: string
  items: MenuItem[]
}

export const menuGroups: MenuGroup[] = [
  {
    title: "工作区",
    items: [
      { title: "工作台", path: "/dashboard", icon: "Odometer" },
      { title: "智能对话", path: "/chat", icon: "ChatDotRound" },
      { title: "我的课表", path: "/timetable", icon: "Calendar" },
      // 用 Guide 而不是 MapLocation：校园导览是「一路指引」，不是地图打点
      { title: "校园导览", path: "/campus", icon: "Guide", permission: "campus:read" },
      { title: "技能中心", path: "/skills", icon: "MagicStick" },
      { title: "智能体广场", path: "/agents", icon: "Promotion" },
      { title: "我的用量", path: "/usage", icon: "Histogram" },
      { title: "我的记忆", path: "/memory", icon: "Memo", feature:"memory" }
    ]
  },
  {
    title: "后台管理",
    items: [
      { title: "数据看板", path: "/admin/dashboard", icon: "DataBoard", permission: "dashboard:read" },
      { title: "用户管理", path: "/admin/users", icon: "User", permission: "user:read" },
      { title: "角色权限", path: "/admin/roles", icon: "Key", permission: "role:read" },
      { title: "模型供应商", path: "/admin/providers", icon: "Connection", permission: "provider:read" },
      { title: "模型配置", path: "/admin/models", icon: "Cpu", permission: "model:read" },
      { title: "智能体管理", path: "/admin/agents", icon: "Avatar", permission: "agent:read" },
      // 技能用 SetUp（扳手）区分于「收藏」含义的 Star
      { title: "技能管理", path: "/admin/skills", icon: "SetUp", permission: "skill:read" },
      { title: "技能运行记录", path: "/admin/skill-runs", icon: "Tickets", permission: "skill:read" },
      { title: "导览记录", path: "/admin/campus-runs", icon: "Compass", permission: "campus:read" },
      { title: "导览统计", path: "/admin/campus-stats", icon: "TrendCharts", permission: "campus:admin" },
      { title: '知识库管理', path: '/admin/knowledge', icon: 'Collection', permission: 'campus:admin' },
      { title: '界面实验室', path: '/admin/presentation', icon: 'PresentationLab', permission: 'campus:admin' },
      { title: '反馈与学习', path: '/admin/learning', icon: 'Reading', permission: 'learning:read' },
      { title:"批量对话测试",path:"/admin/evaluations",icon:"Document",permission:"conversation:read" },
      { title: "会话审计", path: "/admin/conversations", icon: "ChatLineSquare", permission: "conversation:read" },
      { title: "消息审计", path: "/admin/messages", icon: "Document", permission: "message:read" },
      { title: "用量统计", path: "/admin/usage", icon: "Histogram", permission: "usage:read:all" },
      { title: "配额管理", path: "/admin/quotas", icon: "Coin", permission: "quota:read" },
      { title: "审计日志", path: "/admin/audit", icon: "List", permission: "audit:read" },
      { title: "系统设置", path: "/admin/settings", icon: "Setting", permission: "setting:read" },
      { title: "体验版反馈", path: "/admin/trial", icon: "TrialFeedback", permission: "dashboard:read" }
    ]
  }
]

export const routes: RouteRecordRaw[] = [
  {path:'/timetable',name:'timetable',component:()=>import('@/views/timetable/TimetableView.vue'),meta:{studentAllowed:true,title:'我的课表'}},
  {path:'/browser',redirect:'/timetable',meta:{studentAllowed:true}},
  {path:'/map',name:'campus-map',component:()=>import('@/views/campus/CampusMapView.vue'),meta:{public:true,studentAllowed:true,title:'校园地图'}},
  {
    // 体验版：免登录、无历史、锁定 deepseek-chat、每 IP 每日 5 轮
    path: "/test",
    name: "trial",
    component: () => import("@/views/trial/TrialView.vue"),
    meta: { public: true, title: "体验版" }
  },
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/auth/next/LoginNextView.vue"),
    meta: { public: true, title: "登录" }
  },
  {
    path: "/register",
    name: "register",
    component: () => import("@/views/auth/next/RegisterNextView.vue"),
    meta: { public: true, title: "注册" }
  },
  /*
   * ══ 学生端聊天前端（独立外壳）══
   *
   * 刻意**不放在 AppLayoutNext 之下**：那是带侧边栏与后台导航的管理端骨架，
   * 学生进去会看到十几个自己用不到的入口（用户管理、审计日志…），
   * 点开又是 403。学生端要的是「打开就是聊天」。
   *
   * 这条路由同时也是学生的重定向落点，所以必须标记 studentAllowed。
   */
  {
    path: "/student",
    name: "student-chat",
    component: () => import("@/views/student/next/StudentChatNextView.vue"),
    meta: { title: "智能对话", studentAllowed: true, studentOnly: true }
  },
  /*
   * 新版（next）即唯一界面：所有路由直达 next 视图，不再有版本 chooser。
   */
  {
    path: "/",
    component: () => import("@/layouts/AppLayoutNext.vue"),
    redirect: "/dashboard",
    children: [
      {path:'admin/knowledge',name:'admin-knowledge',component:()=>import('@/views/admin/KnowledgeAdminView.vue'),meta:{title:'知识库管理',permission:'campus:admin',keepAlive:true}},
      {path:'admin/presentation',name:'admin-presentation',component:()=>import('@/views/admin/PresentationPlayground.vue'),meta:{title:'界面实验室',permission:'campus:admin'}},
      {path:'admin/learning',name:'admin-learning',component:()=>import('@/views/admin/LearningAdminView.vue'),meta:{title:'反馈与学习',permission:'learning:read',keepAlive:true}},
      {
        path: "dashboard",
        name: "dashboard",
        component: () => import("@/views/next/WorkbenchNextView.vue"),
        meta: { title: "工作台", keepAlive: true }
      },
      {
        path: "chat/:id?",
        name: "chat",
        component: () => import("@/views/chat/next/ChatNextView.vue"),
        meta: { title: "智能对话", fullscreen: true }
      },
      {
        path: "skills",
        name: "skills",
        component: () => import("@/views/skills/SkillCenterView.vue"),
        meta: { title: "技能中心", keepAlive: true }
      },
      {
        path: "agents",
        name: "agents",
        component: () => import("@/views/agents/AgentGalleryView.vue"),
        meta: { title: "智能体广场", keepAlive: true }
      },
      {
        path: "usage",
        name: "my-usage",
        component: () => import("@/views/usage/MyUsageView.vue"),
        meta: { title: "我的用量", keepAlive: true }
      },
      /*
       * 浏览器操控（/browser）与浏览器会话（/admin/browser）保持隐藏。
       * 反馈与学习（/admin/learning）已恢复，按 learning:read 权限开放。
       * 视图文件与后端能力保留（browser_control 工具不受影响），恢复时从
       * git 历史把这三条路由与菜单项加回即可。
       */
      {
        path: "campus",
        name: "campus-guide",
        component: () => import("@/views/campus/CampusGuideView.vue"),
        meta: { title: "校园导览", permission: "campus:read", fullscreen: true }
      },
      {
        path: "profile",
        name: "profile",
        component: () => import("@/views/ProfileView.vue"),
        meta: { title: "个人设置" }
      },
      {
        path: "memory",
        name: "memory",
        component: () => import("@/views/memory/MemoryView.vue"),
        meta: { feature:"memory", title: "我的记忆", keepAlive: true }
      },

      // ---------- 后台 ----------
      {
        path: "admin/dashboard",
        name: "admin-dashboard",
        component: () => import("@/views/admin/next/AdminDashboardNextView.vue"),
        meta: { title: "数据看板", permission: "dashboard:read", keepAlive: true }
      },
      {
        path: "admin/users",
        name: "admin-users",
        component: () => import("@/views/admin/UsersView.vue"),
        meta: { title: "用户管理", permission: "user:read", keepAlive: true }
      },
      {
        path: "admin/roles",
        name: "admin-roles",
        component: () => import("@/views/admin/RolesView.vue"),
        meta: { title: "角色权限", permission: "role:read", keepAlive: true }
      },
      {
        path: "admin/providers",
        name: "admin-providers",
        component: () => import("@/views/admin/ProvidersView.vue"),
        meta: { title: "模型供应商", permission: "provider:read", keepAlive: true }
      },
      {
        path: "admin/models",
        name: "admin-models",
        component: () => import("@/views/admin/ModelsView.vue"),
        meta: { title: "模型配置", permission: "model:read", keepAlive: true }
      },
      {
        path: "admin/agents",
        name: "admin-agents",
        component: () => import("@/views/admin/AgentsAdminView.vue"),
        meta: { title: "智能体管理", permission: "agent:read", keepAlive: true }
      },
      {
        path: "admin/skills",
        name: "admin-skills",
        component: () => import("@/views/admin/SkillsAdminView.vue"),
        meta: { title: "技能管理", permission: "skill:read", keepAlive: true }
      },
      {
        path: "admin/skill-runs",
        name: "admin-skill-runs",
        component: () => import("@/views/admin/SkillRunsView.vue"),
        meta: { title: "技能运行记录", permission: "skill:read", keepAlive: true }
      },
      {
        path: "admin/conversations",
        name: "admin-conversations",
        component: () => import("@/views/admin/ConversationsView.vue"),
        meta: { title: "会话审计", permission: "conversation:read", keepAlive: true }
      },
      {
        path: "admin/messages",
        name: "admin-messages",
        component: () => import("@/views/admin/MessagesView.vue"),
        meta: { title: "消息审计", permission: "message:read", keepAlive: true }
      },
      {
        path: "admin/usage",
        name: "admin-usage",
        component: () => import("@/views/admin/UsageAdminView.vue"),
        meta: { title: "用量统计", permission: "usage:read:all", keepAlive: true }
      },
      {
        path: "admin/quotas",
        name: "admin-quotas",
        component: () => import("@/views/admin/QuotasView.vue"),
        meta: { title: "配额管理", permission: "quota:read", keepAlive: true }
      },
      {
        path: "admin/audit",
        name: "admin-audit",
        component: () => import("@/views/admin/AuditView.vue"),
        meta: { title: "审计日志", permission: "audit:read", keepAlive: true }
      },
      {
        path: "admin/settings",
        name: "admin-settings",
        component: () => import("@/views/admin/SettingsView.vue"),
        meta: { title: "系统设置", permission: "setting:read", keepAlive: true }
      },
      {path:"admin/evaluations",name:"admin-evaluations",component:()=>import("@/views/admin/EvaluationsView.vue"),meta:{title:"批量对话测试",permission:"conversation:read"}},
      {
        path: "admin/trial",
        name: "admin-trial",
        component: () => import("@/views/admin/TrialAdminView.vue"),
        meta: { title: "体验版反馈", permission: "dashboard:read" }
      },
      {
        path: "admin/campus-runs",
        name: "admin-campus-runs",
        component: () => import("@/views/admin/CampusRunsView.vue"),
        meta: { title: "导览记录", permission: "campus:read", keepAlive: true }
      },
      {
        path: "admin/campus-stats",
        name: "admin-campus-stats",
        component: () => import("@/views/admin/CampusStatsView.vue"),
        meta: { title: "导览统计", permission: "campus:admin", keepAlive: true }
      }
    ]
  },
  {
    path: "/403",
    name: "forbidden",
    component: () => import("@/views/error/ForbiddenView.vue"),
    meta: { public: true, title: "无权限" }
  },
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: () => import("@/views/error/NotFoundView.vue"),
    meta: { public: true, title: "页面不存在" }
  }
]

/**
 * 收集所有 `meta.keepAlive` 为真的路由 name，供 `<keep-alive :include>` 使用。
 *
 * keep-alive 的 include 匹配的是**组件名**，不是路由名。这里的约定是
 * 「组件名 === 路由名」，各视图需通过 `defineOptions({ name: "xxx" })` 声明。
 * 两者不一致时缓存会静默失效（页面看起来正常，只是每次都在重新加载），
 * 所以开发模式下会打印缺失的组件名，便于及早发现。
 */
export function collectKeepAliveNames(): string[] {
  const names: string[] = []

  const walk = (list: RouteRecordRaw[]) => {
    for (const r of list) {
      if (r.meta?.keepAlive) {
        if (typeof r.name === "string") names.push(r.name)
        else if (import.meta.env.DEV) {
          console.warn("[routes] keepAlive 路由缺少 name，缓存无法生效：", r.path)
        }
      }
      if (r.children?.length) walk(r.children)
    }
  }

  walk(routes)
  return names
}

/** 已校验过的路由，避免重复拉取组件 */
const verified = new Set<string>()

/**
 * 自检：`keepAlive` 路由的**组件名**是否与其路由名一致。
 *
 * keep-alive 的 include 匹配的是组件名而非路由名，两者不一致时
 * 缓存会**静默失效** —— 页面看起来一切正常，只是每次进去都在重新加载。
 * 这类问题极难靠肉眼发现：曾经有 6 个管理页（含最慢的「数据看板」）
 * 因为漏了 defineOptions 而完全没被缓存，直到做性能剖析才暴露。
 *
 * 因此在开发模式下异步动态导入组件、读它的 name 并比对，不一致就响亮地报错。
 * 之所以只在 DEV 跑：生产环境多拉一次 chunk 不值得，且构建期已有类型检查兜底。
 */
export async function verifyKeepAliveComponents(): Promise<string[]> {
  if (!import.meta.env.DEV) return []

  const problems: string[] = []
  const pending: { name: string; loader: unknown }[] = []

  const walk = (list: RouteRecordRaw[]) => {
    for (const r of list) {
      if (r.meta?.keepAlive && typeof r.name === "string" && !verified.has(r.name)) {
        const comp = r.component as unknown
        if (typeof comp === "function") {
          pending.push({ name: r.name, loader: comp })
        }
      }
      if (r.children?.length) walk(r.children)
    }
  }
  walk(routes)

  await Promise.all(
    pending.map(async ({ name, loader }) => {
      verified.add(name)
      try {
        const mod = (await (loader as () => Promise<{ default?: { name?: string } }>)()) as {
          default?: { name?: string }
        }
        const compName = mod?.default?.name
        if (compName !== name) {
          problems.push(
            `路由 "${name}" 标记了 keepAlive，但组件名是 "${compName ?? "(未声明)"}"`
          )
        }
      } catch {
        // 动态导入失败不阻塞启动，交给路由本身报错
      }
    })
  )

  if (problems.length > 0) {
    console.error(
      "[keep-alive] 以下页面的缓存不会生效（组件名与路由名不一致，请加 defineOptions({ name } )）：\n" +
        problems.map((p) => "  - " + p).join("\n")
    )
  }

  return problems
}
