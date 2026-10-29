<template>
 <div class="campus-page">
  <nav v-if="isNarrow" class="mobile-switch" aria-label="导览视图">
   <button type="button" :aria-pressed="mobilePane==='list'" @click="mobilePane='list'"><el-icon><Search /></el-icon>查找资料</button>
   <button type="button" :aria-pressed="mobilePane==='reader'" :disabled="!selectedId" @click="mobilePane='reader'"><el-icon><Reading /></el-icon>阅读详情</button>
  </nav>
  <aside class="side" :class="{'mobile-hide':isNarrow&&mobilePane!=='list'}" aria-label="资料目录">
   <header class="side-head"><h1>校园知识与办事指引</h1><span>阅读资料 · 按需跳转</span></header>
   <form class="side-search" @submit.prevent="doSearch"><el-input v-model="keyword" placeholder="搜索事项或资料，如校园卡、消防安全" clearable aria-label="搜索校园资料"><template #prefix><el-icon><Search /></el-icon></template></el-input><el-button type="primary" native-type="submit" :loading="searching">查询</el-button></form>
   <div class="filters"><el-select v-model="contentType" clearable placeholder="全部内容形式" aria-label="内容形式" @change="browseLibrary"><el-option v-for="(label,value) in FORMATS" :key="value" :label="label" :value="value" /></el-select><el-select v-model="collection" clearable placeholder="全部知识库" aria-label="知识库" @change="browseLibrary"><el-option v-for="item in collections" :key="item.value" :label="item.label" :value="item.value" /></el-select></div>
   <div class="quick-tags" aria-label="快捷查询"><button v-for="text in QUICK" :key="text" type="button" @click="quickSearch(text)">{{text}}</button></div>
   <div class="catalog-bar"><span role="status">{{searching?'正在查找资料…':`共 ${browsing?libraryTotal:hits.length} 条资料`}}</span><button type="button" @click="showDirectory">浏览目录</button></div>
   <div class="side-scroll" :aria-busy="searching">
    <section v-if="guidance" class="guided-search"><strong>{{guidance.stage==='clarify'?'先确认事项':'查询提示'}}</strong><p>{{guidance.prompt}}</p><button v-for="choice in guidance.choices" :key="choice.query" type="button" @click="quickSearch(choice.query)">{{choice.label}}</button><p v-if="guidance.missingFields.length">未收录：{{guidance.missingFields.join('、')}}</p><p v-for="conflict in guidance.conflicts" :key="conflict">{{conflict}}</p></section>
    <div v-if="listError" class="empty-state" role="alert"><p>{{listError}}</p><el-button @click="retryList">重新查询</el-button></div>
    <div v-else-if="searching&&!hits.length" class="list-loading" role="status"><el-icon class="is-loading"><Loading /></el-icon>正在加载资料目录</div>
    <ul v-else class="hit-list"><li v-for="hit in hits" :key="hit.id"><button type="button" class="hit" :class="{active:hit.id===selectedId}" :aria-current="hit.id===selectedId?'true':undefined" @click="selectHit(hit)"><span class="hit-title">{{hit.title}}</span><span class="hit-meta"><span>{{contentFormatLabel(hit.contentFormat)}}</span><span>{{readerUrl(hit.url)?'含跳转入口':'站内阅读'}}</span></span><span v-if="hit.summaryShort" class="hit-summary">{{contentPreview(hit.summaryShort)}}</span><span class="hit-footer"><span>{{hit.provenance?.file||hit.dept||hit.source}}</span><el-icon aria-hidden="true"><ArrowRight /></el-icon></span></button></li></ul>
    <el-empty v-if="searched&&!searching&&!listError&&!hits.length" description="暂无匹配资料，试试更短的关键词或其他知识库" :image-size="60" />
    <details v-if="categories?.cats.length" class="categories"><summary>按分类查找</summary><button v-for="cat in categories.cats.slice(0,10)" :key="cat.value" type="button" @click="browseCategory(cat.value)">{{cat.value}}<span>{{cat.count}}</span></button></details>
   </div>
   <el-pagination v-if="browsing&&libraryTotal>20" :current-page="libraryPage" :total="libraryTotal" :page-size="20" small layout="prev,pager,next" @current-change="loadLibrary" />
  </aside>
  <section ref="readerPanel" class="reader-panel" :class="{'mobile-hide':isNarrow&&mobilePane!=='reader'}" aria-label="阅读详情" tabindex="-1">
   <header class="reader-bar"><button v-if="isNarrow" type="button" @click="mobilePane='list'"><el-icon><Back /></el-icon>返回列表</button><span><el-icon><Reading /></el-icon>资料阅读</span><span class="reader-tip">外部入口将在新标签打开</span></header>
   <div class="reader-scroll" :aria-busy="reading">
    <div v-if="reading" class="reader-loading" role="status"><el-icon class="is-loading"><Loading /></el-icon><p>正在读取资料…</p><div class="reading-lines" aria-hidden="true"><i /><i /><i /></div></div>
    <div v-else-if="detailError" class="empty-state" role="alert"><h2>资料暂时无法读取</h2><p>{{detailError}}</p><el-button @click="retryDetail">重新读取</el-button></div>
    <KnowledgeContent v-else-if="activeHit" :key="activeHit.id" :hit="activeHit" @ask="quickSearch" @select="selectHit" />
    <div v-else class="reader-empty"><el-icon><Reading /></el-icon><h2>选择一条资料开始阅读</h2><p>正文、来源和附件在这里查看。需要办理时，使用资料中的入口按钮前往对应服务。</p><span v-if="meta">已收录 {{meta.total}} 条索引</span></div>
   </div>
  </section>
 </div>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref} from 'vue'
import {useRoute} from 'vue-router'
import {campusApi} from '@/api'
import type {CampusCategories,CampusGuideHit,CampusMeta,CampusSearchResult} from '@/api/types'
import KnowledgeContent from '@/components/KnowledgeContent.vue'
import {contentFormatLabel,contentPreview,readerUrl} from '@/utils/campus-reader'
import {trackCampus} from '@/utils/campus-activity'
const QUICK=['校园卡补办','四六级报名','报销流程','VPN 怎么连','宿舍报修','成绩查询']
const FORMATS={article:'文章 / 知识块',link:'服务入口',document:'文档 / 附件',map:'校园地图',fixed:'固定问答 / 纠错',rule:'关键词约定',cards:'排版卡片'}
const route=useRoute(),keyword=ref(''),collection=ref(typeof route.query.collection==='string'?route.query.collection:''),contentType=ref('')
const collections=ref<{value:string;label:string;count?:number}[]>([]),meta=ref<CampusMeta|null>(null),categories=ref<CampusCategories|null>(null)
const selectedCategory=ref('')
const hits=ref<CampusGuideHit[]>([]),guidance=ref<CampusSearchResult['guidance']>(),searching=ref(false),searched=ref(false),browsing=ref(true),libraryPage=ref(1),libraryTotal=ref(0),listError=ref('')
const activeHit=ref<CampusGuideHit|null>(null),selected=ref<CampusGuideHit|null>(null),selectedId=computed(()=>selected.value?.id||''),reading=ref(false),detailError=ref(''),readerPanel=ref<HTMLElement>()
const narrowQuery=window.matchMedia('(max-width: 1100px)'),isNarrow=ref(narrowQuery.matches),mobilePane=ref<'list'|'reader'>('list')
let listRequest=0,detailRequest=0,disposed=false
function clearSelection(){detailRequest++;selected.value=null;activeHit.value=null;detailError.value='';reading.value=false;mobilePane.value='list'}
function errorText(error:unknown,fallback:string){return error instanceof Error?error.message:fallback}
async function loadLibrary(page=1){
 const request=++listRequest;clearSelection();selectedCategory.value='';browsing.value=true;libraryPage.value=page;searching.value=true;listError.value='';hits.value=[];guidance.value=undefined
 try{const data=await campusApi.library({collection:collection.value||undefined,format:contentType.value||undefined,keyword:keyword.value.trim()||undefined,page,pageSize:20});if(disposed||request!==listRequest)return;hits.value=data.items;libraryTotal.value=data.total;searched.value=true}
 catch(error){if(!disposed&&request===listRequest)listError.value=errorText(error,'资料目录加载失败')}
 finally{if(!disposed&&request===listRequest)searching.value=false}
}
function browseLibrary(){void loadLibrary(1)}
function showDirectory(){keyword.value='';browseLibrary()}
async function doSearch(){
 if(!keyword.value.trim()||contentType.value){browseLibrary();return}
 const request=++listRequest;clearSelection();selectedCategory.value='';searching.value=true;browsing.value=false;listError.value='';hits.value=[];guidance.value=undefined
 try{const result=await campusApi.search({q:keyword.value.trim(),mode:'guide',limit:20,collection:collection.value||undefined});if(disposed||request!==listRequest)return;hits.value=result.hits;guidance.value=result.guidance;searched.value=true}
 catch(error){if(!disposed&&request===listRequest)listError.value=errorText(error,'资料查询失败')}
 finally{if(!disposed&&request===listRequest)searching.value=false}
}
function quickSearch(text:string){keyword.value=text;void doSearch()}
function retryList(){if(selectedCategory.value){void browseCategory(selectedCategory.value);return}if(browsing.value)void loadLibrary(libraryPage.value);else void doSearch()}
async function browseCategory(cat:string){
 selectedCategory.value=cat
 const request=++listRequest;clearSelection();searching.value=true;browsing.value=false;listError.value='';guidance.value=undefined;hits.value=[];collection.value='';contentType.value='';keyword.value=''
 try{const result=await campusApi.items({cat,pageSize:20});if(disposed||request!==listRequest)return;hits.value=result.items;searched.value=true}
 catch(error){if(!disposed&&request===listRequest)listError.value=errorText(error,'分类加载失败')}
 finally{if(!disposed&&request===listRequest)searching.value=false}
}
async function selectHit(hit:CampusGuideHit){
 const request=++detailRequest;selected.value=hit;activeHit.value=null;reading.value=true;detailError.value='';mobilePane.value='reader'
 try{const content=await campusApi.item(hit.id);if(disposed||request!==detailRequest)return;activeHit.value=content;trackCampus('CONTENT_VIEW',{entryId:content.id,collection:content.provenance?.collection,title:content.title})}
 catch(error){if(!disposed&&request===detailRequest)detailError.value=errorText(error,'请稍后重新读取')}
 finally{if(!disposed&&request===detailRequest){reading.value=false;await nextTick(()=>{const scroll=readerPanel.value?.querySelector('.reader-scroll');if(scroll)scroll.scrollTop=0;if(isNarrow.value&&mobilePane.value==='reader')readerPanel.value?.focus({preventScroll:true})})}}
}
function retryDetail(){if(selected.value)void selectHit(selected.value)}
function onNarrowChange(event:MediaQueryListEvent){isNarrow.value=event.matches}
onMounted(()=>{narrowQuery.addEventListener('change',onNarrowChange);browseLibrary();void Promise.allSettled([campusApi.meta(),campusApi.categories(),campusApi.collections()]).then(([m,c,list])=>{if(disposed)return;if(m.status==='fulfilled')meta.value=m.value;if(c.status==='fulfilled')categories.value=c.value;if(list.status==='fulfilled')collections.value=list.value})})
onBeforeUnmount(()=>{disposed=true;listRequest++;detailRequest++;narrowQuery.removeEventListener('change',onNarrowChange)})
</script>
<style scoped>
.campus-page{display:grid;grid-template-columns:minmax(300px,350px) minmax(0,1fr);gap:16px;height:100%;min-height:0;padding:16px;box-sizing:border-box;color:var(--nx-text);background:var(--nx-bg)}.side,.reader-panel{display:flex;flex-direction:column;min-height:0;min-width:0;border:1px solid var(--nx-border);border-radius:14px;background:var(--nx-surface);overflow:hidden}.side-head{padding:18px 16px 10px}.side-head h1{font-size:16px;margin:0 0 5px;font-weight:650}.side-head>span{font-size:12px;color:var(--nx-text-2)}.side-search{display:flex;gap:8px;padding:6px 16px 10px}.side-search .el-input{min-width:0}.filters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;padding:0 16px 10px}.filters .el-select{min-width:0;width:100%}.quick-tags{display:flex;gap:6px;padding:0 16px 12px;overflow-x:auto;flex-shrink:0}.quick-tags button{white-space:nowrap;padding:5px 9px;border:1px solid var(--nx-border);border-radius:7px;color:var(--nx-text-2);background:var(--nx-surface-2);font-size:12px;cursor:pointer}.catalog-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid var(--nx-border);border-bottom:1px solid var(--nx-border);font-size:12px;color:var(--nx-text-2)}.catalog-bar button,.reader-bar button{border:0;background:none;color:var(--nx-accent);font:inherit;cursor:pointer}.side-scroll{flex:1;min-height:0;overflow:auto;padding:8px}.hit-list{list-style:none;margin:0;padding:0}.hit{display:flex;flex-direction:column;gap:8px;text-align:left;width:100%;padding:14px 12px;margin:0 0 6px;border:1px solid transparent;border-radius:10px;background:none;color:var(--nx-text);font:inherit;cursor:pointer}.hit:hover{background:var(--nx-surface-2)}.hit.active{border-color:var(--nx-accent-border);background:var(--nx-accent-soft)}.hit-title{font-size:14px;line-height:1.6;font-weight:600;overflow-wrap:anywhere}.hit-meta{display:flex;flex-wrap:wrap;gap:6px;font-size:11px;color:var(--nx-text-2)}.hit-meta>span{padding:1px 6px;border-radius:5px;background:var(--nx-surface-2)}.hit-summary{font-size:12px;color:var(--nx-text-2);line-height:1.75;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.hit-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:var(--nx-text-2)}.hit-footer>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hit-footer .el-icon{flex-shrink:0;color:var(--nx-accent)}.side>.el-pagination{justify-content:center;padding:10px 4px;border-top:1px solid var(--nx-border)}
.reader-bar{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 18px;flex-shrink:0;border-bottom:1px solid var(--nx-border);font-size:12px;color:var(--nx-text-2)}.reader-bar>span:first-of-type,.reader-bar button{display:inline-flex;align-items:center;gap:7px}.reader-tip{margin-left:auto;font-size:11px}.reader-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}.reader-empty,.reader-loading,.empty-state{padding:44px 24px;text-align:center;color:var(--nx-text-2);line-height:1.8}.reader-empty{max-width:460px;margin:12vh auto}.reader-empty>.el-icon{font-size:38px;color:var(--nx-accent)}.reader-empty h2,.empty-state h2{color:var(--nx-text);font-size:18px}.reader-empty p{font-size:14px}.reader-empty>span{font-size:12px}.reader-loading>.el-icon{font-size:24px;color:var(--nx-accent)}.reading-lines{display:grid;gap:14px;max-width:520px;margin:24px auto}.reading-lines i{height:12px;border-radius:5px;background:var(--nx-surface-2)}.reading-lines i:nth-child(2){width:84%}.reading-lines i:last-child{width:65%}.list-loading{padding:28px 12px;display:flex;justify-content:center;align-items:center;gap:8px;font-size:13px;color:var(--nx-text-2)}.guided-search{padding:12px;margin:4px 4px 12px;background:var(--nx-surface-2);border-radius:10px;color:var(--nx-text-2);font-size:12px;line-height:1.7}.guided-search p{margin:6px 0}.guided-search button{border:1px solid var(--nx-accent-border);padding:6px 8px;margin:4px 6px 0 0;border-radius:6px;color:var(--nx-accent);background:var(--nx-surface);cursor:pointer}.categories{font-size:12px;padding:10px;color:var(--nx-text-2);border-top:1px solid var(--nx-border)}.categories summary{cursor:pointer;padding:6px 0}.categories button{display:flex;justify-content:space-between;gap:8px;width:100%;border:0;background:none;color:inherit;text-align:left;padding:9px 0;cursor:pointer}.mobile-switch{display:flex;gap:4px;padding:4px;border:1px solid var(--nx-border);border-radius:10px;background:var(--nx-surface)}.mobile-switch button{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;min-height:40px;border:0;border-radius:7px;color:var(--nx-text-2);background:none;font:inherit;cursor:pointer}.mobile-switch button[aria-pressed=true]{color:var(--nx-accent);background:var(--nx-accent-soft);font-weight:600}.mobile-switch button:disabled{opacity:.5;cursor:default}.campus-page :is(button,summary):focus-visible{outline:2px solid var(--nx-accent);outline-offset:2px}.reader-panel:focus{outline:none}
@media(max-width:1100px){.campus-page{display:flex;flex-direction:column;padding:12px;gap:12px}.side,.reader-panel{flex:1}.mobile-hide{display:none}.reader-bar{padding:0 12px}.reader-tip{display:none}.reader-empty{margin:5vh auto}}@media(max-width:480px){.campus-page{padding:10px;gap:10px}.side-head{padding:14px 14px 8px}.side-search{padding:4px 14px 8px}.filters{padding:0 14px 8px}.quick-tags{padding:0 14px 10px}.hit{padding:12px 10px}.mobile-switch button{font-size:13px}}@media(prefers-reduced-motion:reduce){.campus-page *{animation:none!important;transition:none!important}}
</style>
