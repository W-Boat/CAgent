/**
 * og.config.mjs 的类型声明。
 *
 * 配置本体保持纯 JS（构建脚本用 node 直接跑，无需额外 TS 运行时），
 * 这里给出类型让 TS 侧（utils/og.ts）能安全引用。
 * 两边字段必须保持一致 —— 改动配置时同步更新此文件。
 */

/** 需要生成分享卡片的页面 */
export interface OgPage {
  /** 路由路径，如 "/login" */
  path: string
  /** 页面标题（建议 ≤ 30 字） */
  title: string
  /** 页面描述（建议 ≤ 60 字） */
  description: string
}

/** 一个页面渲染所需的完整 OG 数据 */
export interface OgData {
  title: string
  description: string
  /** 绝对地址 */
  image: string
  /** 绝对地址 */
  url: string
  type: string
  siteName: string
}

export declare const SITE_ORIGIN: string
export declare const SITE_NAME: string
export declare const OG_IMAGE_PATH: string
export declare const LIMITS: { title: number; description: number }
export declare const PAGES: OgPage[]

/** 拼绝对地址 */
export declare function absoluteUrl(path: string): string

/** 裁剪到指定长度 */
export declare function clamp(text: string, max: number): string

/** 生成页面的完整 OG 数据 */
export declare function ogFor(page: OgPage): OgData
