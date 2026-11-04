import 'reflect-metadata'
import assert from 'node:assert/strict'
import {Test} from '@nestjs/testing'
import {Reflector} from '@nestjs/core'
import {ModelsController} from '../src/models/models.controller'
import {ModelsService} from '../src/models/models.service'
import {PermissionsGuard} from '../src/common/guards/permissions.guard'
async function main(){const calls:any[]=[];const module=await Test.createTestingModule({controllers:[ModelsController],providers:[{provide:ModelsService,useValue:{remove:async(id:string,user:any)=>{calls.push({id,user});return {success:true}}}}]}).compile();const app=module.createNestApplication({logger:false});app.use((req:any,_res:any,next:any)=>{if(req.headers.authorization)req.user={id:'fixture',email:'fixture@example.invalid',permissions:req.headers.authorization==='Bearer delete-fixture'?['model:delete']:['model:read']};next()});app.useGlobalGuards(new PermissionsGuard(new Reflector()));await app.listen(0,'127.0.0.1');const origin=await app.getUrl();try{for(const auth of ['', 'Bearer read-fixture']){const r=await fetch(origin+'/models/fixture/remove',{method:'POST',headers:auth?{Authorization:auth}:{}});assert.equal(r.status,403)}assert.equal(calls.length,0);for(const [method,path] of [['POST','/models/fixture/remove'],['DELETE','/models/fixture']]){const r=await fetch(origin+path,{method,headers:{Authorization:'Bearer delete-fixture'}});assert(r.ok);assert.deepEqual(await r.json(),{success:true})}assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);console.log('PASS POST/DELETE share audited deletion service; unauthorized and read-only accounts denied; no real deletion')}finally{await app.close()}}
main().catch(e=>{console.error(e);process.exitCode=1})
