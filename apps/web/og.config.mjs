/**
 * Open Graph 元数据的**单一数据源**。
 *
 * 三处共用它，避免各写一份导致不一致：
 *   1. index.html 的静态兜底标签
 *   2. 构建时为每个路由生成的独立 HTML（scripts/inject-og.mjs）
 *   3. 运行时路由切换的客户端同步（src/utils/og.ts）
 *
 * 保持为 .mjs（纯 JS）而不是 .ts：构建脚本用 node 直接跑，
 * 不需要额外 TS 运行时；TS 侧通过同目录的 og.config.d.ts 获得类型。
 *
 * ── 微信的硬性限制（超限会静默失败，不报错）──
 *   og:title       建议 ≤ 30 字，过长被截断
 *   og:description 建议 ≤ 60 字，过长被截断
 *   og:image       必须绝对路径，478×478，< 2MB
 *   首屏 HTML 里必须**已经存在**这些标签 —— 微信不执行 JS
 */

/**
 * 站点根地址，三级回退以兼顾构建期与运行期：
 *   1. 环境变量（构建时指定正式域名；运行时由 Vite 注入）
 *   2. 浏览器当前 origin（部署到任意域名都能自适应）
 *   3. 生产默认值（构建脚本在 Node 里跑，没有 window）
 */
function resolveOrigin() {
  if (typeof process !== "undefined" && process.env?.SITE_ORIGIN) {
    return process.env.SITE_ORIGIN
  }
  try {
    // Vite 会在构建时替换 import.meta.env.*
    if (import.meta?.env?.VITE_SITE_ORIGIN) {
      return import.meta.env.VITE_SITE_ORIGIN
    }
  } catch {
    /* 非 ESM 环境，忽略 */
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin
  }
  return "http://localhost:5173"
}

export const SITE_ORIGIN = resolveOrigin()

/** 站点名 */
export const SITE_NAME = "CAgent"

/** 分享封面：478×478 PNG，由 apps/api/scripts/gen-og-image.mjs 生成 */
export const OG_IMAGE_PATH = "/og-cover.png"

/** 微信/OG 建议的长度上限 */
export const LIMITS = {
  title: 30,
  description: 60
}

/**
 * 需要生成分享卡片的页面。
 *
 * 只收录**可公开访问**的页面：登录、注册，以及面向使用者的主功能页。
 * 后台管理页（/admin/*）不生成 —— 需要权限，分享出去对方打不开，
 * 卡片反而误导人。这些路径继续由 nginx 回落到根 index.html。
 */
export const PAGES = [
  {
    path: "/",
    title: "CAgent 校园智能体平台",
    description:
      "面向校园场景的 AI 智能体平台：多模型对话、技能编排、校园导览与浏览器操控。"
  },
  {
    path: "/login",
    title: "登录 · CAgent 校园智能体平台",
    description: "使用校园邮箱或管理员分配的账号登录，开始与智能体对话。"
  },
  {
    path: "/register",
    title: "注册 · CAgent 校园智能体平台",
    description: "用校园邮箱注册账号，即可使用多模型对话、技能中心与校园导览。"
  },
  {
    path: "/dashboard",
    title: "工作台 · CAgent",
    description: "一览我的会话、消息、Token 用量与最近动态，快速进入常用功能。"
  },
  {
    path: "/chat",
    title: "智能对话 · CAgent",
    description: "与多个大模型流式对话，支持技能调用、智能体切换与记忆延续。"
  },
  /*
   * 学生端。
   *
   * 它是学生登录后的落地页，也是学校最可能直接分享出去的入口
   * （「扫这个码就能问 AI」），因此必须有独立的卡片 ——
   * 否则分享出去显示的是「工作台」，与学生看到的界面对不上。
   */
  {
    path: "/student",
    title: "校园智能助手 · CAgent",
    description: "问课程、问办事、问资料，校园里的事都能聊。"
  },
  {
    path: "/skills",
    title: "技能中心 · CAgent",
    description: "浏览与运行内置技能：提示词、内置工具、接口调用与浏览器操作。"
  },
  {
    path: "/agents",
    title: "智能体广场 · CAgent",
    description: "挑选面向校园场景的智能体，问答、办事指引、资料检索一站直达。"
  },
  {
    path: "/campus",
    title: "校园导览 · CAgent",
    description:
      "社科大校内办事指引：部门、地点、电话、所需材料与入口，一步步教你怎么做。"
  },
  {
    path: "/usage",
    title: "我的用量 · CAgent",
    description: "查看按模型统计的 Token 消耗、请求次数与费用明细。"
  },
  {
    path: "/memory",
    title: "我的记忆 · CAgent",
    description: "管理智能体记住的信息，随时查看、编辑或删除。"
  },
  {
    path: "/profile",
    title: "个人设置 · CAgent",
    description: "修改昵称、头像与密码，管理个人账号信息。"
  }
]

/** 拼绝对地址：OG 协议要求 og:url 与 og:image 都是绝对路径 */
export function absoluteUrl(path) {
  const origin = SITE_ORIGIN.replace(/\/+$/, "")
  if (!path || path === "/") return `${origin}/`
  return `${origin}${path.startsWith("/") ? path : "/" + path}`
}

/** 裁剪到建议长度（超出会被静默截断，不如自己先裁并加省略号） */
export function clamp(text, max) {
  const s = String(text ?? "").trim()
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}

/** 生成一个页面的完整 OG 数据（标题与描述在此统一裁剪） */
export function ogFor(page) {
  return {
    title: clamp(page.title, LIMITS.title),
    description: clamp(page.description, LIMITS.description),
    image: absoluteUrl(OG_IMAGE_PATH),
    url: absoluteUrl(page.path),
    type: "website",
    siteName: SITE_NAME
  }
}
