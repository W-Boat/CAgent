import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const site=process.env.UI_WEB||'http://127.0.0.1:4173',out=new URL('../../../storage/shots/evaluation/',import.meta.url);mkdirSync(out,{recursive:true});const checks=[],errors=[],calls=[];let settings={site_name:'CAgent',memory_enabled:false,onboarding_enabled:false,student_onboarding_enabled:true,student_show_weather:false},job
const browser=await chromium.launch({headless:true})
try{const ctx=await browser.newContext({viewport:{width:1280,height:960},acceptDownloads:true});await ctx.addInitScript(()=>localStorage.setItem('cagent.accessToken','evaluation-ui-fixture'));const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message))
 await ctx.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname,ok=data=>route.fulfill({json:{code:0,data}})
  if(path==='/api/auth/me')return ok({id:'eval-ui',email:'fixture@example.invalid',name:'测试管理',permissions:['*'],roles:[]})
  if(path==='/api/settings/public')return ok(settings)
  if(path==='/api/settings')return ok({general:[{key:'memory_enabled',label:'全站记忆功能',type:'boolean',value:settings.memory_enabled},{key:'onboarding_enabled',label:'进入引导弹窗',type:'boolean',value:settings.onboarding_enabled}]})
  if(path==='/api/models/available')return ok([{id:'fixture',name:'测试模型',key:'fixture',isDefault:true}])
  if(path==='/api/agents/available'||path==='/api/skills/available')return ok([])
  if(path==='/api/evaluations'&&req.method()==='GET')return ok(job?[job]:[])
  if(path==='/api/evaluations'&&req.method()==='POST'){const body=req.postDataJSON();calls.push(body);assert.equal(body.bypassCache,true);assert.equal(body.format,'json');assert.equal(body.concurrency,3);assert.equal(body.strictMode,true);assert.equal(body.knowledgeScope,'v2-only');assert.equal(body.outputPreference,'text');job={id:'ui-job',title:body.title,options:body,status:'COMPLETED',total:3,batchCount:2,completed:3,succeeded:3,failed:0,turns:[{id:'t1',batchId:'通勤-01',split:'test',turn:1,question:'附近的地铁站',reply:'广阳城站',status:'SUCCESS'},{id:'t2',batchId:'通勤-01',split:'test',turn:2,question:'怎么去',reply:'请查询班车服务。',status:'SUCCESS'},{id:'t3',batchId:'验证-01',split:'validation',turn:1,question:'预约吗',reply:'以校区规则为准。',status:'SUCCESS'}]};return ok(job)}
  if(path==='/api/evaluations/ui-job')return ok(job)
  if(path==='/api/evaluations/ui-job/export')return route.fulfill({contentType:url.searchParams.get('format')==='csv'?'text/csv':'application/json',body:url.searchParams.get('format')==='csv'?'\uFEFFbatch_id,turn,question,reply\r\n通勤-01,1,地铁站,广阳城站\r\n':JSON.stringify({batches:[{batch_id:'通勤-01',turns:[{question:'地铁站',reply:'广阳城站'}]}]})})
  if(path==='/api/conversations')return ok({items:[],total:0})
  return ok([])
 })
 await page.goto(site+'/admin/evaluations',{waitUntil:'domcontentloaded'});await page.locator('.evaluation-page').getByRole('heading',{name:'批量对话测试',exact:true}).waitFor();assert.equal(await page.getByText('我的记忆',{exact:true}).count(),0)
 await page.getByRole('spinbutton',{name:'并发批次数'}).fill('3');await page.getByText('严格模式：校园导览、纯文字、中性内容',{exact:true}).click();assert(await page.getByRole('checkbox',{name:'严格模式：校园导览、纯文字、中性内容'}).isChecked());assert(await page.getByRole('combobox',{name:'测试输出偏好'}).isDisabled())
 await page.locator('.evaluation-page').getByText('当前已挂载知识库',{exact:true}).click();await page.getByRole('option',{name:'仅 2.0：SQLite + Markdown'}).click()
 await page.getByRole('button',{name:'开始批量回复'}).click();await page.getByText('广阳城站',{exact:true}).waitFor();assert.equal(calls.length,1);assert(await page.getByText('并发 3',{exact:true}).isVisible());checks.push('后台入口、测试集来源说明、并发/严格/两库设置提交，严格模式锁定纯文字与结果模式回显')
 for(const kind of ['JSON','CSV']){const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载 '+kind,exact:true}).click();const file=await download;assert(file.suggestedFilename().endsWith('.'+kind.toLowerCase()));await file.saveAs(fileURLToPath(new URL('ui-results.'+kind.toLowerCase(),out)))}checks.push('JSON/CSV 浏览器实际下载事件与文件扩展名')
 await page.getByRole('textbox',{name:'测试集内容'}).fill('{broken');await page.getByRole('alert').filter({hasText:'JSON 格式无效'}).waitFor();assert(await page.getByRole('button',{name:'开始批量回复'}).isDisabled());checks.push('格式错误阻止提交并给出可读提示')
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.waitForTimeout(200);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:fileURLToPath(new URL((site.startsWith('https:')?'production':'local')+'-batch-dark.png',out)),fullPage:true});checks.push('手机及夜间布局无横向溢出')
 await page.goto(site+'/student',{waitUntil:'domcontentloaded'});await page.getByRole('textbox',{name:'输入消息'}).waitFor();assert.equal(await page.locator('.st-ob-mask').count(),0);checks.push('全站引导关闭覆盖学生独立开关，新账号不弹引导')
 await page.goto(site+'/memory',{waitUntil:'domcontentloaded'});await page.waitForURL(url=>!url.pathname.startsWith('/memory'));checks.push('全站记忆关闭同时隐藏菜单和禁止旧书签进入')
 await page.goto(site+'/admin/settings',{waitUntil:'domcontentloaded'});await page.getByText('全站记忆功能',{exact:true}).waitFor();await page.getByText('进入引导弹窗',{exact:true}).waitFor();checks.push('通用设置显示两个独立全站开关')
 assert.deepEqual(errors,[]);await ctx.unrouteAll({behavior:'ignoreErrors'});await ctx.close();writeFileSync(new URL((site.startsWith('https:')?'production':'local')+'-ui-verification.json',out),JSON.stringify({passed:true,checks,errors,externalModelCalls:0,scope:'Built UI with authenticated metadata and evaluation responses intercepted, no production writes'},null,2));console.log(JSON.stringify({passed:true,checks}))
}finally{await browser.close()}
