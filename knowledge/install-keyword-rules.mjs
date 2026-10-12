#!/usr/bin/env node
import {readFileSync} from 'node:fs'
const root=new URL('../',import.meta.url)
for(const line of readFileSync(new URL('.env',root),'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const at=process.argv.indexOf('--api'),origin=at>=0?process.argv[at+1]:'http://127.0.0.1:3001'
if(!/^https?:\/\//.test(origin))throw new Error('Invalid API origin')
const email=process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL,password=process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD
const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}).then(r=>r.json())
if(login.code!==0)throw new Error('管理员登录失败')
const headers={'Content-Type':'application/json',Authorization:'Bearer '+login.data.accessToken}
async function call(method,path,body){const r=await fetch(origin+'/api/knowledge'+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const b=await r.json();if(!r.ok||b.code!==0)throw new Error(path+': '+b.message);return b.data}
const spec=JSON.parse(readFileSync(new URL('campus-keyword-rules.json',import.meta.url),'utf8'))
let base=(await call('GET','/bases')).find(b=>b.name===spec.name)
if(!base)base=await call('POST','/bases',{name:spec.name,description:spec.description,kind:'LOCAL',mounted:false})
let existing=[],page=1
while(true){const result=await call('GET','/entries?baseId='+encodeURIComponent(base.id)+'&page='+page);existing.push(...result.items);if(existing.length>=result.total)break;page++}
for(const e of spec.entries){const old=existing.find(x=>x.title===e.title);const data={baseId:base.id,title:e.title,question:e.question||e.title,answer:e.rule?JSON.stringify(e.rule,null,2):e.answer,aliases:e.aliases||[],mode:e.mode,status:'APPROVED',source:'管理员指定的校园约定（2026-10-04）',priority:e.priority||50};await call(old?'PATCH':'POST','/entries'+(old?'/'+old.id:''),data);console.log('已保存：'+e.title)}
await call('POST','/bases/'+base.id+'/mount',{mounted:true})
console.log('已挂载 '+spec.name+'；'+spec.entries.length+' 条。')
