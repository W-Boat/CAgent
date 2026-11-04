import {NotFoundException} from '@nestjs/common'
type Kind='provider'|'model'|'agent'|'skill'
const prefix='removed_configuration:'
export async function removedConfigurationIds(db:any,kind:Kind):Promise<string[]>{return (await db.setting.findMany({where:{key:{startsWith:prefix+kind+':' }},select:{value:true}})).map((r:any)=>r.value?.id).filter((id:unknown)=>typeof id==='string')}
export async function assertConfigurationPresent(db:any,kind:Kind,id:string){if(await db.setting.findUnique({where:{key:prefix+kind+':'+id}}))throw new NotFoundException('该配置已移除')}
/** Preserve all referenced data; disable execution and free the original key for reuse. */
export async function removeConfiguration(db:any,kind:Kind,id:string){return db.$transaction(async(tx:any)=>{
 const row=await tx[kind].findUnique({where:{id}});if(!row)throw new NotFoundException('配置不存在')
 const mark=async(type:Kind,item:any)=>{const originalKey=item.key;await tx[type].update({where:{id:item.id},data:{enabled:false,key:'removed-'+item.id,...(type==='model'?{isDefault:false}:{})}});await tx.setting.upsert({where:{key:prefix+type+':'+item.id},create:{key:prefix+type+':'+item.id,group:'configuration',value:{id:item.id,key:originalKey,removedAt:new Date().toISOString()}},update:{}})}
 if(kind==='provider'){for(const model of await tx.model.findMany({where:{providerId:id}}))await mark('model',model);await tx.providerApiKey.updateMany({where:{providerId:id},data:{enabled:false}})}
 await mark(kind,row)
 return {success:true}
},{maxWait:10000,timeout:60000})}
