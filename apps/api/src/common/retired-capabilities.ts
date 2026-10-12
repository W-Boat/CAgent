import {NotFoundException} from '@nestjs/common'
import type {PrismaService} from '../prisma/prisma.service'
import type {Prisma} from '@prisma/client'
/** Product retirement applies to admins too, independently of enabled/permission flags. */
export const RETIRED_CAPABILITY=/人文之光|editorial|loveline|love[-_]?line|couple|情侣空间|心屿/i
export const visibleCapabilityWhere={NOT:{OR:[
  {key:{contains:'editorial',mode:'insensitive' as const}},
  {name:{contains:'人文之光',mode:'insensitive' as const}}
  ,{key:{contains:'loveline',mode:'insensitive' as const}},{key:{contains:'love-line',mode:'insensitive' as const}},{key:{contains:'couple',mode:'insensitive' as const}},{name:{contains:'情侣空间'}},{name:{contains:'心屿'}}
]}}
export const visibleConversationWhere={OR:[{agentId:null},{agent:{is:visibleCapabilityWhere}}]}
export function isRetiredCapability(item:{key?:string|null;name?:string|null;description?:string|null}|null|undefined){return !!item&&RETIRED_CAPABILITY.test([item.key,item.name,item.description].filter(Boolean).join(' '))}
export function assertVisibleCapability(item:{key?:string|null;name?:string|null;description?:string|null}|null|undefined){if(!item||isRetiredCapability(item))throw new NotFoundException('内容不存在或已下线')}
/** Hide legacy audit rows without deleting the retained audit trail. */
export async function visibleAuditWhere(db:PrismaService):Promise<Prisma.AuditLogWhereInput>{
  const [agents,skills]=await Promise.all([
    db.agent.findMany({where:{NOT:visibleCapabilityWhere},select:{id:true}}),
    db.skill.findMany({where:{NOT:visibleCapabilityWhere},select:{id:true}})
  ])
  const agentIds=agents.map(a=>a.id)
  const [conversations,learning]=agentIds.length?await Promise.all([
    db.conversation.findMany({where:{agentId:{in:agentIds}},select:{id:true}}),
    db.agentLearning.findMany({where:{agentId:{in:agentIds}},select:{id:true}})
  ]):[[],[]]
  const resources:[string,string[]][]=[['agent',agentIds],['skill',skills.map(s=>s.id)],['conversation',conversations.map(c=>c.id)],['agent_learning',learning.map(l=>l.id)]]
  return {AND:resources.filter(([,ids])=>ids.length).map(([resource,ids])=>({OR:[{resource:{not:resource}},{resourceId:null},{resourceId:{notIn:ids}}]}))}
}
/** Safety net for nested metadata in legacy dashboard/audit payloads. Free-form messages are preserved. */
export function stripRetiredCapabilities(value:any):any{
  if(Array.isArray(value))return value.filter(item=>!isRetiredCapability(item)&&!isRetiredCapability(item?.agent)&&!isRetiredCapability(item?.skill)).map(stripRetiredCapabilities)
  if(value&&typeof value==='object'&&!(value instanceof Date)){
    if(isRetiredCapability(value))return null
    return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,stripRetiredCapabilities(child)]))
  }
  return value
}
