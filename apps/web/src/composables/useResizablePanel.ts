import {onBeforeUnmount, ref} from 'vue'

export function useResizablePanel(key:string, initial:number, min=200, max=420) {
  const width=ref(initial)
  try { const saved=Number(localStorage.getItem(key)); if(saved>=min&&saved<=max)width.value=saved } catch {}
  let finish:()=>void=()=>{}
  function setWidth(value:number) { width.value=Math.max(min,Math.min(max,Math.round(value))) }
  function save() { try{localStorage.setItem(key,String(width.value))}catch{} }
  function resize(event:PointerEvent) {
    if(event.button!==0)return
    finish()
    const handle=event.currentTarget as HTMLElement
    const start=event.clientX, previous=width.value, pointer=event.pointerId
    handle.setPointerCapture(pointer)
    const move=(current:PointerEvent)=>{if(current.pointerId===pointer)setWidth(previous+current.clientX-start)}
    finish=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('lostpointercapture',finish);save()}
    handle.addEventListener('pointermove',move)
    handle.addEventListener('lostpointercapture',finish)
    event.preventDefault()
  }
  function keyResize(event:KeyboardEvent) {
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
    event.preventDefault();setWidth(event.key==='Home'?min:event.key==='End'?max:width.value+(event.key==='ArrowRight'?16:-16));save()
  }
  onBeforeUnmount(()=>finish())
  return {width,resize,keyResize}
}
