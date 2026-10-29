import {z} from 'zod'

export const shortcutBindingsSchema=z.array(z.object({
  label:z.string().trim().min(1).max(30),question:z.string().trim().min(1).max(500),
  enabled:z.boolean(),dependencies:z.array(z.string().min(1).max(100)).max(8).default([])
}).strict()).max(6)
export type ShortcutBinding=z.infer<typeof shortcutBindingsSchema>[number]
export const shortcutSettingPrefix='knowledge_shortcuts:'

/** Defaults apply only before a base receives an explicit configuration, including an empty list. */
export function defaultShortcuts(base:{name:string;connection?:unknown},foodBaseId?:string):ShortcutBinding[]{
  const config=base.connection as {collections?:unknown;sourceKey?:unknown}|null
  if(config?.sourceKey==='讲座聚合/lectures.json')return [{label:'讲座日历',question:'查看校园讲座日历',enabled:true,dependencies:[]}]
  if(config?.sourceKey==='社科大外卖红黑榜_RAG.json')return [{label:'外卖红黑榜',question:'外卖红黑榜',enabled:true,dependencies:[]}]
  if(Array.isArray(config?.collections)&&config.collections.includes('survival'))return [{label:'辛瓜生存指北',question:'请查询辛瓜生存指北中的校园生活经验',enabled:true,dependencies:[]}]
  if(base.name==='今天吃什么 · 校园选餐')return [{label:'今天吃什么',question:'今天吃什么',enabled:true,dependencies:foodBaseId?[foodBaseId]:[]}]
  return []
}
