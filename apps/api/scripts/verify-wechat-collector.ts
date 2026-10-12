import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {collectorStatus,collectorRequest,collectorQrImage,collectorCollection,collectionResult} from '../src/knowledge/wechat-collector'
import {KnowledgeAdminService} from '../src/knowledge/knowledge-admin.service'
const requests:string[]=[],image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3XcAAAAASUVORK5CYII=','base64')
const server=createServer(async(req,res)=>{
 const u=new URL(req.url!,'http://localhost');requests.push(u.pathname)
 if(u.pathname==='/static/wx_qrcode.png'){res.setHeader('content-type','image/png');res.end(image);return}
 res.setHeader('content-type','application/json')
 if(u.pathname.endsWith('/auth/login')){let raw='';for await(const chunk of req)raw+=chunk;const form=new URLSearchParams(raw);assert.equal(form.get('password'),'isolated-password');res.end(JSON.stringify({code:0,data:{access_token:'isolated-token',expires_in:3600}}));return}
 assert.equal(req.headers.authorization,'Bearer isolated-token')
 const data=u.pathname.includes('/mps/update/')||u.pathname.includes('/mps/collection/')?{status:'RATE_LIMITED',collected:0,retryAfter:2000000000,token:'must-never-be-returned',cookie:'private'}:u.pathname.endsWith('/qr/status')?{login_status:true,qr_code:true,token:'must-never-be-returned'}:u.pathname.endsWith('/mps')?{list:[{id:'MP_WXS_1',mp_name:'校园通知'}],total:1}:{started:true}
 res.end(JSON.stringify({code:0,data}))
})
async function main(){
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number}
 process.env.WECHAT_COLLECTOR_URL='http://127.0.0.1:'+address.port;process.env.WECHAT_COLLECTOR_USER='isolated';process.env.WECHAT_COLLECTOR_PASSWORD='isolated-password'
 assert.deepEqual(await collectorStatus(),{available:true,loggedIn:true,qrReady:true,engine:'WEMP',loginState:'',message:''})
 await collectorRequest('/auth/qr/code');assert.equal(requests.filter(p=>p.endsWith('/auth/login')).length,1)
 assert((await collectorQrImage()).image.startsWith('data:image/png;base64,'))
 const service=new KnowledgeAdminService({} as any,{} as any,{} as any,{} as any,{} as any)
 // An administrator-supplied URL cannot receive the server's collector credential.
 await service.wechatAccounts({connection:{mode:'API',managed:true,baseUrl:'https://attacker.example.invalid',apiPath:'/other',accountIds:[]},keyword:'中国社会科学院大学'})
 assert(requests.includes('/api/v1/wx/mps'))
 const job=await collectorCollection('MP_WXS_1',true);assert.equal(job.status,'RATE_LIMITED');assert.equal(job.retryAfter,2000000000);assert(!JSON.stringify(job).includes('private'));assert(!JSON.stringify(job).includes('token'))
 await assert.rejects(()=>collectorCollection('../auth/login'),/ID 无效/);assert.throws(()=>collectionResult({total:0},'MP_WXS_1'),/尚不支持采集进度/)
 const collecting=new KnowledgeAdminService({} as any,{} as any,{} as any,{log:async()=>{}} as any,{} as any)
 const config={mode:'API',managed:true,baseUrl:'https://attacker.example.invalid',accountIds:['MP_WXS_1']}
 assert.equal((await collecting.collectWechat({connection:config},{id:'fixture',email:'fixture'})).accounts[0].status,'RATE_LIMITED')
 await assert.rejects(()=>collecting.collectWechat({connection:{...config,accountIds:['MP_WXS_missing']}},{id:'fixture',email:'fixture'}),/尚未订阅/)
 await assert.rejects(()=>collecting.collectWechat({connection:{mode:'RSS',feedUrl:'https://example.invalid/feed'}},{id:'fixture',email:'fixture'}),/仅用于服务器采集器/)
 console.log('PASS 采集器登录缓存、状态不泄露凭据、二维码读取、托管连接强制使用服务器地址')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close())
