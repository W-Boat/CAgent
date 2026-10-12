// Audited retirement of two obsolete knowledge adapters; content stays in RAG.
import {readFileSync} from 'node:fs'
for(const line of readFileSync(new URL('../.env',import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const index=process.argv.indexOf('--api'),origin=index>=0?process.argv[index+1]:'http://127.0.0.1:3002'
let token=''
async function request(method,path,body){const r=await fetch(origin+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined}),j=await r.json();if(j.code!==0||!r.ok)throw new Error(j.message||String(r.status));return j.data}
token=(await request('POST','/auth/login',{email:process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL,password:process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD})).accessToken
for(const [key,collection] of [['ucass-kb-survival','survival'],['ucass-kb-takeout','takeout']]){
 const catalog=await request('GET','/campus/library?collection='+collection+'&pageSize=1')
 if(!catalog.total)throw new Error('知识库内容缺失，保留旧入口：'+collection)
 const list=await request('GET','/skills?keyword='+key),skill=list.find(s=>s.key===key)
 if(skill?.enabled)await request('PATCH','/skills/'+skill.id,{enabled:false,note:'内容已迁移到知识库；旧适配器停用并保留审计记录。'})
 console.log('PASS '+collection+' 知识内容 '+catalog.total+' 条，旧技能入口已停用')
}
