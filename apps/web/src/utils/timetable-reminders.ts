import {watch,onMounted,onBeforeUnmount} from 'vue'
import {ElNotification} from 'element-plus'
import {useRouter} from 'vue-router'
import {useAuthStore} from '@/stores/auth'
import {timetableApi} from '@/api/timetable'
/** Best-effort reminders while the platform is open. Offline alarms use exported ICS. */
export function useTimetableReminders(){
  const auth=useAuthStore(),router=useRouter();let timer:ReturnType<typeof setInterval>|undefined,loading=false
  const check=async()=>{
    if(!auth.isLoggedIn||loading)return
    const ownerId=auth.user!.id;loading=true
    try{
      const data=await timetableApi.upcoming()
      if(auth.user?.id!==ownerId||!data.configured||!data.remindersEnabled)return
      const now=Date.now()
      for(const e of data.events){
        const seconds=(Date.parse(e.startsAt)-now)/1000
        if(seconds<=0||seconds>data.reminderLeadMinutes*60)continue
        const key=`cagent-reminder:${ownerId}:${e.id}:${e.startsAt}:${e.name}`
        if(localStorage.getItem(key))continue
        localStorage.setItem(key,String(now))
        const title=`${e.name} · ${Math.ceil(seconds/60)} 分钟后上课`,body=`${e.start} ${e.location||'教室未标明'}`
        if('Notification'in window&&Notification.permission==='granted'){
          const notice=new Notification(title,{body,tag:key});notice.onclick=()=>{window.focus();void router.push(e.mapUrl||'/timetable');notice.close()}
        }else ElNotification({title,message:body,duration:10000,onClick:()=>{void router.push(e.mapUrl||'/timetable')}})
      }
      // Retain only recent de-duplication markers, never course bodies or access tokens.
      for(const key of Object.keys(localStorage))if(key.startsWith('cagent-reminder:')&&Number(localStorage.getItem(key))<now-7*86400000)localStorage.removeItem(key)
    }catch{/* Network outages must not interrupt chat. */}finally{loading=false}
  }
  watch(()=>auth.user?.id,()=>{void check()})
  onMounted(()=>{timer=setInterval(()=>{void check()},30000);window.addEventListener('cagent-timetable-updated',check);window.addEventListener('focus',check);void check()})
  onBeforeUnmount(()=>{clearInterval(timer);window.removeEventListener('cagent-timetable-updated',check);window.removeEventListener('focus',check)})
}
