import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {PrismaService} from '../src/prisma/prisma.service'
import {AuditService} from '../src/common/services/audit.service'
import {KnowledgeStoreService} from '../src/knowledge/knowledge-store.service'
import {KnowledgeAdminService} from '../src/knowledge/knowledge-admin.service'
import {CampusGuideService} from '../src/campus/campus-guide.service'
import {embeddedSourceId,CONTEST_SQLITE,CONTEST_MARKDOWN} from '../src/knowledge/embedded-knowledge'
const root=resolve(__dirname,'../../..');for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname))
const db=new PrismaService(),audit=new AuditService(db),store=new KnowledgeStoreService(db,audit),guide=new CampusGuideService(db,store),admin=new KnowledgeAdminService(db,{} as any,store,audit,{} as any);let states:{id:string;mounted:boolean}[]=[]
const checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
async function main(){
 const bases=await admin.bases(),sources=bases.filter(b=>b.kind==='EMBEDDED');states=sources.map(b=>({id:b.id,mounted:b.mounted}))
 const get=(key:string)=>sources.find(b=>b.id===embeddedSourceId(key))!
 const sql=get(CONTEST_SQLITE),md=get(CONTEST_MARKDOWN),book=get('UCASSbook_RAG.json'),pages=sources.filter(b=>/^pages_/.test((b.connection as any).sourceKey))
 assert.equal(pages.length,6);assert(sql&&md&&book);assert.equal(sql._count.entries,3755);assert.equal(md._count.entries,161);assert.equal(sql.mounted,false);assert.equal(md.mounted,false)
 assert(sources.some(b=>(b.connection as any).sourceKey==='榜题1-行知校园——校园事务智能导办Agent.xlsx'));assert(!bases.some(b=>b.kind==='EMBEDDED_GROUP'))
 pass('按 SRC 原始文件独立注册，六份新生页文档单独开关，旧类别库退出列表')
 const sqlRows=await store.embeddedEntries(sql,'','',1,'application_windows');assert.equal(sqlRows.total,16);assert.equal(sqlRows.sections.length,8);assert(sqlRows.items.every((r:any)=>r.answer.includes('application_windows')))
 const mdRows=await store.embeddedEntries(md,'','',1,'knowledge/ST-01.md');assert.equal(mdRows.total,1);assert.equal(mdRows.sections.length,161);assert(mdRows.items[0].answer.includes('课前申请'))
 await assert.rejects(()=>store.embeddedEntries(sql,'','',1,'knowledge/ST-01.md'),/不存在/)
 pass('SQLite 按八张表、Markdown 按161个原始文件浏览，两库内容与数量互不混淆')
 const user=await db.user.findFirstOrThrow({where:{email:process.env.SEED_ADMIN_EMAIL}}),op={id:user.id,email:user.email}
 await admin.mount(md.id,true,op);let found=await guide.search('学生请假','full',5,{collection:'campus-v2-contest'});assert(found.hits.length&&found.hits.every(h=>h.provenance?.file!=='database/campus.sqlite'))
 await admin.mount(sql.id,true,op);await admin.mount(md.id,false,op);found=await guide.search('模拟研讨室1','full',5,{collection:'campus-v2-contest'});assert(found.hits.length&&found.hits.every(h=>h.provenance?.file==='database/campus.sqlite'))
 await admin.mount(sql.id,false,op);assert.equal((await guide.search('学生请假','full',5,{collection:'campus-v2-contest'})).hits.length,0)
 pass('SQLite 与 Markdown 独立启停，资料关联不穿透已关闭源')
 await admin.mount(book.id,false,op);assert.equal((await guide.search('超市','full',5,{collection:'handbook'})).hits.length,0)
 for(const p of pages)await admin.mount(p.id,true,op)
 await admin.mount(pages[0].id,false,op);const active=(await guide.library({collection:'freshman'},true));assert(active.total>0);assert(active.items.every((r:any)=>r.provenance.file!==(pages[0].connection as any).sourceKey))
 pass('同类别的 SRC 文件独立开关，关闭其中一个不关闭其他文件')
 const full=get('ucass_guide.json'),slim=get('ucass_guide_slim.json');assert.equal(slim.mounted,false);await admin.mount(full.id,true,op);await admin.mount(slim.id,true,op)
 let portal=(await guide.library({collection:'portal',pageSize:100},true));assert(portal.items.every((r:any)=>r.provenance.file!=='ucass_guide_slim.json'))
 await admin.mount(full.id,false,op);portal=await guide.library({collection:'portal',pageSize:100},true);assert(portal.items.some((r:any)=>r.provenance.file==='ucass_guide_slim.json'))
 pass('完整版与精简版同源去重，完整源关闭后精简源仍可独立查询')
 for(const state of states)await admin.mount(state.id,false,op)
 assert.equal((await guide.meta()).total,0);assert((await guide.collections()).every(c=>c.value.startsWith('base:')))
 pass('全部资料源关闭后不回落旧类别库或原平台快照')
 writeFileSync(resolve(root,'knowledge/dist/source-library-verification.json'),JSON.stringify({passed:true,checks,sources:sources.map(b=>({source:(b.connection as any).sourceKey,count:b._count.entries})),checkedAt:new Date().toISOString()},null,2))
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{for(const s of states)await db.knowledgeBase.update({where:{id:s.id},data:{mounted:s.mounted}});await store.bump();await db.$disconnect()})
