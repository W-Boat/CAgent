<script setup lang="ts">
import {ref,watch} from 'vue'
import {get,post,errorMessage} from '@/api/client'
import AnswerVersionControls from './AnswerVersionControls.vue'
const props=defineProps<{conversationId:string;messageId:string;disabled?:boolean}>(),emit=defineEmits<{(e:'selected',message:any):void;(e:'generate'):void}>()
const state=ref<{selected:number;items:{index:number;status:string}[]}>(),busy=ref(false),error=ref('');let sequence=0
const path=()=>`/conversations/${props.conversationId}/messages/${props.messageId}/versions`
watch(()=>[props.messageId,props.conversationId],async()=>{const request=++sequence;if(!props.conversationId||props.messageId.startsWith('local-'))return;try{const result=await get<NonNullable<typeof state.value>>(path());if(request===sequence)state.value=result}catch{if(request===sequence)state.value=undefined}},{immediate:true})
async function select(index:number){if(busy.value||props.disabled)return;busy.value=true;error.value='';try{emit('selected',await post(path()+'/'+index,{}));if(state.value)state.value.selected=index}catch(e){error.value=errorMessage(e)}finally{busy.value=false}}
</script>
<template><AnswerVersionControls :count="state?.items.length || 1" :selected="state?.selected || 0" :disabled="disabled || busy" :error="error" @select="select" @generate="emit('generate')"/></template>
