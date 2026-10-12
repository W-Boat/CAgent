import {extractTimetable} from './extract.js'
const allowedSender=url=>{try{const u=new URL(url);return ((u.origin==='https://campus.example.org')||(['http://localhost:5173','http://127.0.0.1:5173','http://localhost:4173','http://127.0.0.1:4173'].includes(u.origin)))&&u.pathname==='/timetable'}catch{return false}}
let reading=false
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
  if(!allowedSender(sender.url)||request?.type!=='READ_UCASS_TIMETABLE')return false
  if(reading){respond({error:'正在读取，请稍后再试'});return false}
  reading=true
  ;(async()=>{
    const tabs=await chrome.tabs.query({url:'https://ut.ucass.edu.cn/*'})
    if(!tabs.length)throw new Error('请先在同一浏览器打开本科教务、登录，并进入「我的课表」')
    const results=[]
    for(const tab of tabs){
      if(!tab.id)continue
      const captures=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:extractTimetable})
      for(const frame of captures)if(frame.result?.capture)results.push(frame.result.capture)
    }
    if(!results.length)throw new Error('未找到课表。请打开「我的课表」，选好学期并点击「确定」，保持表格显示后再读取')
    if(results.length>1)throw new Error('发现多张课表，请只保留一个教务「我的课表」页面，避免读取错误学期')
    respond({capture:results[0]})
  })().catch(error=>respond({error:error.message||'读取失败，请检查教务页面是否仍在登录状态'})).finally(()=>reading=false)
  return true
})
