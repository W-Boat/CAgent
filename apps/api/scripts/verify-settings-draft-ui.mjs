import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
for(const line of readFileSync(new URL('../../../.env',import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const WEB=process.env.SETTINGS_WEB||'http://127.0.0.1:4173',API=process.env.SETTINGS_API||'http://127.0.0.1:3002',prod=WEB.startsWith('https:')
const a=await fetch(API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:prod?(process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL):process.env.SEED_ADMIN_EMAIL,password:prod?(process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD):process.env.SEED_ADMIN_PASSWORD})}).then(r=>r.json());assert.equal(a.code,0)
const data=await fetch(API+'/api/settings',{headers:{Authorization:'Bearer '+a.data.accessToken}}).then(r=>r.json());assert.equal(data.code,0);const groups=data.data,flat=Object.fromEntries(Object.values(groups).flat().map(i=>[i.key,i.value]))
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],payloads=[];let releaseSave,documents=0
await context.addInitScript(auth=>{localStorage.setItem('cagent.accessToken',auth.accessToken);localStorage.setItem('cagent.refreshToken',auth.refreshToken)},a.data)
await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(u.pathname==='/api/settings'){
 if(route.request().method()==='PUT'){const payload=route.request().postDataJSON();payloads.push(payload);if(payloads.length===1)await new Promise(r=>releaseSave=r);Object.assign(flat,payload);return route.fulfill({json:{code:0,data:flat}})}
 return route.fulfill({json:{code:0,data:groups}})
 }return prod?route.continue():route.continue({url:API+u.pathname+u.search})})
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())documents++})
try{
 await page.goto(WEB+'/admin/settings');await page.getByRole('tab',{name:'学生端与主题',exact:true}).click();const panel=page.locator('.display-panel:visible'),color=panel.getByRole('textbox',{name:'统一主题色',exact:true}),subtitle=panel.getByRole('textbox',{name:'品牌副标题',exact:true})
 await subtitle.fill('未保存文案测试');await panel.getByRole('button',{name:'翠绿',exact:true}).click();await color.press('Enter');await page.waitForTimeout(350);assert.equal(documents,1,'点击主题色或回车触发页面刷新');assert.equal(await color.inputValue(),'#059669');assert.equal(await subtitle.inputValue(),'未保存文案测试')
 await page.getByRole('button',{name:'保存全部修改'}).click();for(let i=0;i<30&&!releaseSave;i++)await page.waitForTimeout(50);assert(releaseSave);assert.equal(payloads[0].default_accent_color,'#059669');assert.equal(payloads[0].student_brand_subtitle,'未保存文案测试')
 await panel.getByRole('button',{name:'玫红',exact:true}).click();releaseSave();await page.getByText(/已保存 \d+ 项设置/).waitFor();assert.equal(await color.inputValue(),'#e11d48','保存返回覆盖了新编辑');await page.getByText('有 1 项修改尚未保存',{exact:true}).waitFor()
 await page.getByRole('button',{name:'重新载入',exact:true}).click();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await color.inputValue(),'#e11d48')
 await page.getByRole('button',{name:'保存全部修改'}).click();for(let i=0;i<30&&payloads.length<2;i++)await page.waitForTimeout(50);assert.equal(payloads[1].default_accent_color,'#e11d48');await page.waitForFunction(()=>!document.querySelector('.dirty-alert'));assert.equal(documents,1);assert.equal(errors.length,0,errors.join('\n'))
 const out=new URL('../../../storage/shots/settings/',import.meta.url);mkdirSync(out,{recursive:true});await page.screenshot({path:fileURLToPath(new URL((prod?'production':'local')+'-draft.png',out)),fullPage:true});writeFileSync(new URL((prod?'production':'local')+'-draft.json',out),JSON.stringify({passed:true,checks:['主题按钮与回车无页面刷新','保留其他未保存配置','保存包含新主题色','保存期间继续编辑不丢失','重载取消保留草稿','第二次保存成功'],productionSettingsWrites:0,date:new Date().toISOString()},null,2));console.log('PASS 主题切换不刷新、草稿保存及并发编辑保护，零生产设置写入')
}finally{releaseSave?.();await context.unrouteAll({behavior:'wait'});await browser.close()}
