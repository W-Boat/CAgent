import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {PrismaService} from '../src/prisma/prisma.service'
import {AuditService} from '../src/common/services/audit.service'
import {KnowledgeStoreService} from '../src/knowledge/knowledge-store.service'
import {sourceDefinition} from '../src/knowledge/embedded-knowledge'
import {foodSource} from '../src/knowledge/food-catalog'
import {shortcutSettingPrefix,shortcutBindingsSchema} from '../src/knowledge/knowledge-shortcuts'
const root=resolve(__dirname,'../../..')
for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname),'Local fixtures only')
const db=new PrismaService(),store=new KnowledgeStoreService(db,new AuditService(db)),owned:string[]=[]
let userId=''
async function main(){try{
 await db.$connect();await store.ensureEmbedded()
 const user=await db.user.create({data:{email:'shortcuts-'+Date.now()+'@example.invalid',name:'Shortcut fixture',passwordHash:'no-login'}});userId=user.id
 const base=await db.knowledgeBase.create({data:{name:'快捷按钮夹具',kind:'LOCAL',mounted:true,connection:{passwordEncrypted:'must-not-be-public',host:'private-db'}}});owned.push(base.id)
 const dependency=await db.knowledgeBase.create({data:{name:'依赖夹具',kind:'LOCAL',mounted:true}});owned.push(dependency.id)
 const initial=[{label:'自定义入口',question:'请查找测试资料',enabled:true,dependencies:[dependency.id]}]
 await store.saveShortcutBindings(base.id,initial,user);assert.deepEqual(await store.shortcutBindings(base.id),initial)
 let buttons=await store.publicShortcuts();assert(buttons.some(b=>b.question===initial[0].question));assert(!JSON.stringify(buttons).includes('private-db'));assert(!JSON.stringify(buttons).includes('password'))
 await db.knowledgeBase.update({where:{id:dependency.id},data:{mounted:false}});assert(!(await store.publicShortcuts()).some(b=>b.question===initial[0].question))
 await db.knowledgeBase.update({where:{id:dependency.id},data:{mounted:true}});assert((await store.publicShortcuts()).some(b=>b.question===initial[0].question))
 await db.knowledgeBase.update({where:{id:base.id},data:{mounted:false}});assert(!(await store.publicShortcuts()).some(b=>b.question===initial[0].question))
 await db.knowledgeBase.update({where:{id:base.id},data:{mounted:true}})
 await store.saveShortcutBindings(base.id,[{...initial[0],enabled:false}],user);assert(!(await store.publicShortcuts()).some(b=>b.question===initial[0].question))
 await store.saveShortcutBindings(base.id,[],user);assert.deepEqual(await store.shortcutBindings(base.id),[])
 await assert.rejects(()=>store.saveShortcutBindings(base.id,[{...initial[0],dependencies:['missing-base']}],user))
 await assert.rejects(()=>store.saveShortcutBindings(base.id,[initial[0],initial[0]],user))
 assert(!shortcutBindingsSchema.safeParse([{...initial[0],html:'<script>'}]).success)
 await store.saveShortcutBindings(base.id,initial,user);await db.knowledgeBase.update({where:{id:base.id},data:{kind:'REMOVED',mounted:false}});assert(!(await store.publicShortcuts()).some(b=>b.question===initial[0].question));await assert.rejects(()=>store.saveShortcutBindings(base.id,initial,user))
 const foodBase=await db.knowledgeBase.findUniqueOrThrow({where:{id:sourceDefinition(foodSource,['takeout']).id}})
 try{await db.knowledgeBase.update({where:{id:foodBase.id},data:{mounted:false}});buttons=await store.publicShortcuts();assert(!buttons.some(b=>['外卖红黑榜','今天吃什么'].includes(b.label)))}finally{await db.knowledgeBase.update({where:{id:foodBase.id},data:{mounted:foodBase.mounted}})}
 const report={passed:true,checkedAt:new Date().toISOString(),checks:['真实 PostgreSQL 保存和恢复读取','主库/依赖库/按钮开关与移除过滤','空配置不恢复默认按钮','同名/未知依赖/额外字段拒绝','公共响应仅 id/label/question，无连接凭据','关闭红榜同时隐藏选餐与红榜默认按钮'],scope:'Only owned local fixtures; original source switch restored; no external model calls'}
 mkdirSync(resolve(root,'storage/shots/shortcuts'),{recursive:true});writeFileSync(resolve(root,'storage/shots/shortcuts/backend-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{for(const id of owned){await db.setting.deleteMany({where:{key:shortcutSettingPrefix+id}});await db.knowledgeBase.deleteMany({where:{id}})}if(userId){await db.auditLog.deleteMany({where:{userId}});await db.user.deleteMany({where:{id:userId}})}await db.$disconnect()}}
main().catch(e=>{console.error(e);process.exitCode=1})
