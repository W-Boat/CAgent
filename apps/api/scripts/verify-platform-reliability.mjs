import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {mkdtemp,rm} from 'node:fs/promises'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),req=createRequire(resolve(root,'apps/api/package.json')),ts=req('typescript'),checks=[]
const pass=s=>{checks.push(s);console.log('PASS '+s)}
function moduleAt(file,deps,globals={}){const source=readFileSync(resolve(root,file),'utf8').replace('import.meta.env.VITE_API_BASE','undefined'),mod={exports:{}};new Function('module','exports','require',...Object.keys(globals),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports,k=>deps[k],...Object.values(globals));return mod.exports}
const tokens=new Map(),storage={getItem:k=>tokens.get(k),setItem:(k,v)=>tokens.set(k,v),removeItem:k=>tokens.delete(k)}
let refreshCalls=0,post,unauthorized=0,responseInterceptor,release
const http={interceptors:{request:{use(){}},response:{use(_ok,fail){responseInterceptor=fail}}},request:async config=>config}
const axios={__esModule:true,default:{create:()=>http,post:(...args)=>{refreshCalls++;return post(...args)}}}
const client=moduleAt('apps/web/src/api/client.ts',{axios},{localStorage:storage,navigator:{locks:{request:(_name,cb)=>Promise.resolve().then(cb)}}})
client.setUnauthorizedHandler(()=>unauthorized++)
client.tokenStore.set('old','refresh-old')
post=()=>new Promise(resolve=>release=()=>resolve({data:{data:{accessToken:'new',refreshToken:'refresh-new'}}}))
const pending=Array.from({length:8},()=>client.ensureAccessToken('old'))
await Promise.resolve();release();assert.deepEqual(await Promise.all(pending),Array(8).fill('new'));assert.equal(refreshCalls,1)
const delayed=await responseInterceptor({response:{status:401},config:{url:'/auth/me',headers:{Authorization:'Bearer old'}}});assert.equal(delayed.headers.Authorization,'Bearer new');assert.equal(refreshCalls,1);assert.equal(unauthorized,0)
pass('并发 JSON/SSE 共用一次刷新；迟到的旧 401 复用新令牌，不重复轮换或退出')
post=async()=>{throw {response:{status:503}}};await assert.rejects(()=>client.ensureAccessToken('new'));assert.equal(client.tokenStore.access,'new');assert.equal(unauthorized,0)
pass('临时刷新服务异常保留会话，不错误清除登录')
post=()=>new Promise(resolve=>release=()=>resolve({data:{data:{accessToken:'resurrect',refreshToken:'resurrect-refresh'}}}))
const logout=client.ensureAccessToken('new');await Promise.resolve();client.tokenStore.clear();release();await assert.rejects(()=>logout,/SESSION_CHANGED/);assert.equal(client.tokenStore.access,'')
client.tokenStore.set('bad','bad-refresh');post=async()=>{throw {response:{status:401}}};await assert.rejects(()=>client.ensureAccessToken('bad'));assert.equal(client.tokenStore.access,'');assert.equal(unauthorized,1)
pass('登出后的迟到刷新不能恢复账户，确实失效的刷新令牌只退出一次')
let requests=0,frames=0,finished
const sse=moduleAt('apps/web/src/api/sse.ts',{'./upload-stream':{}},{fetch:async()=>{requests++;return requests===1?new Response('{}',{status:401}):new Response('event: text\ndata: {"text":"成功"}\n\nevent: done\ndata: {"status":"SUCCESS"}\n\n',{headers:{'Content-Type':'text/event-stream'}})}})
await sse.requestSse({url:'/chat',body:{content:'测试'},authorize:async rejected=>rejected?'fresh':'expired',onFrame:()=>frames++,onDone:r=>finished=r,onError:e=>{throw Error(e)}}).done
assert.equal(requests,2);assert.equal(frames,1);assert.equal(finished.status,'SUCCESS')
pass('SSE 只在生成开始前的 HTTP401 续期并重发一次，终态不会重复生成')
const {KnowledgeStoreService}=req('./dist/src/knowledge/knowledge-store.service.js')
let rev=1,scans=0
const db={setting:{findUnique:async()=>({value:rev}),upsert:async()=>{rev++}},knowledgeBase:{findMany:async()=>[]}}
const store=new KnowledgeStoreService(db,{})
store.embeddedCounts=async()=>{scans++;await Promise.resolve();return []}
await Promise.all(Array.from({length:8},()=>store.ensureEmbedded()));await store.ensureEmbedded();assert.equal(scans,1);await store.bump();await store.ensureEmbedded();assert.equal(scans,2)
pass('准备阶段八次并发及重复调用只扫描一次知识库，语义修改立即失效')
const {ResponseCacheService,cacheEligible}=req('./dist/src/chat/response-cache.service.js'),tmp=await mkdtemp(resolve(root,'.tmp/reliability-cache-')),cwd=process.cwd();process.chdir(tmp)
const cache=new ResponseCacheService({setting:{findMany:async()=>[{key:'knowledge_revision',value:rev}]},skill:{aggregate:async()=>({_count:1,_max:{updatedAt:new Date('2026-10-01')}})}} ,{get:async key=>key==='answer_cache_enabled'?true:3});process.chdir(cwd)
try{
 const a={user:'one',question:'学校图书馆几点闭馆',skills:['b','a'],target:{name:'m',id:'m'}},b={target:{id:'m',name:'m'},skills:['a','b'],question:a.question,user:'one'}
 const first=await cache.prepare(a),same=await cache.prepare(b);assert.equal(first.key,same.key)
 await cache.put(first,{content:'以学校最新开放安排为准。',sources:[],presentation:{valid:true}})
 assert(await cache.get(same));rev++;assert.equal(await cache.get(await cache.prepare(a)),null)
 assert(cacheEligible('全校课表'));assert(cacheEligible('图书馆几点闭馆'));assert(!cacheEligible('今天有什么课'))
 pass('同题同权限缓存不受对象顺序、技能顺序和统计影响，资料修订失效，固定时刻/课表允许复用')
}finally{await rm(tmp,{recursive:true,force:true})}
const {CampusGuideService}=req('./dist/src/campus/campus-guide.service.js')
let indexRevision=1,indexReads=0
const indexStore={revision:async()=>indexRevision,embeddedWhere:async()=>({}),rows:async()=>[]}
const guide=new CampusGuideService({campusGuideItem:{count:async()=>0,findMany:async()=>{indexReads++;return []}}},indexStore)
const previousIndex={rows:[]};guide.snapshot={index:previousIndex,expires:0};guide.loadedRevision=1
assert.equal(await guide.index(),previousIndex);assert.equal(indexReads,0)
indexRevision=2;assert.notEqual(await guide.index(),previousIndex);assert.equal(indexReads,1)
pass('索引不因60秒计时失效，资料修订会立即重建')
mkdirSync(resolve(root,'storage/shots/reliability'),{recursive:true});writeFileSync(resolve(root,'storage/shots/reliability/unit.json'),JSON.stringify({passed:true,checks,externalModelCalls:0},null,2))
