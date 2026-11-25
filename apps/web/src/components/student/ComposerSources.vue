<template>
  <div class="composer-options">
    <OutputPreferenceSegment/>
    <el-dropdown v-if="searchAvailable" trigger="click" @command="emit('search',$event)">
      <button type="button" class="nx-btn nx-btn-ghost sources-button" :class="{'option-active':searchMode==='on'}" :disabled="disabled||!searchAvailable" :title="searchAvailable?'通过后台配置的搜索服务检索公开网页':'管理员启用搜索接口后可用'"><el-icon><Search/></el-icon>智能搜索 <small>{{ searchLabels[searchMode] }}</small><el-icon><ArrowDown/></el-icon></button>
      <template #dropdown><el-dropdown-menu><el-dropdown-item v-for="(label, mode) in searchLabels" :key="mode" :command="mode" :class="{'is-selected':mode===searchMode}">{{label}}</el-dropdown-item></el-dropdown-menu></template>
    </el-dropdown>
    <el-popover v-if="thinkingEnabled" trigger="click" placement="top-start" :width="290" :disabled="disabled||!thinkingAvailable" popper-class="cagent-thinking-popover">
      <template #reference><button type="button" class="nx-btn nx-btn-ghost sources-button" :class="{'option-active':thinkingAvailable && (thinkingEffort||thinkingDefault)!=='none'}" :disabled="disabled||!thinkingAvailable" :title="thinkingAvailable?'设置模型思考强度':'切换到支持思考强度的 DeepSeek 模型后可用'"><el-icon><Guide/></el-icon>深度思考 <small>{{thinkingAvailable?thinkingLabels[thinkingEffort||thinkingDefault]:'不可用'}}</small><el-icon><ArrowDown/></el-icon></button></template>
      <div class="thinking-control">
        <div class="thinking-heading"><strong>思考深度</strong><el-button text size="small" :disabled="!thinkingEffort" @click="emit('thinking','default')">恢复默认</el-button></div>
        <input class="thinking-range" type="range" min="0" max="3" step="1" :value="effortIndex" :style="{'--effort-progress':effortIndex*100/3+'%'}" aria-label="思考深度" :aria-valuetext="thinkingLabels[efforts[effortIndex]]" @input="setEffort"/>
        <div class="thinking-marks"><button v-for="effort in efforts" :key="effort" type="button" :aria-pressed="effort===efforts[effortIndex]" @click="emit('thinking',effort)">{{thinkingLabels[effort]}}</button></div>
        <p>{{effortDetails[efforts[effortIndex]]}}</p>
      </div>
    </el-popover>
    <el-popover v-for="group in groups" :key="group.key" placement="top-start" trigger="click" :width="290" popper-class="cagent-composer-source-popover">
      <template #reference><button type="button" class="nx-btn nx-btn-ghost sources-button" :disabled="disabled"><el-icon><component :is="group.icon"/></el-icon>{{group.title}}<small>{{group.count}}</small><el-icon><ArrowDown/></el-icon></button></template>
      <div class="source-sheet">
        <div class="source-sheet-head"><strong>{{group.title}}</strong><el-button text size="small" @click="change(group.key,group.items.map(item=>item.id))">全选</el-button><el-button text size="small" @click="change(group.key,[])">清空</el-button></div>
        <el-checkbox-group :model-value="group.selected" @update:model-value="change(group.key,$event.map(String))">
          <div v-for="item in group.items" :key="item.id" class="source-option"><el-checkbox :value="item.id" :title="item.note || item.label">{{item.label}}</el-checkbox><el-button v-if="group.key==='bases'" size="small" text :aria-label="`只选 ${item.label}`" @click="change(group.key,[item.id])">仅用</el-button></div>
        </el-checkbox-group>
        <p v-if="!group.items.length">暂无可用{{group.title}}</p>
      </div>
    </el-popover>
  </div>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import {ArrowDown, Collection, Guide, MagicStick, Search} from '@element-plus/icons-vue'
import OutputPreferenceSegment from '@/components/OutputPreferenceSegment.vue'
import type {SendMessagePayload} from '@/api/chat-stream'
type Option={id:string;label:string;note?:string}
type SearchMode=NonNullable<SendMessagePayload['webSearch']>
type ThinkingEffort=NonNullable<SendMessagePayload['thinkingEffort']>
const props=defineProps<{bases:Option[];skills:Option[];baseSelection:string[]|null;skillSelection:string[];disabled?:boolean;searchAvailable:boolean;searchMode:SearchMode;thinkingEnabled:boolean;thinkingAvailable:boolean;thinkingEffort?:ThinkingEffort;thinkingDefault:ThinkingEffort|'default'}>()
const emit=defineEmits<{'bases':[value:string[]|null];'skills':[value:string[]];'search':[value:SearchMode];'thinking':[value:ThinkingEffort|'default']}>()
const searchLabels={auto:'开启',on:'本轮必搜',off:'关闭'} as const
const thinkingLabels={default:'后台默认',none:'关闭',low:'标准',high:'增强',max:'最高'} as const
const efforts=['none','low','high','max'] as const
const effortDetails={none:'适合直接查询和简短问题。',low:'用较短时间分析一般问题。',high:'适合多步骤问题和方案比较。',max:'留出更多推理时间，回答可能更慢。'}
const effortIndex=computed(()=>{const selected=props.thinkingEffort||props.thinkingDefault;return selected==='default'?2:efforts.indexOf(selected)})
function setEffort(event:Event){const level=efforts[Number((event.target as HTMLInputElement).value)];if(level)emit('thinking',level)}
const groups=computed(()=>[
 {key:'bases' as const,title:'知识库',icon:Collection,items:props.bases,selected:props.baseSelection??props.bases.map(x=>x.id),count:props.baseSelection?.length??props.bases.length},
 {key:'skills' as const,title:'技能',icon:MagicStick,items:props.skills,selected:props.skillSelection,count:props.skillSelection.length},
])
function change(key:'bases'|'skills',values:string[]){if(key==='bases')emit('bases',values.length===props.bases.length?null:values);else emit('skills',values)}
</script>
<style scoped>
.composer-options{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:3px 0 10px}.sources-button{gap:4px;font-size:12px}.sources-button small{color:var(--nx-text-2);font-variant-numeric:tabular-nums}.source-sheet-head,.source-option{display:flex;align-items:center;justify-content:space-between;gap:5px}.source-sheet-head strong{flex:1}.source-sheet :deep(.el-checkbox-group){max-height:285px;overflow:auto}.source-option :deep(.el-checkbox){max-width:80%;height:auto;min-height:31px}.source-option :deep(.el-checkbox__label){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-sheet p{font-size:12px;color:var(--el-text-color-secondary)}@media(max-width:500px){.sources-button{padding-inline:5px}}
</style>
<style scoped>
.sources-button.option-active{background:var(--nx-accent-soft);color:var(--nx-accent);border-color:var(--nx-accent)}
.sources-button:disabled{opacity:.55;cursor:not-allowed}
.sources-button:not(:disabled){border:1px solid var(--nx-border);border-radius:18px;padding-inline:9px}
.sources-button.option-active{border-color:var(--nx-accent-border)}
.thinking-control{padding:2px 4px 4px;color:var(--el-text-color-primary)}.thinking-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}
.thinking-range{box-sizing:border-box;width:100%;margin:10px 0 3px;appearance:none;min-height:26px;border-radius:5px;cursor:pointer;background:linear-gradient(to right,var(--el-color-primary) 0 var(--effort-progress),var(--el-border-color) var(--effort-progress) 100%) center/100% 4px no-repeat}
.thinking-range:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:1px}.thinking-range::-webkit-slider-thumb{appearance:none;width:17px;height:17px;border:2px solid var(--el-color-primary);border-radius:50%;background:var(--el-bg-color-overlay)}.thinking-range::-moz-range-thumb{width:14px;height:14px;border:2px solid var(--el-color-primary);border-radius:50%;background:var(--el-bg-color-overlay)}
.thinking-marks{display:flex;justify-content:space-between}.thinking-marks button{border:0;background:transparent;color:var(--el-text-color-secondary);cursor:pointer;font:inherit;font-size:12px;padding:4px 1px}.thinking-marks button[aria-pressed=true]{color:var(--el-color-primary);font-weight:650}.thinking-control p{margin:10px 0 0;font-size:12px;color:var(--el-text-color-secondary);line-height:1.5;min-height:18px}
.composer-options{gap:4px;padding:1px 0 3px}.composer-options .sources-button{min-height:26px;height:26px;padding-block:0}.composer-options .sources-button small{font-size:10px}
@media(max-width:650px){.composer-options>.output-segment{max-width:255px}.composer-options .sources-button{gap:2px;padding-inline:6px}.composer-options .sources-button>.el-icon:last-child{display:none}}
</style>
