import { get, post, patch, put } from './client'
export interface KnowledgeBase {id:string;name:string;description:string;kind:'LOCAL'|'POSTGRES'|'MYSQL'|'WECHAT'|'EMBEDDED';readOnly?:boolean;mounted:boolean;agentId?:string;connection?:any;hasPassword:boolean;syncStatus:string;syncError?:string;lastSyncAt?:string;lastSyncSummary?:{articles:number;created:number;changed:number;unchanged:number;skipped:number;limited:boolean;warnings:string[]};aiReviewEnabled?:boolean;aiSummaryEnabled?:boolean;automationModelId?:string;_count?:{entries:number}}
export interface KnowledgeEntry {readOnly?:boolean;simulation?:boolean;locator?:string;id?:string;baseId:string;title:string;question:string;answer:string;aliases:string[];url:string;mode:'RAG'|'FIXED'|'CORRECTION'|'TRIGGER';status:'DRAFT'|'APPROVED'|'ARCHIVED';source:string;priority?:number;hitCount?:number;base?:{name:string};summary?:string;aiReviewStatus?:string;aiReview?:{reason?:string;issues?:string[];method?:string};automationUpdatedAt?:string}
export interface AutomationPolicy {reviewEnabled:boolean;summaryEnabled:boolean;modelId:string;batchSize:number}
export interface KnowledgeShortcut {label:string;question:string;enabled:boolean;dependencies:string[]}
export interface WechatCollection {id:string;name?:string;status:string;message:string;collected:number;retryAfter?:number;autoCollect?:boolean;intervalMinutes?:number;nextCollectAt?:number}
export interface WechatBatch {id:string;status:string;total:number;items:{index:number;id?:string;name:string;status:string;message:string}[]}
export interface WechatTestResult {connected:boolean;mode:string;totalAccounts:number;testedAccounts:number;ready:number;elapsedMs:number;checkedAt:string;tip:string;accounts:{id:string;name:string;status:'READY'|'NO_BODY'|'EMPTY'|'FAILED';message:string;sample?:{title:string;url:string;published:string;excerpt:string}}[]}
export const knowledgeApi = {
  collectorStatus:()=>get<{available:boolean;loggedIn:boolean;qrReady:boolean;engine?:string;loginState?:string;message?:string}>('/knowledge/wechat/collector/status'),
  collectorArticle:(data:{url:string;name?:string})=>post<{id:string;name:string}>('/knowledge/wechat/collector/article',data),
  collectorBatch:(items:{id?:string;url?:string;name?:string}[])=>post<WechatBatch>('/knowledge/wechat/collector/batch',{items}),
  collectorBatchStatus:(id:string)=>get<WechatBatch>('/knowledge/wechat/collector/batch/'+id),
  attachCollectorBatch:(id:string)=>post<{created:number;existing:number;items:{id:string;name:string;status:string;baseId?:string}[]}>('/knowledge/wechat/collector/batch/'+id+'/attach'),
  collectorAutomation:(id:string,data:{enabled:boolean;intervalMinutes:number})=>patch<WechatCollection>('/knowledge/wechat/collector/accounts/'+encodeURIComponent(id)+'/automation',data),
  collectorLogin:()=>post('/knowledge/wechat/collector/login'),
  collectorQr:()=>get<{image:string}>('/knowledge/wechat/collector/qr'),
  collectorSearch:(q:string)=>get<{items:{id:string;name:string;alias:string}[]}>('/knowledge/wechat/collector/search',{q}),
  collectorSubscribe:(data:{id:string;name:string})=>post<{id:string;name:string}>('/knowledge/wechat/collector/subscribe',data),
  automationPolicy:()=>get<AutomationPolicy>('/knowledge/automation/policy'),
  saveAutomationPolicy:(data:AutomationPolicy)=>put<AutomationPolicy>('/knowledge/automation/policy',data),
  automateBase:(id:string)=>post<{tip:string}>(`/knowledge/bases/${id}/automate`),
  automateEntry:(id:string)=>post<{tip:string}>(`/knowledge/entries/${id}/automate`),
  wechatAccounts:(data:{connection:any;password?:string;baseId?:string;keyword?:string})=>post<{items:{id:string;name:string;description:string}[];total:number}>('/knowledge/wechat/accounts',data),
  wechatTest:(data:{connection:any;password?:string;baseId?:string})=>post<WechatTestResult>('/knowledge/wechat/test',data),
  wechatCollect:(data:{connection:any;baseId?:string})=>post<{accounts:WechatCollection[];tip:string}>('/knowledge/wechat/collect',data),
  wechatCollection:(id:string)=>get<WechatCollection>('/knowledge/wechat/collector/collection/'+encodeURIComponent(id)),
  probe:(q:string,agentId?:string)=>get<any>('/knowledge/probe',{q,agentId}),
  bases:()=>get<KnowledgeBase[]>('/knowledge/bases'),
  shortcuts:(id:string)=>get<KnowledgeShortcut[]>(`/knowledge/bases/${id}/shortcuts`),
  saveShortcuts:(id:string,data:KnowledgeShortcut[])=>put<KnowledgeShortcut[]>(`/knowledge/bases/${id}/shortcuts`,data),
  saveBase:(data:Partial<KnowledgeBase> & {password?:string},id?:string)=>id?patch<KnowledgeBase>(`/knowledge/bases/${id}`,data):post<KnowledgeBase>('/knowledge/bases',data),
  mount:(id:string,mounted:boolean)=>post(`/knowledge/bases/${id}/mount`,{mounted}),
  removeBase:(id:string,name:string)=>post<{removed:boolean;tip:string}>(`/knowledge/bases/${id}/remove`,{name}),
  sync:(id:string)=>post<{count:number;tip:string}>(`/knowledge/bases/${id}/sync`),
  entries:(params:{baseId?:string;status?:string;page?:number;keyword?:string;section?:string})=>get<{items:KnowledgeEntry[];total:number;sections?:{value:string;label:string;count:number}[]}>('/knowledge/entries',params),
  saveEntry:(data:KnowledgeEntry)=>data.id?patch<KnowledgeEntry>(`/knowledge/entries/${data.id}`,data):post<KnowledgeEntry>('/knowledge/entries',data),
  parse:(text:string,modelId?:string)=>post<Omit<KnowledgeEntry,'baseId'>[]>('/knowledge/parse',{text,modelId}),
  revisions:(id:string)=>get<any[]>(`/knowledge/entries/${id}/revisions`),
  restore:(id:string,revisionId:string)=>post(`/knowledge/entries/${id}/restore/${revisionId}`),
  feedback:(params:{page?:number;resolution?:string})=>get<{items:any[];total:number}>('/knowledge/feedback',params),
  correctFeedback:(id:string,question:string,answer:string)=>post(`/knowledge/feedback/${id}/correct`,{question,answer}),
  resolveFeedback:(id:string,resolution:string,note='')=>patch(`/knowledge/feedback/${id}`,{resolution,note})
}
