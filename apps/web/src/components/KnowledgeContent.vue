<template>
 <article class="knowledge-reader" :data-campus-entry="hit.id" :data-campus-collection="hit.provenance?.collection">
  <div class="reader-labels"><span>{{formatLabel(hit.contentFormat)}}</span><span v-if="hit.entryMode">{{modeLabel(hit.entryMode)}}</span><span v-if="hit.provenance">{{hit.provenance.trust==='reviewed'?'管理员审核':hit.provenance.trust==='ai_reviewed'?'AI 审核资料':'收录资料'}}</span></div>
  <h2>{{hit.title}}</h2><p class="reader-source" v-if="hit.provenance">{{hit.provenance.file}} · {{hit.provenance.locator}}</p>
  <CardMessage :content="hit.detail || hit.summaryShort || '该条目暂未收录正文，可通过入口查看原资料。'"/>
  <StudentCard v-if="hit.contentCard" :card="hit.contentCard"/>
  <section v-if="structured.length" class="reader-structured"><h3>结构化资料</h3><dl><template v-for="field in structured" :key="field.key"><dt>{{field.label}}</dt><dd>{{field.text}}</dd></template></dl></section>
  <ul v-if="attachments.length" class="reader-attachments"><li v-for="link in attachments" :key="link.url"><a :href="link.url" target="_blank" rel="noopener noreferrer">{{link.name}} ↗</a></li></ul>
  <a v-if="safeUrl(hit.url)" class="reader-entry" :href="safeUrl(hit.url)" target="_blank" rel="noopener noreferrer">查看原页面 ↗</a>
  <p v-for="warning in hit.warnings" :key="warning" class="reader-warning">{{warning}}</p>
 </article>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import CardMessage from './CardMessage.vue'
import StudentCard from './student/StudentCard.vue'
import type {CampusGuideHit} from '@/api/types'
const props=defineProps<{hit:CampusGuideHit}>()
const safeUrl=(v:unknown)=>typeof v==='string'&&/^https?:\/\//i.test(v)?v:''
const formatLabel=(v?:string)=>({map:'地图',rule:'关键词约定',fixed:'固定问答',cards:'排版卡片',document:'文档 / 附件',link:'入口与正文',article:'文章 / 知识块'} as Record<string,string>)[v||'']||'知识资料'
const modeLabel=(v:string)=>({RAG:'检索知识',FIXED:'固定问答',CORRECTION:'管理员纠错',TRIGGER:'关键词约定'} as Record<string,string>)[v]||v
const labels:Record<string,string>={materials:'所需材料',steps:'办理步骤',facts:'关键信息',attachments:'附件',content:'内容',notes:'说明',name:'名称',title:'标题',description:'介绍',requirements:'要求'}
function display(v:unknown):string{if(typeof v==='string')return v;if(Array.isArray(v))return v.map(display).join('\n');if(v&&typeof v==='object')return Object.entries(v).filter(([k])=>!['url','href','src'].includes(k)).map(([k,value])=>(labels[k]||k)+'：'+display(value)).join('\n');return v==null?'':String(v)}
const structured=computed(()=>{const p=props.hit.detailParts;return p&&typeof p==='object'&&!Array.isArray(p)?Object.entries(p).filter(([k,v])=>v!=null&&display(v)&&!['html','raw_html'].includes(k)).slice(0,16).map(([key,value])=>({key,label:labels[key]||key,text:display(value)})):[]})
const attachments=computed(()=>{
 const links=new Map<string,{url:string;name:string}>()
 function visit(v:unknown,depth=0){if(depth>6||!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(item=>visit(item,depth+1));return}const obj=v as Record<string,unknown>,url=safeUrl(obj.url||obj.href||obj.src);if(url)links.set(url,{url,name:String(obj.name||obj.title||'查看附件')});Object.values(obj).forEach(item=>visit(item,depth+1))}
 visit(props.hit.detailParts);return [...links.values()].slice(0,30)
})
</script>
<style scoped>
.knowledge-reader{width:100%;max-width:920px;padding:24px;box-sizing:border-box;color:var(--el-text-color-primary);line-height:1.8;overflow-wrap:anywhere}.reader-labels{display:flex;gap:8px;flex-wrap:wrap}.reader-labels span{font-size:11px;padding:3px 9px;border:1px solid var(--el-border-color);border-radius:20px;background:var(--el-fill-color-light)}h2{font-size:22px;line-height:1.5;margin:16px 0 8px}.reader-source,.reader-warning{font-size:12px;color:var(--el-text-color-secondary)}.reader-source{margin-bottom:20px}.reader-entry{display:inline-block;margin:20px 0 8px;padding:9px 15px;color:var(--el-color-primary);border:1px solid var(--el-color-primary);border-radius:9px;text-decoration:none}.reader-structured{margin-top:24px}.reader-structured h3{font-size:15px}dl{display:grid;grid-template-columns:minmax(100px,180px) 1fr;margin:0}dt,dd{padding:10px;border-bottom:1px solid var(--el-border-color);margin:0;font-size:13px;white-space:pre-wrap}dt{color:var(--el-text-color-secondary)}.reader-attachments a{color:var(--el-color-primary)}@media(max-width:600px){.knowledge-reader{padding:16px}dl{grid-template-columns:1fr}dt{padding-bottom:0;border:0}}
</style>
