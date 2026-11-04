import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readdirSync,readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {Controller,Delete,Req,ForbiddenException,UnauthorizedException} from '@nestjs/common'
import {Test} from '@nestjs/testing'
import {Reflector} from '@nestjs/core'
import {deleteCompatibility} from '../src/common/delete-compatibility'
import {RequirePermissions} from '../src/common/decorators/permissions.decorator'
import {PermissionsGuard} from '../src/common/guards/permissions.guard'
import {ModelsController} from '../src/models/models.controller'
import {ModelsService} from '../src/models/models.service'
import {ConversationsController} from '../src/conversations/conversations.controller'
import {ConversationsService} from '../src/conversations/conversations.service'
async function main(){
 const root=resolve(__dirname,'../src'),routes:string[]=[]
 for(const dir of readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()))for(const file of readdirSync(resolve(root,dir.name)).filter(f=>f.endsWith('.controller.ts'))){const source=readFileSync(resolve(root,dir.name,file),'utf8'),prefix=source.match(/@Controller\(["']([^"']+)["']\)/)?.[1];if(prefix)for(const match of source.matchAll(/@Delete\(["']([^"']+)["']\)/g))routes.push('/'+prefix+'/'+match[1])}
 assert.equal(routes.length,12,'Review new/removed DELETE routes')
 let fixtureCalls=0,removedModels=0,removedConversations=0
 class Fixtures{}
 Controller()(Fixtures)
 for(const [i,path] of routes.entries()){const name='route'+i;Object.defineProperty(Fixtures.prototype,name,{value:function(req:any){fixtureCalls++;return {method:req.method,params:req.params,query:req.query,body:req.body}}});const desc=Object.getOwnPropertyDescriptor(Fixtures.prototype,name)!;Delete(path.slice(1))(Fixtures.prototype,name,desc);RequirePermissions('fixture:delete')(Fixtures.prototype,name,desc);Req()(Fixtures.prototype,name,0)}
 const module=await Test.createTestingModule({controllers:[Fixtures]}).compile()
 const app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');app.use('/api',deleteCompatibility);app.useGlobalGuards({canActivate(ctx:any){const req=ctx.switchToHttp().getRequest();if(!req.headers.authorization)throw new UnauthorizedException();req.user={id:'owner',email:'fixture@example.invalid',permissions:req.headers.authorization==='Bearer admin'?['*']:['model:read']};return true}},new PermissionsGuard(new Reflector()));await app.listen(0,'127.0.0.1');const origin=await app.getUrl()
 const send=(method:string,path:string,override?:string,auth='Bearer admin')=>fetch(origin+'/api'+path,{method,headers:{...(auth?{Authorization:auth}:{}),...(override?{'X-CAgent-Method':override}:{}),'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify({confirmation:'保留确认内容'})})})
 try{
  for(const path of routes){const concrete=path.replace(/:([A-Za-z]+)/g,'fixture'),native=await send('DELETE',concrete+'?confirm=yes'),wrapped=await send('POST',concrete+'?confirm=yes','DELETE');assert(native.ok);assert(wrapped.ok);assert.deepEqual(await wrapped.json(),await native.json());assert.equal((await send('POST',concrete,'DELETE','Bearer read')).status,403);assert.equal((await send('POST',concrete,'DELETE','')).status,401);assert.equal((await send('POST',concrete)).status,404);assert.equal((await send('GET',concrete,'DELETE')).status,404)}
  assert.equal(fixtureCalls,24)
  // Actual controllers on a separate module avoid fixture route overlap and verify ownership.
  const module2=await Test.createTestingModule({controllers:[ModelsController,ConversationsController],providers:[{provide:ModelsService,useValue:{remove:async()=>{removedModels++;return {success:true}}}},{provide:ConversationsService,useValue:{assertAccess:async(id:string,userId:string)=>{if(id!==userId)throw new ForbiddenException('不属于当前用户')},remove:async()=>{removedConversations++;return {success:true}}}}]}).compile()
  const real=module2.createNestApplication({logger:false});real.setGlobalPrefix('api');real.use('/api',deleteCompatibility);real.useGlobalGuards({canActivate(ctx:any){ctx.switchToHttp().getRequest().user={id:'owner',email:'fixture@example.invalid',permissions:['model:read']};return true}},new PermissionsGuard(new Reflector()));await real.listen(0,'127.0.0.1')
  try{const base=await real.getUrl(),headers={'X-CAgent-Method':'DELETE'};assert.equal((await fetch(base+'/api/models/fixture',{method:'POST',headers})).status,403);assert.equal((await fetch(base+'/api/conversations/other',{method:'POST',headers})).status,403);assert((await fetch(base+'/api/conversations/owner',{method:'POST',headers})).ok);assert.equal(removedModels,0);assert.equal(removedConversations,1)}finally{await real.close()}
  console.log('PASS 12 route envelopes: auth, permissions, query/body, native DELETE, ordinary POST/GET; actual model permissions and conversation ownership preserved; no production writes')
 }finally{await app.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
