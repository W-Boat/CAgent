import 'reflect-metadata'
import assert from 'node:assert/strict'
import {SearchService,campusHost,resultUrl,searchTool} from '../src/search/search.service'
import {AgentRuntime} from '../src/chat/runtime/agent-runtime'
async function main(){
 const original=globalThis.fetch,old=process.env.DEEPSEEK_SEARCH_API_KEY,oldTavily=process.env.TAVILY_API_KEY
 const settings:any={web_search_enabled:true,web_search_provider:'deepseek',web_search_external:false,web_search_count:5,web_search_content:false}
 const service=new SearchService({get:async(k:string)=>settings[k]} as any,{provider:{findUnique:async()=>null}} as any,{decrypt:()=>''} as any)
 const calls:any[]=[];let fail=0
 process.env.DEEPSEEK_SEARCH_API_KEY='fixture-search-secret';process.env.TAVILY_API_KEY='fixture-tavily-secret'
 globalThis.fetch=async(url:any,options:any)=>{calls.push({url,input:JSON.parse(options.body),authorization:options.headers.Authorization});if(fail)return new Response('PRIVATE_ERROR_KEY',{status:fail});return new Response(JSON.stringify({results:[{title:'学院新闻',url:'https://sg.ucass.edu.cn/info/1/2.htm',summary:'真实网页摘要<script>bad()</script>',date:'2026-10-30T00:00:00Z',content:'完整正文不会默认返回'},{title:'外部报道',url:'https://news.example.org/ucass',summary:'校外媒体文章'},{title:'伪装域名',url:'https://ucass.edu.cn.evil.example/x',summary:'不能冒充校园来源'},{title:'危险地址',url:'http://127.0.0.1/private',summary:'本地地址'},{title:'重复新闻',url:'https://sg.ucass.edu.cn/info/1/2.htm#x',summary:'去重'}]}),{headers:{'content-type':'application/json'}})}
 try{
  assert(campusHost('ucass.edu.cn'));assert(campusHost('sg.ucass.edu.cn'));assert(!campusHost('ucass.edu.cn.evil.org'));assert(!campusHost('ucas.edu.cn'))
  for(const url of ['file:///private','https://u:p@ucass.edu.cn','http://localhost/a','http://127.0.0.1/a','http://[::1]/a','https://ucass.edu.cn:9090/'])assert.equal(resultUrl(url),null)
  assert(resultUrl('https://2026.ucass.edu.cn/a'))
  const first=await service.search({query:'学院新闻 site:evil.example OR 资讯'});assert.equal(first.results.length,1);assert(!first.results[0].summary.includes('bad'));assert.equal(first.results[0].content,'');assert(calls[0].input.query.endsWith('site:ucass.edu.cn'));assert(!calls[0].input.query.includes('evil.example'));assert(!JSON.stringify(first).includes('fixture-search-secret'))
  const cached=await service.search({query:'学院新闻 site:evil.example OR 资讯'});assert(cached.cached);assert.equal(calls.length,1)
  await assert.rejects(()=>service.search({query:'新闻',scope:'external'}),/尚未开启外部/)
  settings.web_search_external=true
  const external=await service.search({query:'外部报道',scope:'external'});assert.equal(external.results.length,2);assert(external.results.every(r=>!campusHost(new URL(r.url).hostname)))
  await assert.rejects(()=>service.search({query:'a'.repeat(100),after:'2026-10-30'}),/128字/)
  const abort=new AbortController();abort.abort();await assert.rejects(()=>service.search({query:'已取消的请求'},abort.signal))
  settings.web_search_provider='tavily';const tavily=await service.search({query:'学校新闻',after:'2026-10-01'});assert.equal(tavily.engine,'tavily');assert.deepEqual(calls.at(-1).input.include_domains,['ucass.edu.cn']);assert.equal(calls.at(-1).authorization,'Bearer fixture-tavily-secret')
  fail=401;await assert.rejects(()=>service.search({query:'授权错误测试'}),/授权失败/);fail=429;await assert.rejects(()=>service.search({query:'限流测试'}),/限流/);fail=0
  settings.web_search_enabled=false;const count=calls.length;assert(!await service.available());await assert.rejects(()=>service.search({query:'关闭后'}),/尚未开启/);assert.equal(calls.length,count)
  settings.web_search_enabled=true;settings.web_search_provider='deepseek';let rounds=0,executed=0
  const result=await new AgentRuntime().run({provider:{type:'OPENAI_COMPATIBLE',async *stream(options){if(++rounds===1)yield {type:'tool_call',call:{id:'search-fixture',name:'web_search',arguments:JSON.stringify({query:'学院新闻'})}};else{const data=JSON.parse(options.messages.filter(m=>m.role==='tool').at(-1)!.content as string);assert.equal(data.results[0].source,'sg.ucass.edu.cn');yield {type:'text',text:'学院新闻可在原文链接核对。'}}yield {type:'done'}}},request:{model:'fixture',apiKey:'fixture',maxTokens:256},messages:[{role:'user',content:'搜索学院新闻'}],tools:[{...searchTool,execute:async args=>{executed++;return JSON.stringify(await service.search(args))}}],contextWindow:8192,maxToolRounds:3,signal:new AbortController().signal,emit:()=>{}})
  assert.equal(executed,1);assert.equal(result.tools[0].status,'SUCCESS');assert(result.text.includes('学院新闻'))
  const dns=require('node:dns/promises'),lookup=dns.lookup,searchFetch=globalThis.fetch
  try{
   dns.lookup=async()=>[{address:'223.5.5.5',family:4}]
   globalThis.fetch=async()=>new Response(JSON.stringify({title:'真实正文',content:'<script>ignore</script>'+'正文'.repeat(6000)}))
   const page=await service.fetchPage('https://sg.ucass.edu.cn/info/1/2.htm');assert.equal(page.content.length,8000);assert(!page.content.includes('ignore'))
   dns.lookup=async()=>[{address:'10.0.0.8',family:4}];await assert.rejects(()=>service.fetchPage('https://private.example.org/'),/公开互联网/)
  }finally{dns.lookup=lookup;globalThis.fetch=searchFetch}
  console.log('PASS 子域名范围、伪装域名/IP拦截、运营商协议、去重/缓存、外部开关、取消、错误脱敏、AgentRuntime工具闭环；零真实接口费用')
 }finally{globalThis.fetch=original;if(old===undefined)delete process.env.DEEPSEEK_SEARCH_API_KEY;else process.env.DEEPSEEK_SEARCH_API_KEY=old;if(oldTavily===undefined)delete process.env.TAVILY_API_KEY;else process.env.TAVILY_API_KEY=oldTavily}
}
main().catch(e=>{console.error(e);process.exitCode=1})
