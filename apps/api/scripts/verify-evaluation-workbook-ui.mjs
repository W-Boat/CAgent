import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {chromium} from 'playwright'
const site=process.env.UI_WEB||'http://127.0.0.1:15174',browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const ctx=await browser.newContext({acceptDownloads:true});await ctx.addInitScript(()=>localStorage.setItem('cagent.accessToken','fixture'));const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let job,submitted
 await ctx.route('**/api/**',route=>{const req=route.request(),path=new URL(req.url()).pathname,ok=data=>route.fulfill({json:{code:0,data}})
  if(path==='/api/auth/me')return ok({id:'fixture',name:'测试',email:'fixture@example.invalid',permissions:['*'],roles:['super_admin']})
  if(path==='/api/settings/public')return ok({site_name:'CAgent',memory_enabled:false,onboarding_enabled:false})
  if(path==='/api/evaluations/import-xlsx'){assert(req.postDataJSON().data.startsWith('UEs'));return ok({batches:[{id:'1',split:'validation',questions:['独立问题'],expectedAnswers:['仅核对参考']}],total:1})}
  if(path==='/api/evaluations'&&req.method()==='POST'){submitted=req.postDataJSON();job={id:'fixture',title:submitted.title,status:'COMPLETED',total:1,batchCount:1,completed:1,succeeded:1,failed:0,options:submitted,turns:[{id:'1',batchId:'1',split:'validation',turn:1,question:'独立问题',expectedAnswer:'仅核对参考',reply:'实际答复',latencyMs:1,status:'SUCCESS'}]};return ok(job)}
  if(path==='/api/evaluations/knowledge-options')return ok([{id:'library',name:'可选知识库'}])
  if(path==='/api/models/available')return ok([{id:'model',name:'可选模型'}])
  if(path==='/api/evaluations')return ok(job?[job]:[])
  if(path.endsWith('/export'))return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:readFileSync(new URL('../../../.tmp/evaluation-alignment-20261103/result.xlsx',import.meta.url))})
  if(path==='/api/evaluations/fixture')return ok(job)
  return ok([])
 })
 await page.goto(site+'/admin/evaluations');await page.locator('input[type=file]').setInputFiles(new URL('../../../.tmp/evaluation-alignment-20261103/input.xlsx',import.meta.url).pathname.replace(/^\/(?:([A-Z]:))/, '$1'))
 await page.getByRole('button',{name:'开始测试',exact:true}).click();await page.getByText('预期答案：仅核对参考').waitFor();assert.equal(submitted.format,'xlsx');assert(submitted.data.startsWith('UEs'));assert.equal(submitted.outputPreference,undefined);assert(await page.getByRole('textbox').filter({hasText:'never'}).count()===0);assert.equal(await page.locator('input:disabled').inputValue(),'精简模式（固定）')
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'下载 Excel 结果'}).click();assert((await event).suggestedFilename().endsWith('.xlsx'))
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.classList.add('dark'));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.deepEqual(errors,[])
 console.log('PASS workbook UI: upload, reference preview, text mode, Excel download, mobile dark layout; model calls 0');await ctx.close()
}finally{await browser.close()}
