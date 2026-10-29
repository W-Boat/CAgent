import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {KnowledgeAdminService} from '../src/knowledge/knowledge-admin.service'
import {testWechatSource,wechatConnectionSchema} from '../src/knowledge/wechat-source'
let detailCalls=0,writes=0
const server=createServer((req,res)=>{
  const u=new URL(req.url!,'http://localhost')
  if(u.pathname==='/feed'){res.end('<rss><channel><title>校园通知</title><item><title>通知</title><link>https://mp.weixin.qq.com/s/test</link><description>只有摘要</description></item></channel></rss>');return}
  res.setHeader('Content-Type','application/json')
  if(req.headers.authorization!=='Bearer fixture'){res.statusCode=401;res.end('{}');return}
  let data:any
  if(u.pathname.endsWith('/mps'))data={list:[{id:'ready',mp_name:'校园通知'}],total:1}
  else if(u.pathname.endsWith('/articles')){const id=u.searchParams.get('mp_id');assert.equal(u.searchParams.get('limit'),'1');data={list:id==='empty'?[]:[{id,mp_id:id,title:'校园通知',url:'https://mp.weixin.qq.com/s/'+id}],total:1}}
  else{detailCalls++;const id=u.pathname.split('/').pop();if(id==='failed'){res.statusCode=503;res.end('{}');return}data={mp_id:id,content:id==='ready'?'<div id="js_content">校园资料正文足够完整，可以用于知识库测试。<script>private</script></div>':id==='challenge'?'<html><body>环境异常 当前环境异常，完成验证后即可继续访问。去验证 微信公众平台</body></html>':''}}
  res.end(JSON.stringify({code:0,data}))
})
async function main(){
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number},baseUrl=`http://127.0.0.1:${address.port}`
  const config=wechatConnectionSchema.parse({mode:'API',baseUrl,accountIds:['ready','missing','empty','failed'],accountNames:{ready:'自定义名称'},maxArticles:4})
  const result=await testWechatSource(config,'fixture');assert.equal(result.ready,1);assert.deepEqual(result.accounts.map(a=>a.status),['READY','NO_BODY','EMPTY','FAILED']);assert.equal(result.accounts[0].name,'自定义名称');assert(!result.accounts[0].sample?.excerpt.includes('private'));assert.equal(detailCalls,3)
  await assert.rejects(()=>testWechatSource(config,'invalid'),/访问令牌/)
  const challenge=await testWechatSource({...config,accountIds:['challenge']},'fixture');assert.equal(challenge.ready,0);assert.equal(challenge.accounts[0].status,'NO_BODY')
  const rss=await testWechatSource(wechatConnectionSchema.parse({mode:'RSS',feedUrl:baseUrl+'/feed'}),'');assert.equal(rss.accounts[0].status,'NO_BODY')
  const db={knowledgeBase:{findUnique:async()=>({kind:'WECHAT',connection:config,passwordEncrypted:'encrypted'})},$transaction:()=>{writes++;throw Error('unexpected write')}}
  const service=new KnowledgeAdminService(db as any,{decrypt:()=> 'fixture'} as any,{} as any,{} as any,{} as any)
  assert.equal((await service.testWechat({connection:config,baseId:'fixture'})).ready,1)
  await assert.rejects(()=>service.testWechat({connection:{...config,baseUrl:'http://localhost:'+address.port},baseId:'fixture'}),/重新填写访问令牌/)
  const connected=await service.testWechat({connection:{...config,accountIds:[]},password:'fixture'});assert.equal(connected.testedAccounts,0);assert.equal(writes,0)
  console.log('PASS 多公众号逐项测试、完整正文与摘要区分、RSS、令牌继承与域名隔离、零写入')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close())
