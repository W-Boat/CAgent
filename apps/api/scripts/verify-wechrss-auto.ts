import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {KnowledgeAdminService} from '../src/knowledge/knowledge-admin.service'
import {collectionResult,collectorQrImage,collectorStatus} from '../src/knowledge/wechat-collector'
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3XcAAAAASUVORK5CYII='
let calls=0,job:any={status:'SUCCEEDED',collected:2,finishedAt:Date.now()/1000,autoCollect:true,intervalMinutes:360}
const server=createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');const path=req.url||''
 const data=path.endsWith('/auth/login')?{access_token:'fixture-token',expires_in:3600}:path.endsWith('/qr/status')?{engine:'WECHRSS',login_status:false,qr_code:true,login_state:'scanned',accessToken:'hidden'}:path.endsWith('/qr/image')?{image:'data:image/png;base64,'+png}:job
 if(path.includes('/mps/collection/'))calls++
 res.end(JSON.stringify({code:0,data}))
})
async function main(){
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.WECHAT_COLLECTOR_URL='http://127.0.0.1:'+(server.address() as any).port
 const config={mode:'API',managed:true,baseUrl:process.env.WECHAT_COLLECTOR_URL,accountIds:['MP_WXS_1'],autoSync:true}
 const base:any={id:'fixture',kind:'WECHAT',connection:config,automationUserId:'owner',syncStatus:'SUCCESS',lastSyncAt:new Date(0),updatedAt:new Date(0)}
 let authorized=true,syncs=0
 const db:any={knowledgeBase:{findMany:async()=>[base]},user:{findFirst:async()=>authorized?{id:'owner',email:'owner@fixture.invalid',roles:[{role:{permissions:[{permission:{code:'campus:admin'}}]}}]}:null}}
 const service=new KnowledgeAdminService(db,{} as any,{} as any,{} as any,{} as any)
 service.sync=async(id,op)=>{assert.equal(op.id,'owner');assert.equal(id,'fixture');syncs++;base.lastSyncAt=new Date();return {} as any}
 assert.equal((await service.autoSyncWechat()).synced,1)
 assert.equal((await service.autoSyncWechat()).synced,0);assert.equal(syncs,1)
 ;(service as any).autoAttempts.clear();base.lastSyncAt=new Date(0)
 job={...job,status:'CONTENT_BLOCKED',collected:0};await service.autoSyncWechat();assert.equal(syncs,1)
 job={...job,status:'PARTIAL',collected:1};await service.autoSyncWechat();assert.equal(syncs,2)
 ;(service as any).autoAttempts.clear();base.lastSyncAt=new Date(0);authorized=false
 const previous=calls;await service.autoSyncWechat();assert.equal(calls,previous);assert.equal(syncs,2)
 authorized=true;base.connection.autoSync=false;await service.autoSyncWechat();assert.equal(syncs,2)
 base.connection.autoSync=true;base.syncStatus='FAILED';base.updatedAt=new Date();await service.autoSyncWechat();assert.equal(syncs,2)
 const status=await collectorStatus();assert.equal(status.engine,'WECHRSS');assert.equal(status.loginState,'scanned');assert(!JSON.stringify(status).includes('hidden'))
 assert.equal((await collectorQrImage()).image,'data:image/png;base64,'+png)
 assert.equal(collectionResult({...job,cookie:'private'},'MP_WXS_1').autoCollect,true)
 console.log('PASS WechRss authenticated QR, partial/fulltext states, automatic sync gate, owner permissions, freshness and failure backoff')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close())
