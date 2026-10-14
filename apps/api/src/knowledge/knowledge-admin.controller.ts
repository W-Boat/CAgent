import { BadRequestException,NotFoundException,Body, Controller, Get, Param, Patch, Post, Put,Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { PrismaService } from '../prisma/prisma.service'
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator'
import { RequirePermissions } from '../common/decorators/permissions.decorator'
import { KnowledgeAdminService } from './knowledge-admin.service'
import {CollectiveTimetableService} from './collective-timetable.service'
import {CollectiveTimetableDto} from './knowledge.dto'
import { KnowledgeStoreService } from './knowledge-store.service'
import { BaseDto, CorrectionDto, EntryDto, MountDto, ParseDto, ResolveFeedbackDto,WechatAccountsDto,AutomationPolicyDto,RemoveBaseDto } from './knowledge.dto'
import {SettingsService} from '../settings/settings.service'
import {KnowledgeAutomationService} from './knowledge-automation.service'
import { CampusGuideService } from '../campus/campus-guide.service'
import {resolveCampusMap} from '../campus/campus-map'
import {collectorRequest,collectorStatus,collectorQrImage,collectorCollection,collectorBatchResult} from './wechat-collector'
import {articleUrl} from './wechat-source'
import {campusQuery,isSupportUrgent} from './keyword-rule'
@ApiTags('知识库管理') @ApiBearerAuth() @Controller('knowledge')
export class KnowledgeAdminController {
  constructor(private admin:KnowledgeAdminService,private store:KnowledgeStoreService,private prisma:PrismaService,private guide:CampusGuideService,private automation:KnowledgeAutomationService,private settings:SettingsService,private collective:CollectiveTimetableService) {}
  @Post('collective-timetable/import') @RequirePermissions('campus:admin') async importCollective(@Body() dto:CollectiveTimetableDto,@CurrentUser() me:AuthUser){
    const result=await this.collective.import(dto)
    await this.prisma.auditLog.create({data:{userId:me.id,actor:me.email,action:'knowledge.collective-timetable.import',resource:'knowledge_base',resourceId:result.baseId,detail:result}})
    return result
  }
  @Get('automation/policy') @RequirePermissions('campus:admin') policy(){return this.automation.policy()}
  @Put('automation/policy') @RequirePermissions('setting:write') async updatePolicy(@Body() dto:AutomationPolicyDto,@CurrentUser() me:AuthUser){
    if(dto.modelId&&!await this.prisma.model.findFirst({where:{id:dto.modelId,enabled:true,provider:{enabled:true}}}))throw new BadRequestException('请选择可用模型')
    await this.settings.updateMany({knowledge_ai_review_enabled:dto.reviewEnabled,knowledge_ai_summary_enabled:dto.summaryEnabled,knowledge_ai_model_id:dto.modelId||'',knowledge_ai_batch_size:dto.batchSize??2},me)
    return this.automation.policy()
  }
  @Get('wechat/collector/status') @RequirePermissions('campus:admin') collectorStatus(){return collectorStatus()}
  @Post('wechat/collector/login') @RequirePermissions('campus:admin') async collectorLogin(){await collectorRequest('/auth/qr/code');return {started:true}}
  @Get('wechat/collector/qr') @RequirePermissions('campus:admin') collectorQr(){return collectorQrImage()}
  @Get('wechat/collector/search') @RequirePermissions('campus:admin') async collectorSearch(@Query('q') q:string){
    if(!q?.trim() || q.length>100)throw new BadRequestException('请输入 100 字以内的公众号名称')
    const data=await collectorRequest('/mps/search/'+encodeURIComponent(q.trim())+'?limit=5')
    const items=Array.isArray(data)?data:data?.list || []
    return {items:items.slice(0,5).map((a:any)=>({id:String(a.fakeid || a.faker_id || a.id || ''),name:String(a.nickname || a.mp_name || a.name || '').slice(0,120),alias:String(a.alias || '').slice(0,120)})).filter((a:any)=>a.id&&a.name)}
  }
  @Post('wechat/collector/subscribe') @RequirePermissions('campus:admin') async collectorSubscribe(@Body() data:{id:string;name:string},@CurrentUser() me:AuthUser){
    if(typeof data.id!=='string'||typeof data.name!=='string'||!data.id.trim()||data.id.length>150||!data.name.trim()||data.name.length>120)throw new BadRequestException('公众号信息不完整')
    const result=await collectorRequest('/mps','POST',{mp_id:data.id,mp_name:data.name})
    return {id:result.id,name:result.mp_name}
  }
  @Post('wechat/collector/article') @RequirePermissions('campus:admin') async subscribeArticle(@Body() data:{url:string;name?:string},@CurrentUser() me:AuthUser){
    const {articleUrl}=await import('./wechat-source')
    if(typeof data.url!=='string'||!articleUrl(data.url)||data.name!==undefined&&(typeof data.name!=='string'||data.name.length>120))throw new BadRequestException('请填写有效的公众号文章链接')
    const result=await collectorRequest('/mps/from-article','POST',{url:data.url,name:data.name||''})
    return {id:String(result.id),name:String(result.mp_name).slice(0,120)}
  }
  @Post('wechat/collector/batch') @RequirePermissions('campus:admin') async batchSubscribe(@Body() data:{items:{id?:string;url?:string;name?:string}[]}){
    if(!data||!Array.isArray(data.items)||!data.items.length||data.items.length>50)throw new BadRequestException('每批请提交 1–50 个公众号')
    const items=data.items.map((item,i)=>{
      if(!item||typeof item.name!=='undefined'&&(typeof item.name!=='string'||item.name.length>120))throw new BadRequestException(`第 ${i+1} 项公众号名称无效`)
      if(item.id){if(typeof item.id!=='string'||!/^MP_WXS_\d{1,20}$/.test(item.id))throw new BadRequestException(`第 ${i+1} 项公众号 ID 无效`);return {id:item.id,name:item.name||''}}
      const url=typeof item.url==='string'?articleUrl(item.url):null
      if(!url)throw new BadRequestException(`第 ${i+1} 项请填写有效的微信公众号文章链接`)
      return {url:url.url,name:item.name||''}
    })
    return collectorBatchResult(await collectorRequest('/mps/batch','POST',{items}))
  }
  @Get('wechat/collector/batch/:id') @RequirePermissions('campus:admin') async batchStatus(@Param('id') id:string){
    if(!/^[a-f0-9]{32}$/.test(id))throw new BadRequestException('批次 ID 无效')
    return collectorBatchResult(await collectorRequest('/mps/batch/'+id))
  }
  @Post('wechat/collector/batch/:id/attach') @RequirePermissions('campus:admin') attachBatch(@Param('id') id:string,@CurrentUser() me:AuthUser){return this.admin.attachWechatBatch(id,me)}
  @Patch('wechat/collector/accounts/:id/automation') @RequirePermissions('campus:admin') async collectAutomation(@Param('id') id:string,@Body() dto:{enabled:boolean;intervalMinutes:number}){
    if(!/^MP_WXS_\d{1,20}$/.test(id)||typeof dto.enabled!=='boolean'||!Number.isInteger(dto.intervalMinutes)||dto.intervalMinutes<60||dto.intervalMinutes>10080)throw new BadRequestException('请设置采集开关与 60–10080 分钟的频率')
    await collectorRequest('/mps/automation/'+id,'PATCH',dto);return collectorCollection(id)
  }
  @Post('wechat/accounts') @RequirePermissions('campus:admin') wechatAccounts(@Body() dto:WechatAccountsDto){return this.admin.wechatAccounts(dto)}
  @Post('wechat/test') @RequirePermissions('campus:admin') testWechat(@Body() dto:WechatAccountsDto){return this.admin.testWechat(dto)}
  @Post('wechat/collect') @RequirePermissions('campus:admin') collectWechat(@Body() dto:WechatAccountsDto,@CurrentUser() me:AuthUser){return this.admin.collectWechat(dto,me)}
  @Get('wechat/collector/collection/:id') @RequirePermissions('campus:admin') collectionStatus(@Param('id') id:string){return collectorCollection(id)}
  @Post('bases/:id/automate') @RequirePermissions('campus:admin') automate(@Param('id') id:string){return this.automation.queue(id)}
  @Post('entries/:id/automate') @RequirePermissions('campus:admin') retryAutomation(@Param('id') id:string){return this.automation.retry(id)}
  @Get('probe') @RequirePermissions('campus:admin') async probe(@Query('q') q:string,@Query('agentId') agentId?:string) {
    const query=(q || '').slice(0,1000)
    const rules=await this.store.keywordRules(query,agentId)
    const fixed = isSupportUrgent(query)||rules.some(r=>r.rule.behavior==='INSTRUCT')?null:await this.store.fixed(campusQuery(query),agentId,false)
    const search = await this.guide.search(campusQuery(query),'full',5,{agentId})
    return {...search,rules:rules.map(({entry,rule})=>({id:entry.id,title:entry.title,...rule})),map:isSupportUrgent(query)||!await this.store.embeddedEnabled('maps',agentId)?null:resolveCampusMap(query),fixed:fixed ? {id:fixed.id,title:fixed.title,question:fixed.question,answer:fixed.answer,baseId:fixed.baseId} : null}
  }
  @Get('bases') @RequirePermissions('campus:admin') bases() {return this.admin.bases()}
  @Get('bases/:id/shortcuts') @RequirePermissions('campus:admin') shortcuts(@Param('id') id:string){return this.store.shortcutBindings(id)}
  @Put('bases/:id/shortcuts') @RequirePermissions('campus:admin') saveShortcuts(@Param('id') id:string,@Body() bindings:unknown,@CurrentUser() me:AuthUser){return this.store.saveShortcutBindings(id,bindings,me)}
  @Post('bases') @RequirePermissions('campus:admin') createBase(@Body() dto:BaseDto,@CurrentUser() me:AuthUser) {return this.admin.saveBase(dto,me)}
  @Patch('bases/:id') @RequirePermissions('campus:admin') editBase(@Param('id') id:string,@Body() dto:BaseDto,@CurrentUser() me:AuthUser) {return this.admin.saveBase(dto,me,id)}
  @Post('bases/:id/mount') @RequirePermissions('campus:admin') mount(@Param('id') id:string,@Body() dto:MountDto,@CurrentUser() me:AuthUser) {return this.admin.mount(id,dto.mounted,me)}
  @Post('bases/:id/remove') @RequirePermissions('campus:admin') remove(@Param('id') id:string,@Body() dto:RemoveBaseDto,@CurrentUser() me:AuthUser){return this.admin.removeBase(id,dto.name,me)}
  @Post('bases/:id/sync') @RequirePermissions('campus:admin') sync(@Param('id') id:string,@CurrentUser() me:AuthUser) {return this.admin.sync(id,me)}
  @Get('entries') @RequirePermissions('campus:admin') async entries(@Query('baseId') baseId?:string,@Query('status') status?:string,@Query('page') page?:string,@Query('keyword') keyword?:string,@Query('section') section?:string) {
    const text=(keyword || '').trim()
    if(text.length>200) throw new BadRequestException('搜索内容不能超过 200 字')
    if(baseId){const base=await this.prisma.knowledgeBase.findUnique({where:{id:baseId}});if(!base||base.kind==='REMOVED')throw new NotFoundException('知识库不存在或已移除');if(base.kind==='EMBEDDED')return this.store.embeddedEntries(base,text,status,Number(page)||1,(section||'').slice(0,300))}
    return this.prisma.paginate(this.prisma.knowledgeEntry,{where:{base:{kind:{not:'REMOVED'}},...(baseId?{baseId}:{}),...(status?{status}:{}),...(text?{OR:['title','question','answer'].map(field=>({[field]:{contains:text,mode:'insensitive' as const}}))}:{})},orderBy:[{updatedAt:'desc'},{id:'desc'}],include:{base:{select:{name:true}}}},Number(page)||1,20)
  }
  @Post('entries') @RequirePermissions('campus:admin') createEntry(@Body() dto:EntryDto,@CurrentUser() me:AuthUser) {return this.store.save(dto,me)}
  @Patch('entries/:id') @RequirePermissions('campus:admin') editEntry(@Param('id') id:string,@Body() dto:EntryDto,@CurrentUser() me:AuthUser) {return this.store.save(dto,me,id)}
  @Get('entries/:id/revisions') @RequirePermissions('campus:admin') revisions(@Param('id') id:string) {return this.prisma.knowledgeRevision.findMany({where:{entryId:id},orderBy:{createdAt:'desc'},take:30})}
  @Post('entries/:id/restore/:revisionId') @RequirePermissions('campus:admin') async restore(@Param('id') id:string,@Param('revisionId') revisionId:string,@CurrentUser() me:AuthUser) {
    const r = await this.prisma.knowledgeRevision.findFirstOrThrow({where:{id:revisionId,entryId:id}})
    const s = r.snapshot as any
    return this.store.save({...s,status:'DRAFT'},me,id)
  }
  @Post('parse') @RequirePermissions('campus:admin') parse(@Body() dto:ParseDto,@CurrentUser() me:AuthUser) {return this.admin.parse(dto.text,me,dto.modelId)}
  @Get('feedback') @RequirePermissions('learning:read') feedback(@Query('page') page?:string,@Query('resolution') resolution?:string) {return this.admin.feedback({page:Number(page)||1,resolution})}
  @Post('feedback/:id/correct') @RequirePermissions('learning:review') correct(@Param('id') id:string,@Body() dto:CorrectionDto,@CurrentUser() me:AuthUser) {return this.admin.correctFeedback(id,dto,me)}
  @Patch('feedback/:id') @RequirePermissions('learning:review') resolve(@Param('id') id:string,@Body() dto:ResolveFeedbackDto,@CurrentUser() me:AuthUser) {return this.admin.resolveFeedback(id,dto.resolution,dto.note,me)}
}
