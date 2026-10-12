import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),{chromium}=require('playwright'),root=resolve(new URL('../../..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'))
const extension=resolve(root,'apps/extension'),shots=resolve(root,'storage/shots/timetable');mkdirSync(shots,{recursive:true})
const manifest=JSON.parse(readFileSync(resolve(extension,'manifest.json'),'utf8'))
assert.deepEqual(manifest.permissions,['scripting']);assert.deepEqual(manifest.host_permissions,['https://ut.ucass.edu.cn/*']);assert(!JSON.stringify(manifest).includes('<all_urls>'))
const context=await chromium.launchPersistentContext(resolve(root,'.tmp/timetable/extension-profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]})
const checks=[],pass=s=>{checks.push(s);console.log('PASS '+s)}
const table=`<form id="ctl01"><input type="hidden" value="DO-NOT-CAPTURE-PRIVATE-TOKEN"><select><option>2026-2027学年第一学期</option><option>2025-2026学年第二学期</option></select><table><tr><td>课程号</td><td>课程名</td><td>课序号</td><td>上课安排</td><td>教学方式</td></tr><tr><td>2021030001</td><td>大学计算机</td><td>11</td><td>1--16周,星期2, 9:45--12:10;<br>1--16周,星期2, 15:35--17:10 教学综合楼313 机房 吴蓓</td><td>讲授</td></tr></table><p>OTHER-PRIVATE-CONTENT</p></form>`
try{
 await context.route('https://ut.ucass.edu.cn/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:r.request().url().includes('MyCourseTimeTable.aspx')?table:'<iframe id="divFrame4" src="/Student/CourseTimetable/MyCourseTimeTable.aspx"></iframe>'}))
 await context.route('https://campus.example.org/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><h1>Isolated platform timetable fixture</h1>'}))
 const academic=await context.newPage();await academic.goto('https://ut.ucass.edu.cn/Navigation/Default.htm');await academic.frameLocator('#divFrame4').locator('table').waitFor()
 const page=await context.newPage();await page.goto('https://campus.example.org/timetable');await page.waitForTimeout(500)
 const result=await page.evaluate(()=>new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();const timer=setTimeout(()=>reject(new Error('extension bridge timed out')),15000);const listener=e=>{if(e.data?.type==='CAGENT_TIMETABLE_RESULT'&&e.data.requestId===requestId){clearTimeout(timer);window.removeEventListener('message',listener);resolve(e.data)}};window.addEventListener('message',listener);window.postMessage({type:'CAGENT_TIMETABLE_CAPTURE',requestId},location.origin)}))
 assert(!result.error,result.error);assert.equal(result.capture.semester,'2026-2027学年第一学期');assert.equal(result.capture.rows.length,1);assert(result.capture.rows[0].arrangement.includes('15:35--17:10'));assert(!JSON.stringify(result).includes('PRIVATE'));pass('实际 MV3 扩展从 iframe#divFrame4 读取学期和五列数据，不包含隐藏字段或其他页面正文')
 await academic.goto('https://ut.ucass.edu.cn/Navigation/Other.htm');await academic.setContent('<h1>无课表页面</h1>')
 const wrong=await page.evaluate(()=>new Promise(resolve=>{const requestId='second';const listener=e=>{if(e.data?.type==='CAGENT_TIMETABLE_RESULT'&&e.data.requestId===requestId){window.removeEventListener('message',listener);resolve(e.data)}};window.addEventListener('message',listener);window.postMessage({type:'CAGENT_TIMETABLE_CAPTURE',requestId},location.origin)}));assert(wrong.error);assert(!wrong.capture);pass('非课表页面无法提取，扩展无通用脚本/点击/密码/Cookie 权限')
}finally{await context.close();writeFileSync(resolve(shots,'extension.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,scope:'Real Chrome extension with isolated academic iframe fixture; no authenticated school session'},null,2))}
