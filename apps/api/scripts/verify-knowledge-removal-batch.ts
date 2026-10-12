import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomBytes} from 'node:crypto'
import {ConfigService} from '@nestjs/config'
import {PrismaService} from '../src/prisma/prisma.service'
import {AuditService} from '../src/common/services/audit.service'
import {CryptoService} from '../src/common/services/crypto.service'
import {KnowledgeStoreService} from '../src/knowledge/knowledge-store.service'
import {KnowledgeAdminService} from '../src/knowledge/knowledge-admin.service'
import {collectorBatchResult} from '../src/knowledge/wechat-collector'
import {sourceDefinition} from '../src/knowledge/embedded-knowledge'
const root=resolve(__dirname,'../../..')
for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
assert(['127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL!).hostname),'Only local test database')
const db=new PrismaService(),audit=new AuditService(db),store=new KnowledgeStoreService(db,audit),crypto=new CryptoService(new ConfigService()),admin=new KnowledgeAdminService(db,crypto,store,audit,{} as any)
const prefix='remove-batch-'+randomBytes(5).toString('hex'),sourceKey=prefix+'.md',batchId='a'.repeat(32),ids:string[]=[]
let userId='',guideId='',accounts=[{index:0,id:'MP_WXS_99100001',name:prefix+'公众号',status:'SUCCEEDED'},{index:1,id:'MP_WXS_99100001',name:'重复同号',status:'EXISTING'},{index:2,name:'失败项',status:'FAILED'}]
const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');const data=req.url?.endsWith('/auth/login')?{access_token:'fixture-token',expires_in:3600}:{id:batchId,status:'PARTIAL',items:accounts,cookie:'private-token'};res.end(JSON.stringify({code:0,data}))})
async function main(){
 await db.$connect();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.WECHAT_COLLECTOR_URL='http://127.0.0.1:'+(server.address() as any).port
 const role=await db.role.findUniqueOrThrow({where:{key:'super_admin'}}),user=await db.user.create({data:{email:prefix+'@example.invalid',name:prefix,passwordHash:'no-login-fixture',roles:{create:{roleId:role.id}}}});userId=user.id;const op={id:userId,email:user.email}
 const base=await admin.saveBase({name:prefix+' · 完整名称',kind:'LOCAL',mounted:true,aiReviewEnabled:false,aiSummaryEnabled:false},op);ids.push(base.id)
 const entry=await store.save({baseId:base.id,title:'验证固定回答',answer:'仅用于本地隔离测试',mode:'FIXED',status:'APPROVED'},op)
 await assert.rejects(()=>admin.removeBase(base.id,base.name+' ',op),/完全一致/)
 assert.equal((await db.knowledgeBase.findUniqueOrThrow({where:{id:base.id}})).mounted,true)
 await db.knowledgeBase.update({where:{id:base.id},data:{syncStatus:'SYNCING'}})
 await assert.rejects(()=>admin.removeBase(base.id,base.name,op),/正在同步/)
 await db.knowledgeBase.update({where:{id:base.id},data:{syncStatus:'IDLE'}})
 await admin.removeBase(base.id,base.name,op)
 const removed=await db.knowledgeBase.findUniqueOrThrow({where:{id:base.id}});assert.equal(removed.kind,'REMOVED');assert.equal(removed.mounted,false);assert.equal(await db.knowledgeEntry.count({where:{id:entry.id}}),1)
 assert(!(await store.rows()).some(r=>r.id.includes(entry.id)))
 await assert.rejects(()=>admin.mount(base.id,true,op),/已移除/);await assert.rejects(()=>admin.saveBase({name:base.name,kind:'LOCAL'},op,base.id),/已移除/)
 await assert.rejects(()=>store.save({baseId:base.id,title:'误恢复',answer:'无效'},op),/已移除/)
 console.log('PASS exact-name confirmation, active sync guard, hidden retrieval and retained history, no remount or edit resurrection')
 const definition=sourceDefinition(sourceKey,['remove-fixture']);ids.push(definition.id)
 const guide=await db.campusGuideItem.create({data:{externalId:1800000000+Math.floor(Math.random()*1000000),title:prefix,source:'fixture',cat:'fixture',type:'知识',url:'',summaryShort:'本地测试内嵌来源',searchText:prefix,detailStatus:'basic',detail:'隔离内嵌来源，仅用于验证移除',extra:{kb:{file:sourceKey,collection:'remove-fixture'}}}});guideId=guide.id
 await store.ensureEmbedded();assert.equal(await store.embeddedEnabled('remove-fixture'),true)
 await admin.removeBase(definition.id,definition.name,op);await store.ensureEmbedded()
 assert.equal((await db.knowledgeBase.findUniqueOrThrow({where:{id:definition.id}})).kind,'REMOVED');assert.equal(await store.embeddedEnabled('remove-fixture'),false)
 assert.equal(await db.campusGuideItem.count({where:{AND:[{id:guide.id},await store.embeddedWhere()]}}),0)
 assert(!(await admin.bases()).some(b=>ids.includes(b.id)))
 console.log('PASS removed embedded source stays removed after refresh and is excluded from guide queries')
 assert(!JSON.stringify(collectorBatchResult({id:batchId,status:'PARTIAL',items:accounts,token:'private'})).includes('private'))
 const result=await admin.attachWechatBatch(batchId,op);assert.equal(result.created,1);assert.equal(result.existing,1);ids.push(result.items[0].baseId!)
 const linked=await db.knowledgeBase.findUniqueOrThrow({where:{id:result.items[0].baseId!}});assert.equal(linked.mounted,false);assert.equal(linked.aiReviewEnabled,false);assert.equal(linked.aiSummaryEnabled,false);assert.equal((linked.connection as any).autoSync,true)
 await db.knowledgeBase.update({where:{id:linked.id},data:{mounted:true,aiReviewEnabled:true}})
 assert.equal((await admin.attachWechatBatch(batchId,op)).created,0);assert.equal((await db.knowledgeBase.findUniqueOrThrow({where:{id:linked.id}})).aiReviewEnabled,true)
 console.log('PASS partial batch attachment, per-account dedup, idempotency and existing configuration preservation')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
 if(ids.length){await db.knowledgeRevision.deleteMany({where:{entry:{baseId:{in:ids}}}});await db.knowledgeEntry.deleteMany({where:{baseId:{in:ids}}});await db.knowledgeBase.deleteMany({where:{id:{in:ids}}})}
 if(guideId)await db.campusGuideItem.deleteMany({where:{id:guideId}})
 if(userId){await db.auditLog.deleteMany({where:{userId}});await db.user.deleteMany({where:{id:userId}})}
 await db.$disconnect();server.close()
})
