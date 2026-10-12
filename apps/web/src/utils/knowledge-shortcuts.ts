import {ref,onMounted,onUnmounted} from 'vue'
import {get} from '@/api/client'

interface Shortcut {id:string;label:string;question:string}
const shortcuts=ref<Shortcut[]>([])
let users=0,pending:Promise<void>|undefined,timer:ReturnType<typeof setInterval>|undefined
const signalKey='cagent.knowledgeShortcutsChanged'
export function refreshKnowledgeShortcuts(){
  if(pending)return pending
  pending=get<Shortcut[]>('/campus/shortcuts').then(items=>{shortcuts.value=Array.isArray(items)?items:[]}).catch(()=>{shortcuts.value=[]}).finally(()=>{pending=undefined})
  return pending
}
function visibleRefresh(){if(!document.hidden)void refreshKnowledgeShortcuts()}
function storageChanged(e:StorageEvent){if(e.key===signalKey)visibleRefresh()}
export function notifyKnowledgeChanged(){
  try{localStorage.setItem(signalKey,String(Date.now()))}catch{}
  window.dispatchEvent(new Event('knowledge-changed'))
}
export function useKnowledgeShortcuts(){
  onMounted(()=>{if(++users===1){window.addEventListener('focus',visibleRefresh);window.addEventListener('knowledge-changed',visibleRefresh);window.addEventListener('storage',storageChanged);document.addEventListener('visibilitychange',visibleRefresh);timer=setInterval(visibleRefresh,30_000)}void refreshKnowledgeShortcuts()})
  onUnmounted(()=>{if(--users===0){window.removeEventListener('focus',visibleRefresh);window.removeEventListener('knowledge-changed',visibleRefresh);window.removeEventListener('storage',storageChanged);document.removeEventListener('visibilitychange',visibleRefresh);if(timer)clearInterval(timer);timer=undefined}})
  return shortcuts
}
