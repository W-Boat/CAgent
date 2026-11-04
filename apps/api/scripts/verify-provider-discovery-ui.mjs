import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),site=process.env.UI_WEB||'http://127.0.0.1:15174'
try{const ctx=await browser.newContext();await ctx.addInitScript(()=>localStorage.setItem('cagent.accessToken','fixture'));const page=await ctx.newPage(),errors=[];let imported=false;page.on('pageerror',e=>errors.push(e.message))
 await ctx.route('**/api/**',route=>{const req=route.request(),path=new URL(req.url()).pathname,ok=data=>route.fulfill({json:{code:0,data}})
  if(path==='/api/auth/me')return ok({id:'fixture',name:'Admin',email:'fixture@example.invalid',permissions:['*'],roles:['super_admin']})
  if(path==='/api/settings/public')return ok({site_name:'CAgent',onboarding_enabled:false})
  if(path==='/api/settings')return ok({general:[]})
  if(path==='/api/settings/version')return ok({version:'2026.11.04.2',builtAt:'2026-11-04T00:00:00Z'})
  if(path==='/api/providers')return ok([{id:'fixture',key:'test-provider',name:'测试供应商',type:'OPENAI_COMPATIBLE',enabled:true,isSystem:true,modelCount:0}])
  if(path==='/api/providers/fixture/models/discover')return ok({models:[{key:'new-model',name:'New',existing:false},{key:'old-model',name:'Old',existing:true}],partial:false})
  if(path==='/api/providers/fixture/models/import'){assert.deepEqual(req.postDataJSON().keys,['new-model']);imported=true;return ok({created:1,skipped:0})}
  return ok([])
 })
 await page.goto(site+'/admin/settings');await page.getByText(/前端构建 2026.11.04.2/).waitFor();await page.getByText(/服务端构建 2026.11.04.2/).waitFor()
 await page.goto(site+'/admin/providers');assert(await page.getByRole('button',{name:'删除',exact:true}).isEnabled());await page.getByRole('button',{name:'嗅探模型',exact:true}).click();await page.getByRole('row').filter({hasText:'new-model'}).locator('.el-checkbox').click();await page.getByRole('button',{name:/导入所选 1 个/}).click();assert(imported);await page.getByText(/已添加 1 个/).waitFor();assert.deepEqual(errors,[])
 console.log('PASS settings front/backend build display, built-in delete button, discovery selection and import; intercepted API only, no production writes');await ctx.close()
}finally{await browser.close()}
