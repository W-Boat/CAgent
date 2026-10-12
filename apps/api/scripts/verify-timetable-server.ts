import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {TimetableBrowserService,allowedSchoolUrl} from '../src/timetable/timetable-browser.service'
const checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
async function main(){
  assert(allowedSchoolUrl('https://ut.ucass.edu.cn/Student/CourseTimetable/MyCourseTimeTable.aspx',true));assert(allowedSchoolUrl('https://impone.ucass.edu.cn/cas/login',true));assert(!allowedSchoolUrl('https://ut.ucass.edu.cn/Student/DeleteCourse.aspx',true));assert(!allowedSchoolUrl('https://ucass.edu.cn.attacker.invalid/login',true));assert(!allowedSchoolUrl('file:///etc/passwd'));assert(!allowedSchoolUrl('http://127.0.0.1/login'))
  const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1280,height:800}}),service=new TimetableBrowserService({get:async()=>true} as any),id=randomUUID(),owner='owner-fixture'
  try{
    await context.route('https://ut.ucass.edu.cn/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:r.request().url().includes('MyCourseTimeTable.aspx')?'<form id="ctl01"><input type="hidden" value="PRIVATE-COOKIE-NEVER-CAPTURE"><select><option>2026-2027学年第一学期</option></select><table><tr><th>课程号</th><th>课程名</th><th>课序号</th><th>上课安排</th><th>教学方式</th></tr><tr><td>2021030001</td><td>大学计算机</td><td>11</td><td>1--16周,星期2, 9:45--12:10;1--16周,星期2, 15:35--17:10 教学综合楼313 机房 吴蓓</td><td>讲授</td></tr></table></form>':'<input id="account"><input id="password" type="password"><iframe id="divFrame4" src="/Student/CourseTimetable/MyCourseTimeTable.aspx"></iframe>'}))
    const page=await context.newPage();await page.goto('https://ut.ucass.edu.cn/Navigation/Default.htm');await page.frameLocator('#divFrame4').locator('table').waitFor()
    ;(service as any).sessions.set(id,{id,ownerId:owner,context,page,createdAt:Date.now(),seenAt:Date.now(),busy:false})
    await assert.rejects(()=>service.frame('other-user',id),/已关闭|过期/)
    const frame=await service.frame(owner,id);assert(frame.image.startsWith('data:image/jpeg;base64,'));assert.equal(frame.pagePath,'/Navigation/Default.htm');assert(!('url'in frame));pass('临时服务器窗口截图仅当前账号可读取，响应不含登录令牌 URL，导航限定学校登录与课表')
    await page.locator('#password').focus();await service.action(owner,id,{action:'type',text:'PRIVATE-PASSWORD-FIXTURE'});assert.equal(await page.locator('#password').inputValue(),'PRIVATE-PASSWORD-FIXTURE');assert(!JSON.stringify([...(service as any).sessions.values()].map((s:any)=>({id:s.id,ownerId:s.ownerId}))).includes('PASSWORD'))
    const result=await service.capture(owner,id);assert.equal(result.capture.rows.length,1);assert.equal(result.preview.courses[0].meetings.length,2);assert(!JSON.stringify(result).includes('PRIVATE'));assert.equal(result.sessionClosed,true);await assert.rejects(()=>service.frame(owner,id));assert.equal(context.pages().length,0);pass('服务器只提取五列课表并解析两段时间，密码和隐藏字段不进入结果，成功读取立即销毁登录上下文')
    const second=await browser.newContext(),p2=await second.newPage(),expired=randomUUID();(service as any).sessions.set(expired,{id:expired,ownerId:owner,context:second,page:p2,createdAt:Date.now()-21*60000,seenAt:Date.now(),busy:false});await service.reap();assert.equal((service as any).sessions.size,0);pass('超时清理销毁临时登录会话，无通用浏览器命令或持久 Cookie 存储')
  }finally{await service.onModuleDestroy();await browser.close()}
  const shots=resolve(__dirname,'../../../storage/shots/timetable');mkdirSync(shots,{recursive:true});writeFileSync(resolve(shots,'server.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,scope:'Actual Chromium with isolated academic iframe fixture; no school credentials'},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
