import {onMounted,onBeforeUnmount,watch,type Ref} from 'vue'

export function useComposerHeight(input:Ref<HTMLTextAreaElement|undefined>,key:string) {
  let preferred=0
  try {preferred=Number(localStorage.getItem(key))||0} catch {}
  const minimum=()=>window.innerWidth<=720?40:46
  const maximum=()=>Math.max(minimum(),Math.min(420,Math.floor(window.innerHeight*.46)))
  const clamp=(height:number)=>Math.max(minimum(),Math.min(maximum(),height))
  function grow(){
    const el=input.value
    if(!el)return
    el.style.height='0px'
    el.style.height=clamp(Math.max(preferred,el.scrollHeight))+'px'
  }
  function save(){try{localStorage.setItem(key,String(preferred))}catch{}}
  let drag:{id:number;y:number;height:number;target:HTMLElement}|undefined
  function start($event:PointerEvent){
    if($event.button!==0||!input.value)return
    const target=$event.currentTarget as HTMLElement
    drag={id:$event.pointerId,y:$event.clientY,height:input.value.offsetHeight,target}
    target.setPointerCapture($event.pointerId);$event.preventDefault()
  }
  function move(event:PointerEvent){
    if(drag?.id!==event.pointerId)return
    preferred=clamp(drag.height+drag.y-event.clientY);grow()
  }
  function finish(event:PointerEvent){
    if(drag?.id!==event.pointerId)return
    const current=drag;drag=undefined
    if(current.target.hasPointerCapture(event.pointerId))current.target.releasePointerCapture(event.pointerId)
    save()
  }
  function resize(event:KeyboardEvent){
    if(!['ArrowUp','ArrowDown','Home'].includes(event.key))return
    event.preventDefault()
    preferred=event.key==='Home'?0:clamp((input.value?.offsetHeight||minimum())+(event.key==='ArrowUp'?20:-20));grow();save()
  }
  onMounted(()=>{grow();window.addEventListener('resize',grow)})
  watch(input,grow,{flush:'post'})
  onBeforeUnmount(()=>window.removeEventListener('resize',grow))
  return {grow,start,move,finish,resize}
}
