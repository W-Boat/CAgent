import {parseKeywordRule,keywordCardMarkup} from '../knowledge/keyword-rule'
import {metadata} from './knowledge-retriever'
export function contentFormat(row:any){
 const m=metadata(row)
 if(m.collection==='maps')return 'map'
 if(m.mode==='TRIGGER')return 'rule'
 if(['FIXED','CORRECTION'].includes(m.mode))return 'fixed'
 if(/```card/.test(row.detail||row.summaryShort||''))return 'cards'
 if(/attachment|document/.test(row.detailStatus||'')||/附件|文档/.test(row.type||''))return 'document'
 return row.url?'link':'article'
}
export function managedContent(entry:any){
 let detail=entry.answer
 if(entry.mode==='TRIGGER')try{const rule=parseKeywordRule(entry.answer);detail=[rule.text,rule.instruction,`触发词：${[...rule.all.map((g:string[])=>g.join(' / ')),...rule.any].join('；')}`,keywordCardMarkup(rule,entry.id)].filter(Boolean).join('\n\n')}catch{detail='关键词约定格式无效，请在知识库管理中修复。'}
 return {id:'managed:'+entry.id,externalId:0,title:entry.title,url:entry.url,cat:entry.base.name,type:'知识',source:entry.source||entry.base.name,summaryShort:detail.slice(0,240),detail,detailStatus:'basic',steps:[],keyFacts:[],views:entry.hitCount,
  verifiedAt:entry.updatedAt.toISOString(),extra:{kb:{collection:'base:'+entry.baseId,file:entry.base.name,locator:entry.externalKey||entry.id,trust:entry.aiReview?.method==='AI'&&entry.aiReviewStatus==='APPROVED'?'ai_reviewed':'reviewed',mode:entry.mode,agentId:entry.base.agentId}},entryMode:entry.mode}
}
