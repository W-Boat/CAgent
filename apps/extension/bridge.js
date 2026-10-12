// Only installed on the platform timetable page. No tokens cross this bridge.
window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||location.pathname!=='/timetable'||event.data?.type!=='CAGENT_TIMETABLE_CAPTURE'||typeof event.data.requestId!=='string'||event.data.requestId.length>100)return
  const requestId=event.data.requestId
  try{
    const result=await chrome.runtime.sendMessage({type:'READ_UCASS_TIMETABLE'})
    window.postMessage({type:'CAGENT_TIMETABLE_RESULT',requestId,...(result||{error:'请重新加载课表助手'})},location.origin)
  }catch{window.postMessage({type:'CAGENT_TIMETABLE_RESULT',requestId,error:'课表助手连接失败，请重新加载扩展和本页面'},location.origin)}
})
