import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const require=createRequire(import.meta.url),{chromium}=require('playwright')
const site=process.env.UI_WEB||'http://127.0.0.1:15173',out=resolve(import.meta.dirname,'../../../storage/shots/lectures');mkdirSync(out,{recursive:true})
const fixtures=[{id:'lecture-one',title:'公共治理与学术生活',event_date:'2026-10-30',time_text:'14:00',speaker:'测试主讲人',location:'教学楼123',campus:'良乡校区',source_id:'sg',source_name:'政府管理学院',org:'政府管理学院',type:'讲座',content_kind:'preview',published:'2026-10-22',url:'https://sg.ucass.edu.cn/info/1149/5290.htm',excerpt:'这是只读测试资料。<script>window.bad=true</script>',date_confidence:'source_extracted'},
 {id:'lecture-two',title:'学术沙龙活动回顾',event_date:'2026-10-31',time_text:'',speaker:'',location:'',campus:'望京校区',source_id:'law',source_name:'法学院',type:'学术沙龙',content_kind:'review',url:'https://law.ucass.edu.cn/info/1/2.htm',excerpt:'回顾不代表仍可报名。'},
 {id:'lecture-three',title:'日期待定的活动资料',event_date:'',time_text:'',campus:'未注明',source_id:'sg',source_name:'政府管理学院',type:'讲座',content_kind:'info',url:'https://sg.ucass.edu.cn/info/1149/5289.htm',excerpt:'日期尚未明确。'}]
const browser=await chromium.launch({headless:true,executablePath:process.env.UI_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'}),errors=[],reports=[]
try{
 for(const admin of [true,false]){
  const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'})
  await context.addInitScript(()=>{localStorage.setItem('cagent.accessToken','lecture-ui-fixture');localStorage.setItem('cagent-theme','light')})
  const calls=[];let config={enabled:false,intervalMinutes:720,maxPages:1,maxArticles:30,sources:[{id:'sg-1',name:'政府管理学院 · 预告通知',url:'https://sg.ucass.edu.cn/index/ygtz.htm',mode:'all',enabled:true}]}
  await context.route('**/api/**',async route=>{
   const request=route.request(),u=new URL(request.url()),p=u.pathname;if(!p.startsWith('/api/'))return route.continue()
   calls.push({path:p,method:request.method()});let data=[]
   if(p==='/api/auth/me')data={id:'fixture-user',name:'测试用户',email:'ui@example.invalid',roles:[admin?'superadmin':'student'],permissions:admin?['*']:['chat:use']}
   else if(p==='/api/settings/public')data={site_name:'CAgent',default_accent_color:'#be3150',unified_theme_enabled:true,student_default_theme:'light',student_allow_theme_toggle:true,onboarding_enabled:false,memory_enabled:true}
   else if(p==='/api/campus/shortcuts')data=[{id:'lecture-link',label:'讲座日历',question:'查看校园讲座日历',url:'/lectures'}]
   else if(p==='/api/conversations')data={items:[],total:0,page:1,pageSize:50}
   else if(p==='/api/lectures'){
    let rows=fixtures.filter(l=>(!u.searchParams.get('q')||l.title.includes(u.searchParams.get('q')))&&(!u.searchParams.get('campus')||l.campus===u.searchParams.get('campus'))&&(!u.searchParams.get('kind')||l.content_kind===u.searchParams.get('kind')))
    if(u.searchParams.get('scope')==='undated')rows=rows.filter(l=>!l.event_date)
    if(u.searchParams.get('scope')==='upcoming')rows=rows.filter(l=>l.content_kind==='preview'&&l.event_date>='2026-10-29')
    if(u.searchParams.get('month'))rows=rows.filter(l=>l.event_date.startsWith(u.searchParams.get('month')))
    const days={};for(const l of rows)if(l.event_date)days[l.event_date]=(days[l.event_date]||0)+1
    if(u.searchParams.get('date'))rows=rows.filter(l=>l.event_date===u.searchParams.get('date'))
    data={enabled:true,today:'2026-10-29',updatedAt:'2026-10-29T08:00:00Z',items:rows.map(({excerpt,...l})=>l),total:rows.length,page:1,pageSize:20,days,counts:{all:3,upcoming:1,undated:1},sources:[{id:'sg',name:'政府管理学院'},{id:'law',name:'法学院'}],campuses:['良乡校区','望京校区','未注明'],types:['讲座','学术沙龙']}
   }else if(p==='/api/lectures/collector/config'){if(request.method()==='PUT')config=request.postDataJSON();data=config}
   else if(p==='/api/lectures/collector/status')data={enabled:true,status:'SUCCESS',summary:{collected:3,created:3,warnings:[]}}
   else if(p==='/api/lectures/collector/test')data={records:[fixtures[0]],warnings:[],scanned:1}
   else if(p==='/api/lectures/collector/run')data={queued:true}
   else if(p==='/api/lectures/import')data={created:request.postDataJSON().records.length,changed:0,skipped:0}
   else if(p.startsWith('/api/lectures/'))data=fixtures.find(l=>p.endsWith(l.id))
   await route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data,message:'ok'})})
  })
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
  await page.goto(site+'/lectures',{waitUntil:'networkidle'});await page.locator('.lecture-heading h1').waitFor()
  if(!admin){assert.equal(new URL(page.url()).pathname,'/student/lectures');assert.equal(await page.locator('.nx-sidebar').count(),0);assert(await page.getByRole('link',{name:'返回对话',exact:true}).isVisible())}
  await page.getByLabel('选择月份',{exact:true}).fill('2026-10');await page.locator('.lecture-card').first().waitFor()
  assert.equal(await page.locator('.lecture-card').count(),2)
  await page.getByRole('button',{name:'2026-10-30，1 条活动',exact:true}).click();await page.waitForResponse(r=>r.url().includes('date=2026-10-30'));await page.waitForTimeout(250)
  assert.equal(await page.locator('.lecture-card').count(),1)
  await page.getByRole('button',{name:'公共治理与学术生活',exact:true}).click();await page.locator('.detail-title').waitFor()
  assert((await page.locator('.lecture-body').innerText()).includes('<script>'));assert(!await page.evaluate(()=>window.bad))
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载日历 .ics',exact:true}).click();assert((await download).suggestedFilename().endsWith('.ics'))
  await page.locator('.el-dialog__headerbtn:visible').click();await page.getByRole('button',{name:'查看整月',exact:true}).click();await page.waitForTimeout(400)
  await page.getByRole('button',{name:'列表',exact:true}).click();await page.waitForTimeout(400);assert.equal(await page.locator('.lecture-card').count(),3)
  await page.screenshot({path:resolve(out,admin?'admin-list.png':'student-list.png'),fullPage:true})
  await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'月历',exact:true}).click();await page.waitForTimeout(400)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  await page.screenshot({path:resolve(out,admin?'admin-mobile-dark.png':'student-mobile-dark.png'),fullPage:true})
  if(admin){
   await page.setViewportSize({width:1280,height:1000});await page.getByRole('button',{name:'采集与导入',exact:true}).click();await page.getByText('公开网页讲座采集',{exact:true}).waitFor()
   await page.getByRole('button',{name:'保存配置',exact:true}).click();await page.waitForTimeout(150);assert(calls.some(c=>c.method==='PUT'&&c.path.endsWith('/collector/config')))
   await page.getByRole('button',{name:'测试采集',exact:true}).click();await page.getByText('测试结果：1 篇有效文章',{exact:true}).waitFor()
   await page.locator('input[type=file]').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({lectures:fixtures}))});await page.waitForTimeout(400)
   assert(calls.some(c=>c.path==='/api/lectures/import'))
   await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
   await page.screenshot({path:resolve(out,'collector-mobile-dark.png'),fullPage:true})
  }else{
   assert.equal(await page.getByRole('button',{name:'采集与导入',exact:true}).count(),0);assert(!calls.some(c=>c.path.includes('/collector/')||c.method!=='GET'))
   await page.goto(site+'/student',{waitUntil:'networkidle'});await page.locator('.knowledge-shortcuts .shortcut-link').waitFor()
   const iconSizes=await page.locator('.st-utility-link svg').evaluateAll(icons=>icons.map(icon=>({width:getComputedStyle(icon).width,height:getComputedStyle(icon).height})))
   assert(iconSizes.length>=2);assert(iconSizes.every(size=>size.width==='20px'&&size.height==='20px'))
   await page.locator('.knowledge-shortcuts .shortcut-link').click();await page.locator('.student-lecture-bar').waitFor();assert.equal(await page.locator('.nx-sidebar').count(),0)
   await page.goto(site+'/map',{waitUntil:'networkidle'});await page.evaluate(()=>document.documentElement.classList.add('dark'));assert.equal(await page.locator('.atlas-intro').count(),0);assert.equal(await page.locator('.atlas-heading h1').innerText(),'校园地图')
   await page.getByRole('button',{name:'望京校区',exact:true}).click();assert(new URL(page.url()).searchParams.get('campus'))
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
   await page.screenshot({path:resolve(out,'student-map-mobile-dark.png'),fullPage:true})
  }
  reports.push({admin,passed:true});await context.close()
 }
 assert.deepEqual(errors,[]);writeFileSync(resolve(out,'report.json'),JSON.stringify({passed:true,site,reports,errors,scope:'Synthetic API fixture, no real login, mutation or model calls'},null,2));console.log('PASS lecture calendar/list/date selection/details/ICS/import/config/test; student isolation; mobile/light/dark')
}finally{await browser.close()}
