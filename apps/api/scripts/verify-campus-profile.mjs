import assert from 'node:assert/strict'
import {Client} from 'pg'
import {PrismaClient} from '@prisma/client'
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {loadCampusProfile,MARKER} from './lib/campus-profile.mjs'
import {applyCampusProfile} from './import-campus-profile.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),require=createRequire(import.meta.url),checks=[],pass=s=>{checks.push(s);console.log('PASS '+s)}
const url=new URL(process.env.DATABASE_URL);assert(['127.0.0.1','localhost'].includes(url.hostname),'Verification only permits a local database')
const sql=new Client({connectionString:url.href}),schema='profile_verify_'+Date.now();let db,temp
try{
 const profile=loadCampusProfile(resolve(root,'deploy/profiles/ucass'),'https://campus.example.org');assert.equal(profile.items.length,28985);assert.equal(profile.configuration.entries.length,39);assert(!JSON.stringify({configuration:profile.configuration,items:profile.items}).includes('{{SITE_ORIGIN}}'));assert(profile.items.some(i=>i.url.startsWith('https://campus.example.org/map')));pass('完整资料与配置校验，站内链接转换为自己的部署域名')
 temp=mkdtempSync(resolve(tmpdir(),'cagent-profile-'));const manifest=profile.manifest;writeFileSync(resolve(temp,'manifest.json'),JSON.stringify(manifest));writeFileSync(resolve(temp,'configuration.json'),'{}');assert.throws(()=>loadCampusProfile(temp),/checksum/);pass('文件被修改时校验失败，尚未访问数据库')
 await sql.connect();await sql.query('CREATE SCHEMA "'+schema+'"');await sql.query('SET search_path TO "'+schema+'"')
 const migrations=resolve(root,'apps/api/prisma/migrations');for(const name of readdirSync(migrations).sort())if(name!=='migration_lock.toml')await sql.query(readFileSync(resolve(migrations,name,'migration.sql'),'utf8'))
 url.searchParams.set('schema',schema);db=new PrismaClient({datasources:{db:{url:url.href}}})
 await assert.rejects(()=>applyCampusProfile(db,profile),/administrator/);pass('未初始化管理员时拒绝导入')
 const role=await db.role.create({data:{key:'super_admin',name:'隔离测试管理员'}});await db.user.create({data:{email:'profile@example.invalid',name:'隔离夹具',passwordHash:'disabled-fixture',roles:{create:{roleId:role.id}}}})
 const provider=await db.provider.create({data:{key:'deepseek',name:'自己的接口',apiKey:'sentinel-encrypted-key',baseUrl:'https://model.example.org/v1'}})
 await db.agent.create({data:{key:'campus-assistant',name:'初始助手',systemPrompt:'seed',enabled:true}})
 const result=await applyCampusProfile(db,profile);assert(result.installed);assert.equal(await db.campusGuideItem.count(),28985);assert.equal(await db.knowledgeEntry.count(),39);assert.equal(await db.knowledgeBase.count(),39);assert.equal((await db.agent.findUnique({where:{key:'campus-assistant'}})).enabled,false);const preserved=await db.provider.findUnique({where:{id:provider.id}});assert.equal(preserved.apiKey,'sentinel-encrypted-key');assert.equal(preserved.baseUrl,'https://model.example.org/v1');pass('隔离数据库完整初始化：资料、库开关、技能/Agent绑定、模型映射，保留自有密钥与接口')
 for(const b of profile.configuration.bases){const actual=await db.knowledgeBase.findUniqueOrThrow({where:{id:b.id}});assert.equal(actual.mounted,b.requiresConnection?false:b.mounted)}
 assert.equal(await db.knowledgeBase.count({where:{kind:'WECHAT',mounted:true}}),0);pass('逐库挂载状态一致，需重新配置的外部连接保持关闭')
 const {KnowledgeStoreService}=require('../dist/src/knowledge/knowledge-store.service.js'),{AuditService}=require('../dist/src/common/services/audit.service.js'),store=new KnowledgeStoreService(db,new AuditService(db));const agent=await db.agent.findUniqueOrThrow({where:{key:'ucass-guide'}})
 const dinner=await store.keywordRules('今天吃什么',agent.id),takeout=await store.keywordRules('外卖红黑榜',agent.id);assert(dinner.some(r=>r.rule.card?.type==='dinner'));assert(takeout.some(r=>r.rule.card?.type==='takeout'));assert(await store.embeddedEnabled('maps',agent.id));const shortcuts=await store.publicShortcuts();assert(shortcuts.some(s=>s.label==='今天吃什么'));assert(shortcuts.some(s=>s.label==='外卖红黑榜'));pass('真实知识服务恢复今天吃什么、红黑榜、地图和快捷按钮')
 await db.setting.update({where:{key:'site_name'},data:{value:'自己的新标题'}});const repeated=await applyCampusProfile(db,profile);assert(repeated.skipped);assert.equal((await db.setting.findUniqueOrThrow({where:{key:'site_name'}})).value,'自己的新标题');assert.equal(await db.campusGuideItem.count(),28985);pass('重复运行不重复导入、不覆盖管理员后续修改')
 await db.setting.delete({where:{key:MARKER}});await assert.rejects(()=>applyCampusProfile(db,profile),/Existing business data/);pass('对已有业务数据库默认拒绝覆盖')
 const out=resolve(root,'storage/shots/profile');mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'verification.json'),JSON.stringify({passed:true,checks,isolatedSchema:true,externalModelCalls:0},null,2))
}finally{if(db)await db.$disconnect();if(sql._connected){await sql.query('SET search_path TO public');await sql.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await sql.end()}if(temp)rmSync(temp,{recursive:true,force:true})}
