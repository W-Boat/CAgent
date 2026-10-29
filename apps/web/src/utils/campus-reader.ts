import {safeUiUrl} from './agent-ui'
import type {CampusGuideHit} from '@/api/types'

export function readerUrl(value:unknown):string {
 const url=typeof value==='string'?value.trim():''
 return safeUiUrl(url)?url:''
}
export function contentFormatLabel(value?:string):string {
 return ({map:'校园地图',rule:'关键词约定',fixed:'固定问答',cards:'排版卡片',document:'文档 / 附件',link:'服务入口',article:'文章 / 知识块'} as Record<string,string>)[value||'']||'知识资料'
}
export function entryLabel(hit:CampusGuideHit):string {
 if(hit.detailStatus==='unavailable'||hit.access==='已合并下线')return '查看原始资料'
 return hit.contentFormat==='link'?'前往服务入口':hit.contentFormat==='document'?'查看文档来源':'查看资料原文'
}
/** Compact list previews only; full content still uses the Markdown/card renderer. */
export function contentPreview(value?:string):string {
 return String(value||'').slice(0,6000).replace(/```[\s\S]*?(?:```|$)/g,' ').replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/^\s{0,3}#{1,6}\s+/gm,'').replace(/(?:\*\*|__|~~|`)/g,'').replace(/^\s*>\s?/gm,'').replace(/\s+/g,' ').trim().slice(0,140)
}
