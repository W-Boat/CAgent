import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const root=new URL('../../../',import.meta.url)
for(const line of readFileSync(new URL('.env',root),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const site=process.env.DINNER_API||'http://127.0.0.1:3000/api',spec=JSON.parse(readFileSync(new URL('knowledge/dinner-choice.json',root),'utf8'))
const response=await fetch(site+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL,password:process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD})}).then(r=>r.json());assert.equal(response.code,0,'Admin authentication failed')
const headers={Authorization:'Bearer '+response.data.accessToken,'Content-Type':'application/json'}
async function call(path,data){const r=await fetch(site+path,{headers,method:data?'POST':'GET',body:data?JSON.stringify(data):undefined}),j=await r.json();assert.equal(j.code,0,'Knowledge operation failed');return j.data}
const bases=await call('/knowledge/bases');let base=bases.find(b=>b.kind==='LOCAL'&&b.name==='今天吃什么 · 校园选餐')
if(!base)base=await call('/knowledge/bases',{name:'今天吃什么 · 校园选餐',kind:'LOCAL',mounted:true,description:'联动同学外卖红榜和一食堂、二食堂、三食堂（麦当劳）。可维护规则或停用；三食堂为用户称呼。',aiReviewEnabled:false,aiSummaryEnabled:false})
const existing=await call('/knowledge/entries?baseId='+encodeURIComponent(base.id)),entry=existing.items.find(e=>e.question==='今天吃什么')
if(!entry)await call('/knowledge/entries',{baseId:base.id,title:spec.title,question:spec.title,aliases:spec.aliases,answer:JSON.stringify({version:1,any:spec.aliases,match:'EXACT',behavior:'REPLACE',card:{type:'dinner',title:spec.title,restaurants:spec.restaurants,additionalRestaurants:spec.additionalRestaurants,sourceCollection:spec.sourceCollection,note:spec.note}}),mode:'TRIGGER',status:'APPROVED',source:spec.source})
const directory=existing.items.find(e=>e.question==='外卖红黑榜'),aliases=['外卖红黑榜','查看外卖红黑榜','请根据外卖红黑榜介绍外卖推荐与避雷信息','外卖红榜','外卖黑榜','查看外卖红榜','查看外卖黑榜']
if(!directory)await call('/knowledge/entries',{baseId:base.id,title:'外卖红黑榜',question:'外卖红黑榜',aliases,answer:JSON.stringify({version:1,any:aliases,match:'EXACT',behavior:'REPLACE',card:{type:'takeout',title:'外卖红黑榜'}}),mode:'TRIGGER',status:'APPROVED',source:'用户提供 extracted.json · 同学餐饮经验'})
console.log(JSON.stringify({configured:true,created:!entry,baseId:base.id,name:base.name,mounted:base.mounted}))
