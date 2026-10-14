import {createHash} from 'node:crypto'
import {Prisma} from '@prisma/client'
export const embeddedLabels:Record<string,string>={'collective-timetable':'集体课表',portal:'校园门户',services:'一站式服务',matters:'办理事项',courses:'课程测评',takeout:'外卖红黑榜',survival:'辛瓜生活经验',handbook:'学生生活手册',freshman:'2026 新生指南',maps:'校园地图',legacy:'原平台资料',问答:'校园事务问答',机构:'校园机构',信息源:'校园信息源',表单:'校园表单',通知公告:'校园通知公告','campus-v2-contest':'校园事务 2.0 · 赛事数据库'}
export const embeddedId=(collection:string)=>'embedded-'+createHash('sha256').update(collection).digest('hex').slice(0,24)
export function embeddedDefinition(collection:string){return {id:embeddedId(collection),name:embeddedLabels[collection]||collection,kind:'EMBEDDED',mounted:collection!=='campus-v2-contest',description:collection==='campus-v2-contest'?'参赛者双版本包，包内标注 v2.2。包含 SQLite 八张表和 Markdown 规则，运营记录为赛事模拟数据。':'平台内嵌资料，启停后同步作用于智能体检索、知识目录与校园导览。',connection:{collection,readOnly:true,simulation:collection==='campus-v2-contest',...(collection==='campus-v2-contest'?{version:'2.2',storage:'SQLite + Markdown',tables:8}:{})}}}
export function embeddedCollectionWhere(collection:string):Prisma.CampusGuideItemWhereInput{return collection==='legacy'?{OR:[{extra:{path:['kb','collection'],equals:Prisma.AnyNull}},{extra:{path:['kb','collection'],equals:''}}]}:{extra:{path:['kb','collection'],equals:collection}}}
export const CONTEST_SQLITE='campus-v2-contest/database/campus.sqlite',CONTEST_MARKDOWN='campus-v2-contest/knowledge',LEGACY_SOURCE='legacy/guide_v4.json'
export const embeddedSourceId=(source:string)=>embeddedId('source:'+source)
export function sourceDefinition(sourceKey:string,collections:string[]){
 const simulation=sourceKey.startsWith('campus-v2-contest/'),sqlite=sourceKey===CONTEST_SQLITE
 return {id:embeddedSourceId(sourceKey),name:sqlite?'校园事务 2.0 · SQLite 数据库':sourceKey===CONTEST_MARKDOWN?'校园事务 2.0 · Markdown 知识库':sourceKey===LEGACY_SOURCE?'原始校园导览索引 · guide_v4.json':sourceKey,kind:'EMBEDDED',mounted:!simulation&&sourceKey!=='ucass_guide_slim.json',description:simulation?'包内版本 v2.2，赛事模拟资料。数据库提供结构化记录，Markdown 提供办理规则。':'按 SRC 原始资料源独立控制；关闭仅停用本资料源的查询与导览。',connection:{sourceKey,sourcePath:sourceKey===LEGACY_SOURCE?'storage/ucass-guide/guide_v4.json':'knowledge/src/'+sourceKey,collections,readOnly:true,simulation,...(simulation?{version:'2.2',storage:sqlite?'SQLite':'Markdown',...(sqlite?{tables:8,sqliteRecords:3755,tableCounts:{aliases:2824,announcements:329,application_windows:16,departments:43,graduation_fixture:240,resource_slots:128,service_outages:18,services:157}}:{markdownFiles:161})}:{}),...(sourceKey==='ucass_guide_slim.json'?{derivedFrom:'ucass_guide.json'}:{})}}
}
export function embeddedSourceWhere(sourceKey:string):Prisma.CampusGuideItemWhereInput{
 if(sourceKey===CONTEST_SQLITE)return {AND:[embeddedCollectionWhere('campus-v2-contest'),{extra:{path:['kb','file'],equals:'database/campus.sqlite'}}]}
 if(sourceKey===CONTEST_MARKDOWN)return {AND:[embeddedCollectionWhere('campus-v2-contest'),{extra:{path:['kb','file'],string_starts_with:'knowledge/'}}]}
 if(sourceKey===LEGACY_SOURCE)return {OR:[{extra:{path:['kb','file'],equals:Prisma.AnyNull}},{extra:{path:['kb','file'],equals:''}}]}
 return {extra:{path:['kb','file'],equals:sourceKey}}
}
