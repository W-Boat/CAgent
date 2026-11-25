const dayFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'})

export function groupConversations<T extends {pinned?:boolean;lastMessageAt?:string|null;updatedAt:string;createdAt?:string}>(rows:T[],now=Date.now()) {
  const today=dayFormat.format(now),yesterday=dayFormat.format(now-86400000)
  const groups=new Map<string,T[]>()
  for(const row of rows){
    const date=new Date(row.lastMessageAt||row.updatedAt||row.createdAt||'').getTime()
    const key=row.pinned?'pinned':Number.isFinite(date)?dayFormat.format(date):'older'
    const group=groups.get(key)||[];group.push(row);groups.set(key,group)
  }
  const rank=(key:string)=>key==='pinned'?'9999':key==='older'?'0000':key
  return [...groups].sort(([a],[b])=>rank(b).localeCompare(rank(a))).map(([key,items])=>({
    key,items,label:key==='pinned'?'已置顶':key===today?'今天':key===yesterday?'昨天':key==='older'?'较早':key.slice(0,4)===today.slice(0,4)?key.slice(5).replace('-',' 月 ')+' 日':key
  }))
}
