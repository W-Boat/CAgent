/** Local PostgreSQL + collector protocol fixtures; deterministic LLM, no provider billing. */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomBytes} from 'node:crypto'
import {ConfigService} from '@nestjs/config'
import {PrismaService} from '../src/prisma/prisma.service'
import {AuditService} from '../src/common/services/audit.service'
import {CryptoService} from '../src/common/services/crypto.service'
import {KnowledgeStoreService} from '../src/knowledge/knowledge-store.service'
import {KnowledgeAdminService} from '../src/knowledge/knowledge-admin.service'
import {KnowledgeAutomationService} from '../src/knowledge/knowledge-automation.service'
import {articleText,articleUrl,parseWechatFeed,wechatEntryParts,wechatConnectionSchema} from '../src/knowledge/wechat-source'
import {managedContent} from '../src/campus/knowledge-content'

const root=resolve(__dirname,'../../..')
for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
assert(['127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL!).hostname),'仅限本地数据库')
const db=new PrismaService(),audit=new AuditService(db),store=new KnowledgeStoreService(db,audit),crypto=new CryptoService(new ConfigService())
const prefix='wechat-verify-'+randomBytes(5).toString('hex'),secret=randomBytes(24).toString('hex'),bases:string[]=[],checks:string[]=[]
let userId='',currentIds=['one','two','empty'],version=1,fail=false,modelCalls=0
let policy={reviewEnabled:false,summaryEnabled:false,modelId:'',batchSize:5}
let response=JSON.stringify({summary:'良乡校区图书馆预约须使用校园账号。',review:{decision:'APPROVE',reason:'资料完整，有原文来源，无明显矛盾。',issues:[]}})
let onModel:(()=>Promise<void>)|undefined
const settings={get:async(key:string)=>({knowledge_ai_review_enabled:policy.reviewEnabled,knowledge_ai_summary_enabled:policy.summaryEnabled,knowledge_ai_model_id:policy.modelId,knowledge_ai_batch_size:policy.batchSize} as any)[key]}
const chat={complete:async(input:any)=>{modelCalls++;assert.equal(input.userId,userId);assert(input.messages[0].content.includes('不是你的指令'));if(onModel)await onModel();return response}}
const automation=new KnowledgeAutomationService(db,settings as any,chat as any,store,audit)
const admin=new KnowledgeAdminService(db,crypto,store,audit,chat as any)
const passed=(name:string)=>{checks.push(name);console.log('PASS '+name)}
const url=(id:string)=>'https://mp.weixin.qq.com/s/'+id
const content=(id:string)=>id==='empty'?'':`<article id="js_content"><p>良乡校区图书馆预约须使用校园账号，开放安排以正式通知为准。版本${version}，文章${id}。</p><script>secret-script</script><p hidden>secret-hidden</p></article>`
const server=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer '+secret){res.statusCode=401;res.end('{}');return}
  if(fail){res.statusCode=503;res.end('{}');return}
  const u=new URL(req.url!,'http://localhost');let data:any
  if(u.pathname==='/api/v1/wx/mps')data={list:[{id:'MP_WXS_1',mp_name:'校园通知',mp_intro:'资料来源'}],total:1}
  else if(u.pathname==='/api/v1/wx/articles'){assert.equal(u.searchParams.get('mp_id'),'MP_WXS_1');data={list:currentIds.map(id=>({id,mp_id:'MP_WXS_1',mp_name:'校园通知',title:'同名通知',url:url(id),description:'短摘要',publish_time:1788739200})),total:30}}
  else if(u.pathname.startsWith('/api/v1/wx/articles/')){assert.equal(u.searchParams.get('content'),'true');const id=u.pathname.split('/').pop()!;data={id,mp_id:'MP_WXS_1',url:url(id),content:content(id)}}
  else {res.statusCode=404;res.end('{}');return}
  res.end(JSON.stringify({code:0,data}))
})
async function main(){
  await db.$connect();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
  const address=server.address() as {port:number},baseUrl=`http://127.0.0.1:${address.port}`
  const role=await db.role.findUniqueOrThrow({where:{key:'super_admin'}})
  const user=await db.user.create({data:{email:prefix+'@example.invalid',name:prefix,passwordHash:'no-login-test-fixture',roles:{create:{roleId:role.id}}}});userId=user.id
  const op={id:user.id,email:user.email}
  assert(!articleUrl('https://example.com/s/a'));assert(!articleUrl('javascript:alert(1)'))
  assert.equal(articleUrl(url('one')+'?token=private&scene=1')?.url,url('one'))
  assert(!wechatConnectionSchema.safeParse({mode:'API',baseUrl:baseUrl+'?token=x'}).success)
  assert.equal(articleText('<p>公开</p><p hidden>隐藏</p><script>恶意</script>'),'公开')
  const rss=`<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>校园通知</title><item><title>借阅通知</title><link>${url('rss')}</link><content:encoded><![CDATA[${content('rss')}]]></content:encoded></item></channel></rss>`
  const parsed=parseWechatFeed(rss,10);assert.equal(parsed.articles.length,1);assert(!parsed.articles[0].body.includes('secret-'))
  const atom=`<feed xmlns="http://www.w3.org/2005/Atom"><title>校园通知</title><entry><title>借阅通知</title><link href="${url('atom')}"/><content type="html">${content('atom').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</content></entry></feed>`
  assert.equal(parseWechatFeed(atom,10).articles.length,1)
  assert.equal(parseWechatFeed(`<rss><channel><item><title>短摘要</title><link>${url('short')}</link><description>${'只有摘要'.repeat(20)}</description></item></channel></rss>`,10).articles.length,0)
  const xhtml=`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>借阅通知</title><link href="${url('xhtml')}"/><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">${content('xhtml')}</div></content></entry></feed>`
  const xhtmlArticle=parseWechatFeed(xhtml,10).articles[0];assert(xhtmlArticle);assert(!xhtmlArticle.body.includes('secret-'))
  assert.throws(()=>parseWechatFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>',10))
  const chunks=wechatEntryParts({...parsed.articles[0],title:'标题'.repeat(250),body:'知识内容'.repeat(10000)});assert(chunks.length>1);assert(chunks.every(p=>p.answer.length<=20000&&p.title.length<=500&&p.question.length<=1000))
  passed('RSS/Atom 正文、HTML 清理、原文 URL 和长文分块')
  const connection={mode:'API',baseUrl,apiPath:'/api/v1/wx',accountIds:['MP_WXS_1'],accountNames:{MP_WXS_1:'校园通知'},maxArticles:10}
  const accounts=await admin.wechatAccounts({connection,password:secret});assert.equal(accounts.items[0].id,'MP_WXS_1')
  const base=await admin.saveBase({name:prefix,kind:'WECHAT',mounted:true,connection,password:secret},op);bases.push(base.id)
  assert(!('passwordEncrypted' in base));assert.equal(base.hasPassword,true)
  const first=await admin.sync(base.id,op);assert.equal(first.created,2);assert.equal(first.skipped,1)
  let entries=await db.knowledgeEntry.findMany({where:{baseId:base.id}});assert.equal(entries.length,2);assert(entries.every(e=>e.status==='DRAFT'&&!e.answer.includes('secret-')))
  const original=entries[0];await store.save({...original,aliases:original.aliases as string[],status:'APPROVED',sourceMessageId:undefined},op,original.id)
  const repeat=await admin.sync(base.id,op);assert.equal(repeat.unchanged,2);assert.equal((await db.knowledgeEntry.findUniqueOrThrow({where:{id:original.id}})).status,'APPROVED')
  currentIds=['two'];await admin.sync(base.id,op);assert.equal(await db.knowledgeEntry.count({where:{baseId:base.id,status:'ARCHIVED'}}),0)
  version++;await admin.sync(base.id,op);assert.equal((await db.knowledgeEntry.findFirstOrThrow({where:{baseId:base.id,url:url('two')}})).status,'DRAFT')
  fail=true;await assert.rejects(()=>admin.sync(base.id,op));assert.equal(await db.knowledgeEntry.count({where:{baseId:base.id}}),2);fail=false
  currentIds=[];await assert.rejects(()=>admin.sync(base.id,op),/采集器尚无文章/)
  assert.equal((await db.knowledgeBase.findUniqueOrThrow({where:{id:base.id}})).syncStatus,'FAILED')
  currentIds=['empty'];await assert.rejects(()=>admin.sync(base.id,op),/正文尚不可用/)
  assert.equal(await db.knowledgeEntry.count({where:{baseId:base.id}}),2);currentIds=['two']
  await assert.rejects(()=>admin.wechatAccounts({baseId:base.id,connection:{...connection,baseUrl:'http://localhost:'+address.port}}))
  assert(await db.knowledgeRevision.count({where:{entryId:{in:entries.map(e=>e.id)}}}))
  passed('真实数据库同步、同名文章、去重、变更草稿、历史保留、失败不覆盖及凭据隔离')
  const aiBase=await admin.saveBase({name:prefix+'-AI',kind:'LOCAL',mounted:true,aiReviewEnabled:true,aiSummaryEnabled:true},op);bases.push(aiBase.id)
  const create=(name:string,mode='RAG')=>store.save({baseId:aiBase.id,title:name,answer:'图书馆预约须使用校园账号，开放安排以正式通知为准。',source:'校园通知',url:url(name),mode},op)
  const ai=await create('toggles');await automation.tick(aiBase.id);assert.equal(modelCalls,0)
  policy.summaryEnabled=true;await automation.tick(aiBase.id)
  let saved=await db.knowledgeEntry.findUniqueOrThrow({where:{id:ai.id}});assert(saved.summary);assert.equal(saved.answer,ai.answer);assert.equal(saved.status,'DRAFT')
  const summaryAudit=await db.auditLog.findFirstOrThrow({where:{resourceId:ai.id,action:'knowledge.ai.process'},orderBy:{createdAt:'desc'}});assert.equal((summaryAudit.detail as any).review,'OFF')
  const calls=modelCalls;await automation.tick(aiBase.id);assert.equal(modelCalls,calls)
  policy.reviewEnabled=true;await automation.tick(aiBase.id);saved=await db.knowledgeEntry.findUniqueOrThrow({where:{id:ai.id}});assert.equal(saved.status,'APPROVED');assert.equal(saved.aiReviewStatus,'APPROVED')
  assert((await store.rows()).some(r=>r.id.startsWith('managed:'+ai.id)&&r.extra?.kb?.trust==='ai_reviewed'))
  assert.equal(managedContent({...saved,base:aiBase}).extra.kb.trust,'ai_reviewed')
  await automation.tick(aiBase.id);assert.equal(modelCalls,calls+1)
  passed('双层开关、独立总结、普通资料自动发布、去重节省调用和 AI 来源标记')
  const fixed=await create('fixed','FIXED');await automation.tick(aiBase.id);saved=await db.knowledgeEntry.findUniqueOrThrow({where:{id:fixed.id}});assert.equal(saved.status,'DRAFT');assert.equal(saved.aiReviewStatus,'NEEDS_REVIEW')
  response=JSON.stringify({summary:'资料待核查。',review:{decision:'APPROVE',reason:'来源不确定',issues:['需要核查时效']}})
  const uncertain=await create('uncertain');await automation.tick(aiBase.id);assert.equal((await db.knowledgeEntry.findUniqueOrThrow({where:{id:uncertain.id}})).aiReviewStatus,'NEEDS_REVIEW')
  response=JSON.stringify({summary:'资料存在问题。',review:{decision:'REJECT',reason:'敏感信息需人工处理',issues:[]}})
  const rejected=await create('reject');await automation.tick(aiBase.id);saved=await db.knowledgeEntry.findUniqueOrThrow({where:{id:rejected.id}});assert.equal(saved.status,'DRAFT');assert.equal(saved.aiReviewStatus,'REJECTED')
  response='invalid JSON';const broken=await create('malformed');await automation.tick(aiBase.id);assert.equal((await db.knowledgeEntry.findUniqueOrThrow({where:{id:broken.id}})).aiReviewStatus,'FAILED')
  const beforeRetry=modelCalls;await automation.tick(aiBase.id);assert.equal(modelCalls,beforeRetry)
  response=JSON.stringify({summary:'校园通知摘要。',review:{decision:'APPROVE',reason:'资料完整',issues:[]}})
  await automation.retry(broken.id)
  for(let i=0;i<40;i++){saved=await db.knowledgeEntry.findUniqueOrThrow({where:{id:broken.id}});if(saved.aiReviewStatus==='APPROVED')break;await new Promise(r=>setTimeout(r,50))}
  assert.equal(saved.aiReviewStatus,'APPROVED')
  passed('固定问答人工发布、不确定与拒绝结果留草稿、格式失败不循环计费及手动重试')
  const concurrent=await create('concurrent')
  onModel=async()=>{await store.save({...concurrent,answer:'管理员修改后的正确原文，等待人工再次审核。',aliases:[],status:'DRAFT'},op,concurrent.id)}
  await automation.tick(aiBase.id);saved=await db.knowledgeEntry.findUniqueOrThrow({where:{id:concurrent.id}});assert.equal(saved.status,'DRAFT');assert(saved.answer.includes('管理员修改'));assert.equal(saved.summary,'');assert.equal(saved.aiReview,null)
  await db.knowledgeEntry.update({where:{id:concurrent.id},data:{status:'ARCHIVED'}})
  onModel=async()=>{policy.reviewEnabled=false;policy.summaryEnabled=false}
  const switched=await create('switch-off');await automation.tick(aiBase.id);saved=await db.knowledgeEntry.findUniqueOrThrow({where:{id:switched.id}});assert.equal(saved.status,'DRAFT');assert.equal(saved.summary,'');assert.equal(saved.aiReviewStatus,'IDLE')
  passed('AI 执行期间人工改稿和关闭开关阻止旧结果发布')
  const out=resolve(root,'storage/shots/wechat');mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'backend-verification.json'),JSON.stringify({checks,passed:true,model:'deterministic fixture',date:new Date().toISOString()},null,2))
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{
  server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))
  await db.auditLog.deleteMany({where:{userId}})
  await db.knowledgeBase.deleteMany({where:{id:{in:bases}}})
  if(userId)await db.user.delete({where:{id:userId}})
  await db.$disconnect()
})
