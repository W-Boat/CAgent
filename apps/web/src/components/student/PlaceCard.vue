<template>
  <section class="place-card">
    <h3 v-if="card.title">{{text(card.title)}}</h3>
    <MarkdownView v-if="card.intro" :content="text(card.intro)"/>
    <div class="place-grid">
      <article v-for="(place,i) in places" :key="i" class="place-item" :data-service-mode="mode(place)">
        <header>
          <span class="place-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="mode(place)==='online' || mode(place)==='hybrid'"><rect x="3" y="4" width="18" height="14" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01M9 13l2 2 4-4"/></template>
              <template v-else-if="mode(place)==='offline'"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.4"/></template>
              <template v-else><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></template>
            </svg>
          </span>
          <div class="place-heading"><h4>{{text(place.name)}}</h4><span class="place-channel">{{mode(place)==='offline'&&!isWindow(place)?'线下地点':serviceModeLabels[mode(place)]}}</span></div>
        </header>
        <div v-if="place.campus" class="place-campus"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="m2 6 6-3 6 3v1H2ZM4 8v5m4-5v5m4-5v5M2 14h12"/></svg>{{text(place.campus)}}</div>
        <MarkdownView v-if="place.body" :content="text(place.body)"/>
        <dl v-if="hasAddress(place) || place.hours" class="place-details">
          <div v-if="hasAddress(place)"><dt>{{mode(place)==='online'?'办理说明':mode(place)==='unknown'?'位置说明':mode(place)==='hybrid'?'办理方式与地址':'办理地址'}}</dt><dd>{{text(place.location)}}</dd></div>
          <div v-if="place.hours"><dt>{{mode(place)==='online'?'服务时间':'开放时间'}}</dt><dd>{{text(place.hours)}}</dd></div>
        </dl>
        <div class="place-tags" v-if="tags(place).length"><span v-for="(tag,j) in tags(place)" :key="j">{{tag}}</span></div>
        <footer class="place-footer">
          <a v-if="safeServiceUrl(place.url)" :href="safeServiceUrl(place.url)" target="_blank" rel="noopener noreferrer" class="place-action" :aria-label="`${actionLabel(place)}：${text(place.name)}`"><span>{{actionLabel(place)}}</span><svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4h5v5m0-5-8 8M7 4H4v12h12v-3"/></svg></a>
          <button v-else-if="place.action" type="button" class="place-action" :disabled="disabled" @click="$emit('ask',text(place.action))"><span>继续了解</span><span aria-hidden="true">→</span></button>
          <span v-else class="place-footnote">{{mode(place)==='offline'?'线下安排请以现场信息为准':mode(place)==='online'?'办理链接请以正式通知为准':'办理安排以正式通知为准'}}</span>
        </footer>
      </article>
    </div>
  </section>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import MarkdownView from '../MarkdownView.vue'
import {serviceMode,safeServiceUrl,serviceModeLabels} from '@/utils/place-service'
const props=defineProps<{card:Record<string,unknown>;disabled?:boolean}>()
defineEmits<{(e:'ask',text:string):void}>()
const text=(v:unknown)=>typeof v==='string'?v:''
const places=computed(()=>Array.isArray(props.card.items)?props.card.items.filter(p=>p&&typeof p==='object'&&!Array.isArray(p)) as Record<string,unknown>[]:[])
const mode=serviceMode
const isWindow=(p:Record<string,unknown>)=>/窗口|办事|办理点/.test(text(p.name)+' '+text(p.body))
const tags=(p:Record<string,unknown>)=>Array.isArray(p.tags)?p.tags.map(text).filter(Boolean):[]
const hasAddress=(p:Record<string,unknown>)=>!!text(p.location)&&!/^(?:线上|在线|网上)(?:办理)?$/.test(text(p.location).trim())
function actionLabel(p:Record<string,unknown>){const label=text(p.linkLabel);return label&&!/^(?:查看详情|打开链接|详情|前往|点击这里)$/.test(label)?label:(mode(p)==='online'?'前往线上办理':mode(p)==='offline'?(isWindow(p)?'查看窗口详情':'查看地点详情'):'查看服务详情')}
</script>
<style scoped>
.place-card{color:var(--nx-text,var(--el-text-color-primary));min-width:0}.place-card>h3{margin:0 0 16px;font-size:17px;line-height:1.6;font-weight:650}.place-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.place-item{min-width:0;border:1px solid var(--nx-border,var(--el-border-color));background:var(--nx-surface,var(--el-bg-color));border-radius:18px;padding:20px;display:flex;flex-direction:column;gap:14px;overflow-wrap:anywhere}.place-item header{display:flex;align-items:flex-start;gap:12px}.place-icon{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;flex-shrink:0;color:var(--nx-accent,var(--el-color-primary));background:color-mix(in srgb,var(--nx-accent,var(--el-color-primary)) 10%,transparent)}.place-icon>svg{width:25px;height:25px}.place-item[data-service-mode="offline"] .place-icon{background:var(--nx-surface-2,var(--el-fill-color-light));color:var(--nx-text,var(--el-text-color-primary));border:1px solid var(--nx-border,var(--el-border-color));box-sizing:border-box}.place-heading{flex:1;min-width:0}.place-heading h4{font-size:16px;line-height:1.5;font-weight:650;margin:0 0 7px}.place-channel{display:inline-flex;font-size:11px;font-weight:500;line-height:1.6;padding:2px 8px;border-radius:5px;background:var(--nx-surface-2,var(--el-fill-color-light));color:var(--nx-text-2,var(--el-text-color-secondary))}.place-item[data-service-mode="online"] .place-channel{background:color-mix(in srgb,var(--nx-accent,var(--el-color-primary)) 9%,transparent);color:var(--nx-accent,var(--el-color-primary))}.place-campus{display:flex;gap:6px;align-items:flex-start;color:var(--nx-text-2,var(--el-text-color-secondary));font-size:12px;line-height:1.6}.place-campus svg{width:15px;height:15px;flex-shrink:0;margin-top:2px}.place-card :deep(.markdown-body){font-size:13px;line-height:1.85}.place-card :deep(.markdown-body p){margin:0}.place-details{margin:0;padding:12px 14px;border-radius:10px;background:var(--nx-surface-2,var(--el-fill-color-light));display:grid;gap:10px}.place-details>div{display:grid;gap:3px;font-size:13px;line-height:1.7}.place-details dt{font-size:11px;color:var(--nx-text-2,var(--el-text-color-secondary))}.place-details dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.place-tags{display:flex;flex-wrap:wrap;gap:6px}.place-tags span{font-size:11px;border:1px solid var(--nx-border,var(--el-border-color));color:var(--nx-text-2,var(--el-text-color-secondary));border-radius:5px;padding:3px 7px;line-height:1.6}.place-footer{margin-top:auto;padding-top:12px;border-top:1px solid var(--nx-border,var(--el-border-color))}.place-action{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;box-sizing:border-box;padding:5px 0;border:0;background:transparent;color:var(--nx-accent,var(--el-color-primary));text-decoration:none;font:inherit;font-size:13px;font-weight:500;cursor:pointer}.place-action svg{width:17px;height:17px;flex-shrink:0}.place-action:disabled{opacity:.55;cursor:default}.place-action:focus-visible{outline:2px solid var(--nx-accent,var(--el-color-primary));outline-offset:3px;border-radius:4px}.place-footnote{font-size:11px;line-height:1.7;color:var(--nx-text-2,var(--el-text-color-secondary))}@media(max-width:600px){.place-grid{grid-template-columns:minmax(0,1fr)}.place-item{padding:18px;border-radius:15px}}
</style>
