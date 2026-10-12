import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomBytes} from 'node:crypto'
import {PrismaClient} from '@prisma/client'
import bcrypt from 'bcryptjs'
import {chromium} from 'playwright'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..')
for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)) {const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname))
const API='http://127.0.0.1:3001/api',WEB=process.env.KNOWLEDGE_WEB || 'http://127.0.0.1:5173'
const OUT=resolve(root,'storage/shots/knowledge');mkdirSync(OUT,{recursive:true})
const prisma=new PrismaClient(),prefix='ui-knowledge-'+randomBytes(4).toString('hex')
const checks=[],errors=[];let browser,user,agent,baseId,correctionBase
const check=(name)=>{checks.push(name);console.log('PASS '+name)}
async function request(method,path,body,token){const res=await fetch(API+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});const json=await res.json();assert(res.ok&&json.code===0,`${method} ${path}: ${res.status} ${json.message}`);return json.data}
async function pageFor(token,refreshToken,path,userId){const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addInitScript(({token,refreshToken,userId})=>{localStorage.setItem('cagent.accessToken',token);localStorage.setItem('cagent.refreshToken',refreshToken);if(userId)localStorage.setItem('cagent-onboarded-'+userId,'1')},{token,refreshToken,userId});const page=await ctx.newPage();page.on('pageerror',err=>errors.push(err.message));await page.goto(WEB+path,{waitUntil:'domcontentloaded'});return page}
async function main(){
  const admin=await request('POST','/auth/login',{email:process.env.SEED_ADMIN_EMAIL || 'admin@cagent.local',password:process.env.SEED_ADMIN_PASSWORD || 'CHANGE_ME_SEED_ADMIN_PASSWORD'})
  browser=await chromium.launch({headless:true})
  const page=await pageFor(admin.accessToken,admin.refreshToken,'/admin/knowledge')
  await page.getByRole('heading',{name:'知识库与固定问答'}).waitFor({timeout:30000})
  await page.getByRole('button',{name:'添加知识库',exact:true}).click()
  const dialog=page.locator('.el-dialog').filter({hasText:'知识库配置'})
  await dialog.locator('input').first().fill(prefix)
  await dialog.getByRole('button',{name:'保存配置'}).click()
  const card=page.locator('.base-card').filter({hasText:prefix})
  await card.waitFor();await card.getByRole('button',{name:'挂载',exact:true}).click()
  await card.getByText('已挂载',{exact:true}).waitFor()
  baseId=(await request('GET','/knowledge/bases',undefined,admin.accessToken)).find(b=>b.name===prefix).id
  check('管理员真实界面创建知识库并动态挂载')
  await page.screenshot({path:resolve(OUT,'knowledge-admin.png'),fullPage:true})
  await page.setViewportSize({width:390,height:844})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'知识库管理移动端横向溢出')
  await page.screenshot({path:resolve(OUT,'knowledge-admin-mobile.png'),fullPage:true})
  check('知识库管理桌面及移动端布局')
  const readQuestion='知识阅读验证'+prefix
  await request('POST','/knowledge/entries',{baseId,title:readQuestion,question:readQuestion,answer:'## 已审核资料\n联系电话：010-12345678\n这是界面验证内容。',mode:'RAG',status:'APPROVED'},admin.accessToken)
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(WEB+'/campus',{waitUntil:'domcontentloaded'})
  await page.locator('.side-search input').fill(readQuestion)
  await page.getByRole('button',{name:'查一查',exact:true}).click()
  await page.locator('.knowledge-reader').waitFor()
  assert((await page.locator('.knowledge-reader').innerText()).includes('010-12345678'))
  await page.locator('.guided-search').waitFor()
  await page.screenshot({path:resolve(OUT,'guided-knowledge.png'),fullPage:true})
  check('校园导览查询向导与无网页条目的知识阅读')

  const password=randomBytes(16).toString('hex')
  const role=await prisma.role.findUniqueOrThrow({where:{key:'user'}})
  user=await prisma.user.create({data:{email:prefix+'@example.invalid',name:'界面验证账号',passwordHash:await bcrypt.hash(password,10),roles:{create:{roleId:role.id}}}})
  agent=await prisma.agent.create({data:{key:prefix,name:'界面验证 Agent',systemPrompt:'固定答案验证',visibility:'PRIVATE',ownerId:user.id}})
  const cards=[
    {type:'facts',title:'办理信息卡',items:[{label:'办理部门',value:'验证服务台'}]},
    {type:'compare',title:'事项对比卡',columns:['项目','方案一','方案二'],rows:[['材料','身份证','未收录']]},
    {type:'timeline',title:'时间安排卡',items:[{date:'审核后',title:'办理',desc:'查看通知'}]},
    {type:'checklist',title:'准备清单卡',items:[{title:'身份证明',desc:'验证材料'}]},
    {type:'sources',title:'资料来源卡',items:[{id:'S1',title:'验证资料',source:'管理员维护',url:'javascript:alert(1)'},{id:'S2',title:'安全来源',source:'校方门户',url:'https://info.ucass.edu.cn'}]}
  ]
  const answer=cards.map(card=>'```card\n'+JSON.stringify(card)+'\n```').join('\n\n')
  const q='界面验证固定问题'+prefix
  await request('POST','/knowledge/entries',{baseId,title:q,question:q,answer,mode:'FIXED',status:'APPROVED'},admin.accessToken)
  const student=await request('POST','/auth/login',{email:user.email,password})
  const conv=await prisma.conversation.create({data:{userId:user.id,agentId:agent.id,title:prefix}})
  await prisma.message.create({data:{conversationId:conv.id,userId:user.id,role:'user',content:q,seq:1}})
  const reply=await prisma.message.create({data:{conversationId:conv.id,userId:user.id,role:'assistant',content:answer,seq:2}})
  const studentPage=await pageFor(student.accessToken,student.refreshToken,'/student',user.id)
  await studentPage.locator('.knowledge-card').first().waitFor({timeout:30000})
  assert.equal(await studentPage.locator('.knowledge-card').count(),5)
  assert.equal(await studentPage.locator('.knowledge-card a[href^="javascript:"]').count(),0)
  assert.equal(await studentPage.locator('.knowledge-card a[href="https://info.ucass.edu.cn/"]').count(),1)
  const box=studentPage.locator('.knowledge-card[data-layout="checklist"] input[type="checkbox"]')
  await box.check();assert(await box.isChecked())
  check('五种知识卡片渲染、清单交互、非法来源链接过滤')
  await studentPage.screenshot({path:resolve(OUT,'knowledge-cards-desktop.png'),fullPage:true})
  await studentPage.setViewportSize({width:390,height:844})
  await studentPage.waitForFunction(()=>document.querySelector('.st-side')?.getBoundingClientRect().right<0)
  await studentPage.locator('.knowledge-card').first().scrollIntoViewIfNeeded()
  assert(await studentPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'学生卡片移动端横向溢出')
  await studentPage.screenshot({path:resolve(OUT,'knowledge-cards-mobile.png'),fullPage:true})
  check('学生知识卡片移动端布局无横向溢出')

  await studentPage.getByRole('button',{name:'回答没帮助',exact:true}).last().click()
  const feedbackDialog=studentPage.locator('.el-dialog').filter({hasText:'点踩反馈'})
  await feedbackDialog.locator('textarea').fill('管理员审核后的固定纠错答案')
  const feedbackResponse=studentPage.waitForResponse(r=>r.url().endsWith('/learning/feedback')&&r.request().method()==='POST')
  await feedbackDialog.getByRole('button',{name:'提交反馈'}).click()
  const feedbackResult=await (await feedbackResponse).json()
  assert.equal(feedbackResult.code,0,feedbackResult.message)
  const feedback=await prisma.messageFeedback.findFirstOrThrow({where:{messageId:reply.id,userId:user.id}})
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(WEB+'/admin/learning',{waitUntil:'domcontentloaded'})
  const queue=page.locator('.feedback-queue');await queue.waitFor()
  const feedbackRow=queue.locator('.el-table__row').filter({hasText:q})
  await feedbackRow.getByRole('button',{name:'纠正并固定'}).click()
  const correctDialog=page.locator('.el-dialog').filter({hasText:'注入正确答案'})
  await correctDialog.getByRole('button',{name:'发布纠错'}).click()
  await page.getByText('纠错已发布',{exact:true}).waitFor()
  const corrected=await prisma.knowledgeEntry.findFirstOrThrow({where:{base:{agentId:agent.id},mode:'CORRECTION',question:q}})
  correctionBase=corrected.baseId
  assert.equal((await prisma.messageFeedback.findUniqueOrThrow({where:{id:feedback.id}})).resolution,'RESOLVED')
  check('学生点踩附建议答案，管理员反馈队列发布并固定纠错')
  await page.screenshot({path:resolve(OUT,'feedback-learning.png'),fullPage:true})
  const sse=await fetch(API+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+student.accessToken},body:JSON.stringify({conversationId:conv.id,content:q})}).then(r=>r.text())
  assert(sse.includes('管理员审核后的固定纠错答案')&&sse.includes('fixed_answer')&&sse.includes('"totalTokens":0'))
  check('真实 HTTP 聊天命中管理员纠错，零模型 token')
  const forbidden=await fetch(API+'/knowledge/bases',{headers:{Authorization:'Bearer '+student.accessToken}})
  assert.equal(forbidden.status,403)
  check('学生无法访问数据库配置和管理接口')
  assert.equal(errors.length,0,JSON.stringify(errors))
  writeFileSync(resolve(root,'knowledge/dist/ui-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,screenshots:OUT,errors},null,2))
}
try {await main()} catch(err){console.error(err);process.exitCode=1}
finally {
  await browser?.close()
  if(baseId)await prisma.knowledgeBase.deleteMany({where:{id:{in:[baseId,...(correctionBase?[correctionBase]:[])]}}})
  if(user){await prisma.auditLog.deleteMany({where:{userId:user.id}});await prisma.user.delete({where:{id:user.id}})}
  if(agent)await prisma.agent.delete({where:{id:agent.id}})
  await prisma.$disconnect()
}
