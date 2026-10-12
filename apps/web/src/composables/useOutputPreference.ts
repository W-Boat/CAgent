import {computed,reactive,watch} from 'vue'
import {useAuthStore} from '@/stores/auth'
export type OutputPreference='cards'|'adaptive'|'text'
export const OUTPUT_PREFERENCES=[
 {value:'cards',label:'固定卡片',benefit:'使用熟悉的步骤、清单和信息卡，布局一致，办事更直观。'},
 {value:'adaptive',label:'新式排版',benefit:'按信息结构组合卡片、表格、图表和表单，适合比较与交互。'},
 {value:'text',label:'文字为主',benefit:'优先段落和列表，方便连续阅读、复制和整理。地图、关怀等专用卡按场景保留。'},
] as const
const values=reactive<Record<string,OutputPreference>>({})
let pendingAnonymousChoice:OutputPreference|undefined
export function useOutputPreference(){
 const auth=useAuthStore(),key=computed(()=>'cagent.outputPreference.'+(auth.user?.id||'trial'))
 // Public trial can render before session restoration finishes. Preserve a choice made during that gap.
 watch(key,next=>{if(next.endsWith('.trial')||!pendingAnonymousChoice)return;values[next]=pendingAnonymousChoice;try{localStorage.setItem(next,pendingAnonymousChoice)}catch{};pendingAnonymousChoice=undefined},{immediate:true,flush:'sync'})
 const outputPreference=computed<OutputPreference>({get(){if(!values[key.value]){let value:string|null=null;try{value=localStorage.getItem(key.value)}catch{};values[key.value]=OUTPUT_PREFERENCES.some(o=>o.value===value)?value as OutputPreference:'adaptive'}return values[key.value]},set(value){if(!OUTPUT_PREFERENCES.some(o=>o.value===value))return;values[key.value]=value;if(key.value.endsWith('.trial'))pendingAnonymousChoice=value;try{localStorage.setItem(key.value,value)}catch{}}})
 return {outputPreference}
}
