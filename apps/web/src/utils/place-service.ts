export type ServiceMode='online'|'offline'|'hybrid'|'unknown'
const text=(v:unknown)=>typeof v==='string'?v.trim():''
export function serviceMode(place:Record<string,unknown>):ServiceMode{
  const explicit=text(place.serviceMode).toLowerCase()
  if(['online','offline','hybrid'].includes(explicit))return explicit as ServiceMode
  const location=text(place.location),body=text(place.body),name=text(place.name)
  if(/(?:线上|在线|网上)/.test(location)&&/线下|现场/.test(location))return 'hybrid'
  if(/线上|在线|网上/.test(location))return 'online'
  const physical=location&&!/无|暂无|未收录|待确认|未知|详见|以.{0,8}通知为准/.test(location)&&!/^(?:https?:\/\/)/.test(location)
  if(physical)return 'offline'
  if(/(?:不支持|无法|不能|不可).{0,3}(?:线上|在线|网上)(?:办理|申请)|(?:仅|只能|须|必须)线下/.test(body))return 'offline'
  if(/(?:线上|在线|网上)(?:办理|申请|服务|入口|挂失|补办|缴费)|(?:办理|申请|服务|挂失|补办|缴费)(?:.*?)(?:线上|在线|网上)/.test(body+' '+name)){
    return /线下(?:办理|窗口)|现场办理|到校办理/.test(body)?'hybrid':'online'
  }
  if(/线下(?:办理|窗口|办理点)|现场办理|服务窗口|办事窗口/.test(body+' '+name))return 'offline'
  return 'unknown'
}
export function safeServiceUrl(value:unknown):string{
  try{const u=new URL(text(value));return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}
}
export const serviceModeLabels:Record<ServiceMode,string>={online:'线上办理',offline:'线下窗口',hybrid:'线上 / 线下',unknown:'服务信息'}
