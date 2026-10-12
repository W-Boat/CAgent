import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomBytes} from 'node:crypto'
import {PrismaClient} from '@prisma/client'
import {chromium} from 'playwright'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..')
for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
assert(['127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL).hostname))
const db=new PrismaClient(),API='http://127.0.0.1:3002/api',WEB='http://127.0.0.1:4173',prefix='wechat-ui-'+randomBytes(5).toString('hex'),checks=[],errors=[],keys=['knowledge_ai_review_enabled','knowledge_ai_summary_enabled','knowledge_ai_model_id','knowledge_ai_batch_size']
const out=resolve(root,'storage/shots/wechat');mkdirSync(out,{recursive:true})
let browser,base,entry,originalSettings,adminId,startedAt
async function request(method,path,body,token,expected=200){const res=await fetch(API+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const json=await res.json();if(expected!==200){assert.equal(res.status,expected);return json}assert(res.ok&&json.code===0,`${path}: ${res.status} ${json.message}`);return json.data}
const pass=name=>{checks.push(name);console.log('PASS '+name)}
async function main(){
  assert.equal(await db.knowledgeBase.count({where:{OR:[{aiReviewEnabled:true},{aiSummaryEnabled:true}]}}),0,'验证前请关闭本地其他单库 AI 开关')
  originalSettings=await db.setting.findMany({where:{key:{in:keys}}});startedAt=new Date()
  const login=await request('POST','/auth/login',{email:process.env.SEED_ADMIN_EMAIL||'admin@cagent.local',password:process.env.SEED_ADMIN_PASSWORD||'CHANGE_ME_SEED_ADMIN_PASSWORD'})
  const me=await request('GET','/auth/me',undefined,login.accessToken);adminId=me.id
  await request('PUT','/knowledge/automation/policy',{reviewEnabled:'false',summaryEnabled:false},login.accessToken,400)
  await request('PUT','/knowledge/automation/policy',{reviewEnabled:false,summaryEnabled:false,modelId:'',batchSize:2},login.accessToken)
  await request('GET','/knowledge/automation/policy',undefined,undefined,401)
  pass('真实接口鉴权与字符串开关拒绝')
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}})
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(({access,refresh})=>{localStorage.setItem('cagent.accessToken',access);localStorage.setItem('cagent.refreshToken',refresh)},{access:login.accessToken,refresh:login.refreshToken})
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(u.origin===WEB)await route.continue({url:API+u.pathname.slice(4)+u.search});else await route.continue()})
  await page.goto(WEB+'/admin/knowledge',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'知识库与固定问答'}).waitFor()
  await page.getByRole('button',{name:'添加知识库',exact:true}).click();const dialog=page.locator('.el-dialog').filter({hasText:'知识库配置'})
  await dialog.locator('input').first().fill(prefix)
  await dialog.locator('.el-form-item').filter({hasText:'数据来源'}).locator('.el-select').click();await page.getByRole('option',{name:'微信公众号',exact:true}).click()
  await dialog.getByText('RSS / Atom',{exact:true}).click()
  await dialog.locator('.el-form-item').filter({hasText:'RSS / Atom 地址'}).locator('input').fill('https://collector.example.invalid/feed.xml')
  await dialog.locator('.el-form-item').filter({hasText:'公众号名称'}).locator('input').fill('校园通知')
  const baseSwitches=dialog.locator('.automation-config .el-switch');await baseSwitches.nth(0).click();await baseSwitches.nth(1).click()
  await dialog.getByRole('button',{name:'保存配置'}).click();const card=page.locator('.base-card').filter({hasText:prefix});await card.waitFor()
  base=(await request('GET','/knowledge/bases',undefined,login.accessToken)).find(b=>b.name===prefix);assert.equal(base.kind,'WECHAT');assert.equal(base.aiSummaryEnabled,true);assert.equal(base.aiReviewEnabled,true)
  await card.getByRole('button',{name:'配置',exact:true}).click();await dialog.waitFor();await dialog.getByText('采集器 API',{exact:true}).click()
  await dialog.locator('.el-form-item').filter({hasText:'采集器服务器地址'}).locator('input').fill('https://collector.example.invalid')
  await dialog.getByRole('button',{name:'读取已订阅公众号'}).click();await page.getByText('地址已变化，请重新填写访问令牌',{exact:true}).waitFor()
  await dialog.getByRole('button',{name:'取消',exact:true}).click()
  pass('公众号 API/RSS 配置切换、单库开关持久化与令牌校验')
  await page.getByRole('tab',{name:'AI 自动化',exact:true}).click();const panel=page.locator('.automation-panel');const switches=panel.locator('.el-switch')
  await switches.nth(0).click();await switches.nth(1).click();await panel.getByRole('button',{name:'保存自动化开关'}).click();await page.getByText('自动化开关已保存',{exact:true}).waitFor()
  let p=await request('GET','/knowledge/automation/policy',undefined,login.accessToken);assert(p.reviewEnabled&&p.summaryEnabled)
  await switches.nth(0).click();await switches.nth(1).click();await panel.getByRole('button',{name:'保存自动化开关'}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.automation-panel .el-switch.is-checked').length===0)
  for(let i=0;i<20;i++){p=await request('GET','/knowledge/automation/policy',undefined,login.accessToken);if(!p.reviewEnabled&&!p.summaryEnabled)break;await page.waitForTimeout(50)}assert(!p.reviewEnabled&&!p.summaryEnabled)
  await page.screenshot({path:resolve(out,'automation-light.png'),fullPage:true})
  pass('真实浏览器全局审核/总结开关保存与关闭')
  entry=await request('POST','/knowledge/entries',{baseId:base.id,title:'自动整理结果验证',answer:'良乡校区资料原文保持完整，开放时间以通知为准。',mode:'RAG',status:'DRAFT'},login.accessToken)
  await db.knowledgeEntry.update({where:{id:entry.id},data:{summary:'良乡校区开放安排以通知为准。',aiReviewStatus:'NEEDS_REVIEW',aiReview:{method:'AI',reason:'请管理员确认最新开放时间',issues:['时效待核查']}}})
  await page.getByRole('tab',{name:'知识库',exact:true}).click();await card.getByRole('button',{name:'条目',exact:true}).click();const row=page.locator('.el-table__row').filter({hasText:'自动整理结果验证'});await row.getByText('已生成总结',{exact:true}).waitFor()
  await row.getByRole('button',{name:'编辑',exact:true}).click();const entryDialog=page.locator('.el-dialog').filter({hasText:'知识条目'});await entryDialog.getByText('良乡校区开放安排以通知为准。',{exact:true}).waitFor();assert((await entryDialog.innerText()).includes('请管理员确认最新开放时间'))
  await entryDialog.locator('.automation-result').scrollIntoViewIfNeeded();await page.waitForTimeout(250)
  await page.screenshot({path:resolve(out,'entry-summary-light.png'),fullPage:true})
  await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.screenshot({path:resolve(out,'entry-summary-dark.png'),fullPage:true})
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'移动端页面横向溢出');await page.screenshot({path:resolve(out,'entry-summary-mobile.png'),fullPage:true})
  assert.equal(errors.length,0,errors.join('\n'));pass('审核理由与总结卡片、夜间模式、手机布局无页面错误')
  writeFileSync(resolve(out,'ui-verification.json'),JSON.stringify({passed:true,checks,date:new Date().toISOString()},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
  if(originalSettings){await db.setting.deleteMany({where:{key:{in:keys}}});for(const s of originalSettings)await db.setting.create({data:s})}
  if(base)await db.knowledgeBase.delete({where:{id:base.id}})
  if(startedAt&&adminId)await db.auditLog.deleteMany({where:{userId:adminId,createdAt:{gte:startedAt},OR:[{resourceId:base?.id||prefix},{action:'setting.update',detail:{path:['key'],string_contains:'knowledge_ai_'}}]}})
  await browser?.close();await db.$disconnect()
})
