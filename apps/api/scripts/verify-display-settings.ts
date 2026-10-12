import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {PrismaService} from '../src/prisma/prisma.service'
import {AuditService} from '../src/common/services/audit.service'
import {SettingsService} from '../src/settings/settings.service'
import {SettingsController} from '../src/settings/settings.controller'
import {SETTING_DEFS} from '../src/settings/setting-defs'
const root=resolve(__dirname,'../../..'),checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
async function main(){
 for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
 assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname),'禁止在生产数据库运行配置 fixture')
 const prisma=new PrismaService(),settings=new SettingsService(prisma,new AuditService(prisma)),controller=new SettingsController(settings)
 const keys=SETTING_DEFS.filter(d=>d.group==='student').map(d=>d.key),before=await prisma.setting.findMany({where:{key:{in:keys}}});let actorId=''
 try{
  const actor=await prisma.user.create({data:{email:'display-'+Date.now()+'@example.invalid',name:'显示控制验证',passwordHash:'disabled-fixture'}});actorId=actor.id
  const operator={id:actorId,email:actor.email,permissions:['*']}
  const groups=await settings.grouped(['*']);assert(groups.student.some(d=>d.key==='student_show_knowledge_sources'));assert(groups.student.some(d=>d.key==='unified_theme_enabled'))
  const defaults=await controller.publicSettings();assert('student_recommended_questions' in defaults);assert(!('sensitive_words' in defaults));assert(!('browser_domain_whitelist' in defaults));pass('后台分组和公开白名单完整下发页面控制，不回传私有安全配置')
  await settings.updateMany({default_accent_color:'#0D9488',student_welcome_title:'统一欢迎标题',student_recommended_questions:['学校有几个超市？','图书馆在哪里？'],student_show_knowledge_sources:false,student_default_theme:'dark',student_allow_theme_toggle:false},operator)
  const publicConfig=await controller.publicSettings();assert.equal(publicConfig.student_welcome_title,'统一欢迎标题');assert.equal(publicConfig.student_show_knowledge_sources,false);assert.deepEqual(publicConfig.student_recommended_questions,['学校有几个超市？','图书馆在哪里？']);pass('真实 PostgreSQL 保存自定义色、文案、推荐问题、显示与明暗策略并公开读取')
  await assert.rejects(()=>settings.updateMany({student_welcome_title:'不应提交',default_accent_color:'red'},operator));assert.equal(await settings.get('student_welcome_title'),'统一欢迎标题')
  for(const payload of [{student_default_theme:'invalid'},{student_recommended_questions:Array(13).fill('问题')},{student_recommended_questions:['']},{student_recommended_questions:{}},{student_welcome_title:'x'.repeat(81)},{student_logo_url:'javascript:alert(1)'},{student_logo_url:'//example.invalid/logo'},{student_logo_url:'/\\example.invalid/logo'},{student_show_weather:'false'}])await assert.rejects(()=>settings.updateMany(payload,operator))
  pass('非法配色、选项、文案、问句和 Logo 拒绝，批量请求失败不产生部分修改')
  await settings.updateMany({student_logo_url:'/static/campus-logo.svg',student_show_weather:false},operator)
  assert((await prisma.auditLog.count({where:{userId:actorId,action:'setting.update'}}))===2);pass('站内 Logo 与开关正常保存，失败请求不写审计，成功配置有操作记录')
 }finally{
  await prisma.$transaction([...before.map(row=>prisma.setting.update({where:{key:row.key},data:{value:row.value as any}})),prisma.setting.deleteMany({where:{key:{in:keys.filter(key=>!before.some(row=>row.key===key))}}})])
  if(actorId){await prisma.auditLog.deleteMany({where:{userId:actorId}});await prisma.user.delete({where:{id:actorId}})}
  await prisma.$disconnect()
 }
 mkdirSync(resolve(root,'storage/shots/display'),{recursive:true});writeFileSync(resolve(root,'storage/shots/display/backend-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,scope:'Actual local PostgreSQL; prior settings restored and owned actor/audits removed'},null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
