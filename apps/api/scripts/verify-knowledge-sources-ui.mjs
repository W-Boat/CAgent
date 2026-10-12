import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),{chromium}=require('playwright'),origin=process.env.SOURCES_WEB||'http://127.0.0.1:4173'
const shots=new URL('../../../storage/shots/sources/',import.meta.url);mkdirSync(shots,{recursive:true})
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],checks=[]
page.on('pageerror',e=>errors.push(e.message))
let extraSearches=0
page.on('request',r=>{if(r.url().includes('/api/campus/search'))extraSearches++})
await page.route('**/api/trial/**',async route=>{
 if(route.request().url().endsWith('/quota'))return route.fulfill({json:{code:0,data:{used:0,max:5,left:5}}})
 if(!route.request().url().endsWith('/chat'))return route.continue()
 const sources=Array.from({length:8},(_,i)=>({id:'source-'+i,citationId:String(100+i),title:'学生社团 / '+['国防协会','足球协会','滑板社','心理协会','篮球协会','文博苑','三农协会','电影眼学会'][i],summary:'本条资料介绍社团的活动内容与参与方式；用于核对本次回答。',source:'UCASSbook_RAG.json',collection:'handbook',locator:'学生工作 / 学生社团 / 第'+(i+1)+'节',trust:'handbook',url:i===7?'javascript:alert(1)':i<2?'https://example.invalid/club-'+i:undefined,used:i<2}))
 const frames=[['meta',{conversationId:'sources-test'}],['kb',{hits:sources.map(s=>({...s,used:false})),phase:'retrieved'}],['text',{text:'国防协会开展国防科普；足球协会组织足球活动。'}],['kb',{hits:sources,phase:'final'}],['trial',{roundId:'sources-round',used:1,max:5,left:4}],['done',{status:'SUCCESS'}]]
 return route.fulfill({contentType:'text/event-stream',body:frames.map(([e,p])=>'event: '+e+'\ndata: '+JSON.stringify(p)+'\n\n').join('')})
})
try{
 await page.goto(origin+'/test',{waitUntil:'networkidle'})
 await page.getByRole('textbox',{name:'输入消息'}).fill('学生社团具体概况')
 await page.getByRole('button',{name:'发送',exact:true}).click()
 await page.locator('.trial-feedback').waitFor()
 const sources=page.locator('.knowledge-sources')
 assert((await sources.innerText()).includes('2 条已引用 · 6 条其他参考'))
 await sources.locator('.source-toggle').click()
 assert.equal(await sources.locator('.source-item').count(),2)
 assert((await sources.innerText()).includes('国防协会'))
 await sources.locator('.source-more').click()
 assert.equal(await sources.locator('.source-item').count(),8)
 assert.equal(await page.locator('a[href^="javascript:"]').count(),0)
 await sources.locator('.source-location summary').first().click()
 assert((await sources.innerText()).includes('第1节'))
 checks.push('8 条真实来源协议渲染，引用优先、参考可展开、出处/摘录/章节与链接校验')
 await page.screenshot({path:fileURLToPath(new URL('desktop.png',shots)),fullPage:true})
 await page.getByRole('button',{name:'切换到深色',exact:true}).click()
 assert(await page.evaluate(()=>document.documentElement.classList.contains('dark')))
 const colors=await sources.evaluate(el=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')
   const rgb=(color,base='white')=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=base;ctx.fillRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3)}
   const luminance=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)
   const rootBg=getComputedStyle(el).backgroundColor,item=el.querySelector('.source-item'),itemBg=getComputedStyle(item).backgroundColor
   const ratios=['.source-title','.source-excerpt','.source-origin','.source-note'].map(selector=>{
     const node=el.querySelector(selector),style=getComputedStyle(node),bg=selector==='.source-note'?rootBg:itemBg,a=luminance(rgb(style.color,bg)),b=luminance(rgb(bg));return {selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
   })
   return {root:rgb(rootBg),item:rgb(itemBg),ratios}
 })
 assert(colors.root.every(c=>c<70),'夜间来源面板不应出现浅色背景')
 assert(colors.item.every(c=>c<70))
 assert(colors.ratios.every(r=>r.ratio>=4.5),JSON.stringify(colors))
 await page.screenshot({path:fileURLToPath(new URL('dark-desktop.png',shots)),fullPage:true})
 checks.push('夜间来源面板和卡片使用深色背景，正文/摘要/出处/说明对比度均至少 4.5:1')
 await page.setViewportSize({width:390,height:844})
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 assert.equal(await sources.locator('.source-grid').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1)
 await page.screenshot({path:fileURLToPath(new URL('dark-mobile.png',shots)),fullPage:true})
 await page.getByRole('button',{name:'打开对话列表',exact:true}).click()
 await page.getByRole('button',{name:'切换到浅色',exact:true}).click()
 assert(!await page.evaluate(()=>document.documentElement.classList.contains('dark')))
 await page.keyboard.press('Escape')
 checks.push('手机单列来源卡片，全部 8 条可见，无横向溢出，可恢复浅色主题')
 assert.equal(extraSearches,0);assert.deepEqual(errors,[])
 for(const check of checks)console.log('PASS '+check)
}finally{
 writeFileSync(new URL('ui-verification.json',shots),JSON.stringify({origin,checkedAt:new Date().toISOString(),checks,extraSearches,errors,transport:'Browser source SSE fixtures'},null,2))
 await browser.close()
}
