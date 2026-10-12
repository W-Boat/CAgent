import { BadRequestException } from '@nestjs/common'

let cached: { token: string; until: number } | undefined
let pending: Promise<string> | undefined
export function collectorAddress() {
  const address = process.env.WECHAT_COLLECTOR_URL || ''
  if (!address) throw new BadRequestException('服务器采集器尚未配置')
  const url = new URL(address)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new BadRequestException('服务器采集器地址无效')
  return url.origin
}
export async function collectorToken(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token
  if (pending) return pending
  const request = (async () => {
    const response = await fetch(collectorAddress() + '/api/v1/wx/auth/login', {
      method: 'POST', body: new URLSearchParams({ username: process.env.WECHAT_COLLECTOR_USER || '', password: process.env.WECHAT_COLLECTOR_PASSWORD || '' }),
      redirect: 'error', signal: AbortSignal.timeout(12000)
    }).catch(() => { throw new BadRequestException('服务器采集器连接失败，请稍后重试') })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.data?.access_token) throw new BadRequestException('服务器采集器账号配置无效')
    const token = String(body.data.access_token)
    cached = { token, until: Date.now() + Math.min(3600, Number(body.data.expires_in) || 600) * 1000 - 30000 }
    return token
  })()
  pending = request
  try { return await request } finally { if (pending === request) pending = undefined }
}
export async function collectorRequest(path: string, method = 'GET', body?: unknown) {
  const token = await collectorToken()
  const response = await fetch(collectorAddress() + '/api/v1/wx' + path, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(25000)
  }).catch(() => { throw new BadRequestException('采集器暂时无法响应，请稍后重试') })
  if (response.status === 401) cached = undefined
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.code !== 0) throw new BadRequestException('采集器操作失败，请检查微信授权状态')
  return result.data
}
export async function collectorStatus() {
  const data = await collectorRequest('/auth/qr/status')
  const engine=data?.engine==='WECHRSS'?'WECHRSS':'WEMP',state=String(data?.login_state||'')
  const messages:Record<string,string>={error:'微信读书登录失败，请重新生成二维码',expired:'二维码已过期，请重新生成',declined:'手机已取消授权，请重新扫码',scanned:'已扫码，请在手机确认',exchanging:'正在建立微信读书会话',initializing:'正在初始化微信读书账号'}
  return { available: true, loggedIn: data?.login_status === true, qrReady: data?.qr_code === true,engine,loginState:state,message:messages[state]||'' }
}
export function collectionResult(data:any,id:string){
  const messages:Record<string,string>={NONE:'尚未启动采集',QUEUED:'等待服务器采集',RUNNING:'正在采集最新文章与正文',SUCCEEDED:'最新文章已进入采集器，可测试正文并同步知识库',PARTIAL:'部分正文已缓存，其余文章暂不可读；可同步可用正文',CONTENT_BLOCKED:'已获取文章目录，但正文要求验证或暂不可读，未导入摘要',RATE_LIMITED:'微信限制请求，已暂停重复采集；请等待重试时间',AUTH_REQUIRED:'需要微信读书授权，请扫码连接',NOT_SUBSCRIBED:'公众号尚未订阅，请重新读取订阅列表',DISABLED:'采集器中的公众号订阅已停用',INTERRUPTED:'采集器重启中断了任务，请重新采集',EMPTY:'本次未采集到文章，请检查公众号文章可读性',FAILED:'文章采集失败，请检查服务器网络与微信授权后重试'}
  const status=String(data?.status||'')
  if(!messages[status])throw new BadRequestException('采集器尚不支持采集进度，请联系管理员更新采集器')
  return {id,status,message:messages[status],collected:Math.max(0,Number(data.collected)||0),...(Number.isFinite(data.retryAfter)?{retryAfter:data.retryAfter}:{}),...(Number.isFinite(data.startedAt)?{startedAt:data.startedAt}:{}),...(Number.isFinite(data.finishedAt)?{finishedAt:data.finishedAt}:{}),...(typeof data.autoCollect==='boolean'?{autoCollect:data.autoCollect,intervalMinutes:Math.min(10080,Math.max(60,Number(data.intervalMinutes)||360)),nextCollectAt:Math.max(0,Number(data.nextCollectAt)||0)}:{})}
}
export async function collectorCollection(id:string,start=false){
  if(!/^MP_[A-Za-z0-9_-]{1,140}$/.test(id))throw new BadRequestException('采集器公众号 ID 无效')
  return collectionResult(await collectorRequest((start?'/mps/update/':'/mps/collection/')+encodeURIComponent(id)+(start?'?start_page=0&end_page=1':'')),id)
}
export function collectorBatchResult(data:any){
  if(!/^[a-f0-9]{32}$/.test(String(data?.id||''))||!['QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','INTERRUPTED'].includes(data?.status)||!Array.isArray(data.items)||data.items.length>50)throw new BadRequestException('批量订阅结果格式不兼容')
  const messages:Record<string,string>={WAITING:'等待识别',RUNNING:'正在识别并订阅',SUCCEEDED:'订阅成功，将按计划采集',EXISTING:'已经订阅，保留现有设置',FAILED:'无法识别公众号，请检查文章链接；长链接可补填公众号名称'}
  return {id:String(data.id),status:String(data.status),total:data.items.length,items:data.items.map((item:any,index:number)=>{
    const status=messages[item?.status]?String(item.status):'FAILED',id=String(item?.id||'')
    return {index,name:String(item?.name||'待识别公众号').slice(0,120),status,message:messages[status],...(/^MP_WXS_\d{1,20}$/.test(id)?{id}:{})}
  })}
}
export async function collectorQrImage() {
  if((await collectorStatus()).engine==='WECHRSS'){
    const data=await collectorRequest('/auth/qr/image'),value=String(data?.image||'')
    if(!value.startsWith('data:image/png;base64,')||value.length>400000)throw new BadRequestException('二维码尚未生成，请稍候刷新')
    const png=Buffer.from(value.slice(22),'base64');if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new BadRequestException('二维码图片无效')
    return {image:value}
  }
  const response = await fetch(collectorAddress() + '/static/wx_qrcode.png?t=' + Date.now(), {
    redirect: 'error', signal: AbortSignal.timeout(10000)
  }).catch(() => { throw new BadRequestException('二维码读取失败，请重试') })
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/') || Number(response.headers.get('content-length')) > 300000) throw new BadRequestException('二维码尚未生成，请稍候刷新')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > 300000 || buffer.length < 8 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new BadRequestException('二维码图片无效')
  return { image: 'data:image/png;base64,' + buffer.toString('base64') }
}
