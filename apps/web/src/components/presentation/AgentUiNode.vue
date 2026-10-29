<template>
  <div class="aui-node" :data-ui-type="node.type" :data-ui-node="node.id">
    <h3 v-if="node.type==='text'&&node.role==='heading'" class="aui-heading">{{ node.content }}</h3>
    <p v-else-if="node.type==='text'" class="aui-copy" :class="{'aui-caption':node.role==='caption'}">{{ node.content }}</p>
    <figure v-else-if="node.type==='image'" class="aui-image"><img :src="node.url" :alt="node.alt" loading="lazy" referrerpolicy="no-referrer" @error="imageFailed=true" v-if="!imageFailed"/><p v-else>{{ node.alt }} · 图片暂时无法加载</p><figcaption v-if="node.caption">{{ node.caption }}</figcaption></figure>
    <article v-else-if="node.type==='info_card'" class="aui-info">
      <span v-if="node.badge" class="aui-badge">{{ node.badge }}</span><h4>{{ node.title }}</h4><p v-if="node.summary" class="aui-summary">{{ node.summary }}</p>
      <dl v-if="node.metrics" class="aui-metrics"><div v-for="(metric,i) in node.metrics" :key="i"><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div></dl>
      <div v-if="node.children" class="aui-layout aui-stack aui-inner"><AgentUiNode v-for="child in node.children" :key="child.id" :node="child" :disabled="disabled" :scope="scope" :state-key="stateKey" @ask="$emit('ask',$event)"/></div>
    </article>
    <AgentUiService v-else-if="node.type==='service_card'" :node="node" :disabled="disabled" @ask="$emit('ask',$event)"/>
    <section v-else-if="node.type==='key_values'" class="aui-key-values" :aria-labelledby="scope+'-'+node.id+'-title'">
      <h4 :id="scope+'-'+node.id+'-title'">{{ node.title }}</h4>
      <dl><div v-for="(item,i) in node.items" :key="i"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div></dl>
      <p v-if="node.note" class="aui-key-note">{{ node.note }}</p>
    </section>
    <div v-else-if="node.type==='card_group'" class="aui-layout" :class="'aui-'+node.layout"><AgentUiNode v-for="child in node.children" :key="child.id" :node="child" :disabled="disabled" :scope="scope" :state-key="stateKey" @ask="$emit('ask',$event)"/></div>
    <div v-else-if="node.type==='table'" class="aui-panel"><div class="aui-panel-title">{{ node.title }}</div><div class="aui-table-scroll" tabindex="0" :aria-label="node.title+'，可横向滚动'"><table><caption class="aui-sr">{{ node.title }}</caption><thead><tr><th v-for="(column,i) in node.columns" :key="i" scope="col">{{ column }}</th></tr></thead><tbody><tr v-for="(row,i) in node.rows" :key="i"><td v-for="(cell,j) in row" :key="j">{{ cell }}</td></tr></tbody></table></div></div>
    <AgentUiChart v-else-if="node.type==='chart'" :node="node"/>
    <AgentUiWorkflow v-else-if="node.type==='steps'||node.type==='checklist'||node.type==='timeline'||node.type==='notice'||node.type==='faq'" :node="node" :disabled="disabled" :state-key="stateKey"/>
    <AgentUiOptions v-else-if="node.type==='options'" :node="node" :disabled="disabled" :scope="scope" @ask="$emit('ask',$event)"/>
    <template v-else-if="node.type==='button'">
      <a v-if="node.action.kind==='link'&&!disabled" class="aui-action" :href="node.action.url" target="_blank" rel="noopener noreferrer">{{ node.label }}<span aria-hidden="true">↗</span></a>
      <button v-else type="button" class="aui-action" :disabled="disabled" @click="askAction">{{ node.label }}<span aria-hidden="true">→</span></button>
    </template>
    <form v-else-if="node.type==='form'" class="aui-info aui-form" @submit.prevent="submitForm">
      <h4>{{ node.title }}</h4><div v-for="field in node.fields" :key="field.key" class="aui-field"><label :for="scope+'-'+node.id+'-'+field.key">{{ field.label }}<span v-if="field.required" aria-label="必填"> *</span></label>
        <select v-if="field.type==='select'" :id="scope+'-'+node.id+'-'+field.key" v-model="values[field.key]" :required="field.required" :disabled="disabled"><option value="">请选择</option><option v-for="option in field.options" :key="option" :value="option">{{ option }}</option></select>
        <input v-else :id="scope+'-'+node.id+'-'+field.key" v-model="values[field.key]" :type="field.type" :required="field.required" :disabled="disabled" maxlength="500" :step="field.type==='number'?'any':undefined"/>
      </div><p v-if="formError" class="aui-form-error" role="alert">{{ formError }}</p><p class="aui-caption">确认后，将这些条件交给 Agent 继续回答。</p><button class="aui-action" type="submit" :disabled="disabled">{{ node.submitLabel || '确认并继续' }} <span aria-hidden="true">→</span></button>
    </form>
  </div>
</template>
<script setup lang="ts">
import {ref,reactive} from 'vue'
import type {UiNode} from '@/utils/agent-ui'
import AgentUiChart from './AgentUiChart.vue'
import AgentUiWorkflow from './AgentUiWorkflow.vue'
import AgentUiOptions from './AgentUiOptions.vue'
import AgentUiService from './AgentUiService.vue'
const props=defineProps<{node:UiNode;disabled?:boolean;scope:string;stateKey?:string}>(),emit=defineEmits<{(e:'ask',message:string):void}>()
const imageFailed=ref(false),values=reactive<Record<string,string|number>>({}),formError=ref('')
function askAction(){if(!props.disabled&&props.node.type==='button'&&props.node.action.kind==='ask')emit('ask',props.node.action.message)}
function submitForm(){
 if(props.disabled||props.node.type!=='form')return
 const answer:string[]=[];formError.value=''
 for(const field of props.node.fields){const value=String(values[field.key]??'').trim();if(field.required&&!value){formError.value='请填写'+field.label;return}if(value.length>500||(field.type==='number'&&value&&!Number.isFinite(Number(value)))||(field.type==='select'&&value&&!field.options?.includes(value))){formError.value='请检查'+field.label;return}if(value)answer.push(field.label+'：'+value)}
 if(!answer.length){formError.value='请至少填写一项条件';return}
 emit('ask',props.node.action.message+'\n'+answer.join('\n'))
}
</script>
<style scoped>
.aui-heading{font-size:19px;line-height:1.5;font-weight:700}.aui-copy{white-space:pre-wrap;line-height:1.8}.aui-caption{font-size:12px;color:var(--aui-muted)}
.aui-info,.aui-panel{border:1px solid var(--aui-line);border-radius:18px;background:var(--aui-bg);overflow:hidden}.aui-info{padding:20px}.aui-info h4{font-size:16px;font-weight:650;line-height:1.5}.aui-badge{display:inline-block;font-size:11px;padding:2px 8px;margin-bottom:8px;border-radius:6px;color:var(--aui-accent);background:var(--aui-accent-soft)}.aui-summary{margin-top:8px!important;color:var(--aui-muted);white-space:pre-wrap}.aui-inner{margin-top:16px}.aui-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;margin:16px 0 0}.aui-metrics dt{font-size:12px;color:var(--aui-muted)}.aui-metrics dd{margin:4px 0 0;font-weight:650;font-variant-numeric:tabular-nums}.aui-panel-title{padding:14px 18px;font-weight:650;border-bottom:1px solid var(--aui-line)}
.aui-table-scroll{overflow-x:auto;max-width:100%}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:12px 16px;text-align:left;vertical-align:top;min-width:100px;max-width:300px;border-bottom:1px solid var(--aui-line);white-space:pre-wrap}th{background:var(--aui-soft);font-weight:600}tr:last-child td{border-bottom:0}.aui-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.aui-action{display:inline-flex;align-items:center;justify-content:space-between;gap:20px;max-width:100%;padding:10px 14px;border:1px solid var(--nx-accent-border,var(--aui-line));border-radius:10px;color:var(--aui-accent);background:var(--aui-accent-soft);text-decoration:none;white-space:normal;text-align:left}.aui-action:hover:not(:disabled){border-color:var(--aui-accent)}.aui-action span{flex-shrink:0}.aui-form{display:grid;gap:14px}.aui-field{display:grid;gap:6px}.aui-field label{font-size:13px;font-weight:500}.aui-field input,.aui-field select{width:100%;min-width:0;color:var(--aui-text);background:var(--aui-bg);border:1px solid var(--aui-line);border-radius:8px;padding:9px 12px}.aui-form-error{color:var(--el-color-danger)}.aui-image img{width:100%;max-height:340px;object-fit:contain;border-radius:12px}.aui-image figcaption{font-size:12px;color:var(--aui-muted);margin-top:8px}
@media(max-width:600px){.aui-info{padding:16px}.aui-heading{font-size:17px}th,td{padding:10px 12px}}
.aui-key-values{padding:18px 20px;border-left:3px solid var(--aui-accent);border-radius:0 12px 12px 0;background:var(--aui-soft)}.aui-key-values h4{font-size:15px;line-height:1.5;font-weight:650}.aui-key-values dl{display:grid;gap:12px;margin:16px 0 0}.aui-key-values dl>div{display:grid;grid-template-columns:minmax(64px,22%) minmax(0,1fr);gap:16px}.aui-key-values dt{color:var(--aui-muted);font-size:13px}.aui-key-values dd{margin:0;white-space:pre-wrap;font-variant-numeric:tabular-nums}.aui-key-note{margin-top:16px!important;padding-top:12px;border-top:1px solid var(--aui-line);font-size:13px;color:var(--aui-muted);white-space:pre-wrap}
.aui-layout.aui-grid>.aui-node>.aui-info{height:100%}.aui-metrics dd{overflow-wrap:anywhere}.aui-info,.aui-panel,.aui-service{border-radius:16px}.aui-action{min-height:44px}.aui-heading{letter-spacing:-.01em}.aui-table-scroll:focus-visible{outline:2px solid var(--aui-accent);outline-offset:-2px}tbody tr:hover{background:var(--aui-soft)}
@media(max-width:600px){.aui-key-values{padding:16px}.aui-key-values dl>div{gap:12px;grid-template-columns:minmax(60px,25%) minmax(0,1fr)}}
</style>
