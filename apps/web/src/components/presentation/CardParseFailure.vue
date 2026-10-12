<template><div class="card-render-failure" role="status"><strong>这部分卡片未完整生成</strong><p>{{attempted?'已重新检查，数据仍不完整。可使用回答下方的重新生成按钮补全。':'可以重新校验已有内容；若数据缺失，需要重新生成回答。'}}</p><button type="button" :disabled="disabled" @click="retry(false)">重新渲染</button><small>首次已自动校验，后续由你重渲；不调用模型，诊断已上报。</small></div></template>
<script setup lang="ts">
import {ref,watch,nextTick} from 'vue'
import {reportRender} from '@/utils/presentation-errors'
const props=defineProps<{disabled?:boolean;reportKey?:string}>(),emit=defineEmits<{(e:'retry'):void}>(),attempted=ref(false)
let autoUsed=false,attempt=0
function retry(automatic=false){attempt++;attempted.value=true;reportRender({component:'card-parser',errorType:'syntax',retryMode:automatic?'automatic':'manual',attempt,messageId:props.reportKey});emit('retry')}
watch(()=>props.disabled,disabled=>{if(disabled||autoUsed)return;autoUsed=true;reportRender({component:'card-parser',errorType:'syntax',retryMode:'initial',attempt:0,messageId:props.reportKey});void nextTick(()=>retry(true))},{immediate:true})
</script>
