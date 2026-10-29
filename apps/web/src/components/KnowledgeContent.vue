<template>
 <article class="knowledge-reader" :data-campus-entry="hit.id" :data-campus-collection="hit.provenance?.collection">
  <header class="reader-header">
   <div class="reader-labels"><span>{{contentFormatLabel(hit.contentFormat)}}</span><span v-if="hit.provenance">{{trustLabel}}</span><span v-if="hit.access==='校园网/VPN'">需校园网 / VPN</span></div>
   <h2>{{hit.title}}</h2><p v-if="hit.provenance" class="reader-source">来源：{{hit.provenance.file}}<span v-if="hit.provenance.locator"> · {{hit.provenance.locator}}</span></p><p v-if="hit.verifiedAt" class="reader-date">资料标注时间：{{hit.verifiedAt}}</p>
   <div v-if="url" class="reader-entry-bar"><a class="reader-entry" :href="url" target="_blank" rel="noopener noreferrer"><el-icon><TopRight /></el-icon>{{entryLabel(hit)}}</a><button type="button" class="reader-copy" @click="copyUrl"><el-icon><CopyDocument /></el-icon>复制链接</button><span>{{hostname}}</span></div>
   <p v-else class="reader-local"><el-icon><Reading /></el-icon>本条可在站内阅读，暂无外部跳转入口</p>
  </header>
  <div v-if="warnings.length" class="reader-warnings"><p v-for="warning in warnings" :key="warning"><el-icon><InfoFilled /></el-icon>{{warning}}</p></div>
  <dl v-if="facts.length" class="reader-facts"><div v-for="fact in facts" :key="fact.label+fact.value"><dt>{{fact.label}}</dt><dd>{{fact.value}}</dd></div></dl>
  <section class="reader-body" aria-label="资料正文"><CardMessage :content="body" @ask="$emit('ask',$event)" /><StudentCard v-if="hit.contentCard" :card="hit.contentCard" @ask="$emit('ask',$event)" /></section>
  <section v-if="steps.length" class="reader-section"><h3>办理步骤</h3><ol><li v-for="(step,i) in steps" :key="i">{{step}}</li></ol></section>
  <section v-if="structured.length" class="reader-section"><h3>补充资料</h3><dl class="reader-structured"><div v-for="field in structured" :key="field.key"><dt>{{field.label}}</dt><dd>{{field.text}}</dd></div></dl></section>
  <section v-if="attachments.length" class="reader-section"><h3>相关附件与链接</h3><ul class="reader-attachments"><li v-for="link in attachments" :key="link.url"><a :href="link.url" target="_blank" rel="noopener noreferrer">{{link.name}}<el-icon aria-hidden="true"><TopRight /></el-icon></a></li></ul></section>
  <section v-if="hit.related?.length" class="reader-section"><h3>继续阅读</h3><div class="reader-related"><button v-for="item in hit.related" :key="item.id" type="button" @click="$emit('select',item)">{{item.title}}<el-icon aria-hidden="true"><ArrowRight /></el-icon></button></div></section>
 </article>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import CardMessage from './CardMessage.vue'
import StudentCard from './student/StudentCard.vue'
import type {CampusGuideHit} from '@/api/types'
import {contentFormatLabel,entryLabel,readerUrl} from '@/utils/campus-reader'
import {toastError,toastOk} from '@/api/client'
const props=defineProps<{hit:CampusGuideHit}>()
defineEmits<{(event:'ask',query:string):void;(event:'select',hit:CampusGuideHit):void}>()
const url=computed(()=>readerUrl(props.hit.url)),hostname=computed(()=>url.value?new URL(url.value).hostname:'')
const body=computed(()=>props.hit.detail?.trim()||props.hit.summaryShort?.trim()||(props.hit.contentCard?'':'该条目尚未收录正文，请查看已提供的入口或附件，并向主管部门核实。'))
const trustLabel=computed(()=>({reviewed:'管理员审核',ai_reviewed:'AI 审核资料',official_index:'官方索引',handbook:'手册转录',curated:'整理资料',community:'同学经验',unverified:'待核实'} as Record<string,string>)[props.hit.provenance?.trust||'']||'收录资料')
const warnings=computed(()=>[...new Set([...(props.hit.warnings||[]),...(props.hit.access==='已合并下线'?['原服务标记为已合并下线，请先确认现行入口。']:[]),...(props.hit.detailStatus==='unavailable'?['该事项标记为未启用，办理前请向主管部门核实。']:[])])])
const facts=computed(()=>{
 const known:[string,unknown][]=[['部门',props.hit.dept],['地点',props.hit.place],['校区',props.hit.campus],['联系电话',props.hit.tel],['联系方式',props.hit.contact],['办公时间',props.hit.officeTime],['登录方式',props.hit.login],['表单',props.hit.form]]
 return [...known.filter(([,value])=>typeof value==='string'&&value.trim()).map(([label,value])=>({label,value:String(value)})),...(props.hit.keyFacts||[]).filter(item=>item.kind&&item.value).slice(0,12).map(item=>({label:item.kind,value:item.value}))].filter((item,index,items)=>items.findIndex(other=>other.label===item.label&&other.value===item.value)===index)
})
const steps=computed(()=>[...new Set(props.hit.steps||[])].filter(step=>step.trim()&&!body.value.includes(step.trim())).slice(0,24))
const labels:Record<string,string>={materials:'所需材料',facts:'关键信息',notes:'说明',name:'名称',title:'标题',description:'介绍',requirements:'要求'}
function display(value:unknown,depth=0):string{
 if(depth>5)return ''
 if(typeof value==='string')return value.slice(0,6000)
 if(Array.isArray(value))return value.slice(0,24).map(item=>display(item,depth+1)).filter(Boolean).join('\n').slice(0,6000)
 if(value&&typeof value==='object')return Object.entries(value).filter(([key])=>!['url','href','src','html','raw_html'].includes(key)).slice(0,24).map(([key,item])=>(labels[key]||key)+'：'+display(item,depth+1)).join('\n').slice(0,6000)
 return value==null?'':String(value)
}
const structured=computed(()=>{
 const parts=props.hit.detailParts
 return parts&&typeof parts==='object'&&!Array.isArray(parts)?Object.entries(parts).filter(([key])=>!['html','raw_html','attachments','steps','content','body','detail'].includes(key)).map(([key,value])=>({key,label:labels[key]||key,text:display(value)})).filter(field=>field.text&&!body.value.includes(field.text)).slice(0,16):[]
})
const attachments=computed(()=>{
 const links=new Map<string,{url:string;name:string}>();let visited=0
 function visit(value:unknown,depth=0){
  if(depth>6||!value||typeof value!=='object'||++visited>256)return
  if(Array.isArray(value)){value.slice(0,40).forEach(item=>visit(item,depth+1));return}
  const object=value as Record<string,unknown>,target=readerUrl(object.url||object.href||object.src)
  if(target&&target!==url.value)links.set(target,{url:target,name:String(object.name||object.title||'查看附件').slice(0,160)})
  Object.values(object).slice(0,40).forEach(item=>visit(item,depth+1))
 }
 visit(props.hit.detailParts);return [...links.values()].slice(0,30)
})
async function copyUrl(){try{await navigator.clipboard.writeText(url.value);toastOk('链接已复制')}catch{toastError(new Error('复制失败，请使用入口按钮打开'))}}
</script>
<style scoped>
.knowledge-reader{width:100%;max-width:900px;margin:0 auto;padding:30px 32px 44px;box-sizing:border-box;color:var(--nx-text,var(--el-text-color-primary));line-height:1.85;overflow-wrap:anywhere}.reader-labels{display:flex;gap:8px;flex-wrap:wrap}.reader-labels span{font-size:11px;padding:2px 8px;border-radius:5px;background:var(--nx-surface-2);color:var(--nx-text-2)}h2{font-size:24px;line-height:1.55;font-weight:650;margin:16px 0 10px}.reader-source,.reader-date{font-size:12px;color:var(--nx-text-2);margin:4px 0}.reader-entry-bar{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:20px 0}.reader-entry,.reader-copy{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:8px 14px;box-sizing:border-box;border-radius:8px;font:inherit;font-size:13px;text-decoration:none;cursor:pointer}.reader-entry{color:var(--nx-text-invert);background:var(--nx-accent);border:1px solid var(--nx-accent)}.reader-copy{color:var(--nx-text-2);background:var(--nx-surface);border:1px solid var(--nx-border)}.reader-entry:hover{background:var(--nx-accent-hover)}.reader-entry-bar>span{font-size:12px;color:var(--nx-text-2)}.reader-local{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--nx-text-2);margin:18px 0}.reader-warnings{padding:10px 14px;background:var(--nx-surface-2);border-left:3px solid var(--nx-accent);border-radius:0 8px 8px 0;margin:18px 0}.reader-warnings p{font-size:13px;margin:4px 0}.reader-warnings .el-icon{margin-right:6px;vertical-align:middle}.reader-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:14px 24px;margin:22px 0;padding:18px 0;border-top:1px solid var(--nx-border);border-bottom:1px solid var(--nx-border)}.reader-facts dt,.reader-structured dt{font-size:12px;color:var(--nx-text-2)}.reader-facts dd,.reader-structured dd{font-size:14px;margin:3px 0 0;white-space:pre-wrap}.reader-body{margin-top:24px;font-size:15px}.reader-body :deep(.markdown-body){font-size:15px;line-height:1.95}.reader-section{margin-top:28px}.reader-section h3{font-size:16px;font-weight:650;margin:0 0 14px}.reader-section ol{padding-left:22px;font-size:14px}.reader-section ol li{padding:4px 0;white-space:pre-wrap}.reader-structured{display:grid;gap:14px;margin:0}.reader-attachments{list-style:none;padding:0;margin:0}.reader-attachments a{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--nx-border);color:var(--nx-accent);text-decoration:none;font-size:14px}.reader-attachments .el-icon{margin-left:auto;flex-shrink:0}.reader-related{display:grid;gap:8px}.reader-related button{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left;padding:12px 14px;border:1px solid var(--nx-border);border-radius:8px;background:var(--nx-surface);color:var(--nx-text);font:inherit;font-size:13px;cursor:pointer}.knowledge-reader :is(a,button):focus-visible{outline:2px solid var(--nx-accent);outline-offset:3px}.reader-related button:hover{border-color:var(--nx-accent-border);background:var(--nx-accent-soft)}@media(max-width:600px){.knowledge-reader{padding:20px 18px 32px}h2{font-size:21px}.reader-entry,.reader-copy{min-height:44px}.reader-entry-bar>span{flex-basis:100%}.reader-body{font-size:14px}.reader-body :deep(.markdown-body){font-size:14px}}
</style>
