import {BadRequestException, Injectable, ServiceUnavailableException} from '@nestjs/common'
import {ConfigService} from '@nestjs/config'
import {createHmac,timingSafeEqual} from 'node:crypto'
import {PrismaService} from '../prisma/prisma.service'
import {CryptoService} from '../common/services/crypto.service'

const API='https://api.deepseek.com'
const recognized=new Set(['pdf','doc','docx','ppt','pptx','bmp','tif','tiff'])
const converted=new Set(['xls','xlsx','epub','mobi'])
export const deepSeekFilesModel=(key:string,base?:string|null)=>/^deepseek-(?:v[\d.]+-)?flash$/i.test(key)&&/^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/i.test(base||'')
const validFile=(id:unknown):id is string=>typeof id==='string'&&/^file-api-[a-zA-Z0-9_-]{6,140}$/.test(id)

@Injectable()
export class ChatFilesService{
 constructor(private readonly config:ConfigService,private readonly db:PrismaService,private readonly crypto:CryptoService){}
 private active=new Set<string>()
 async credential(){
   const env=this.config.get<string>('DEEPSEEK_FILE_API_KEY')||this.config.get<string>('DEEPSEEK_API_KEY')
   if(env)return env
   const provider=await this.db.provider.findUnique({where:{key:'deepseek'},select:{enabled:true,baseUrl:true,apiKey:true,apiKeys:{where:{enabled:true,status:'ACTIVE'},orderBy:[{sort:'asc'},{id:'asc'}],take:1,select:{apiKey:true}}}})
   const key=provider?.enabled&&/^(?:https:\/\/api\.deepseek\.com(?:\/v1)?\/?)?$/.test(provider.baseUrl||'')?this.crypto.decrypt(provider.apiKey)||this.crypto.decrypt(provider.apiKeys[0]?.apiKey):''
   if(!key)throw new ServiceUnavailableException('请先配置 DeepSeek 文件服务密钥')
   return key
 }
 private sign(value:string){const secret=this.config.get<string>('JWT_SECRET');if(!secret)throw new ServiceUnavailableException('文件服务尚未初始化');return createHmac('sha256',secret).update(value).digest()}
 async upload(userId:string,file?:{buffer:Buffer;originalname:string}){
   const name=file?.originalname?.split(/[\\/]/).at(-1)?.slice(0,120)||''
   const ext=name.split('.').at(-1)?.toLowerCase()||''
   if(!file?.buffer.length||(!recognized.has(ext)&&!converted.has(ext)))throw new BadRequestException('请选择 PDF、Word、PowerPoint、Excel、EPUB、MOBI、BMP 或 TIFF 文件')
   if(this.active.has(userId)||this.active.size>=8)throw new BadRequestException('已有文件正在解析，请稍候')
   this.active.add(userId)
   try{
     const key=await this.credential(),form=new FormData()
     form.append('purpose',recognized.has(ext)?'text_recognition':'user_data')
     form.append('file',new Blob([Uint8Array.from(file.buffer)]),name)
     const response=await fetch(API+'/files',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,redirect:'error',signal:AbortSignal.timeout(240000)})
     if(!response.ok){await response.body?.cancel();throw new BadRequestException(`DeepSeek 文件解析失败（${response.status}）`)}
     const id=(await response.json() as {id?:unknown}).id
     if(!validFile(id))throw new BadRequestException('DeepSeek 未返回有效文件标识')
     const expires=Date.now()+24*60*60*1000
     const payload=Buffer.from(JSON.stringify({userId,id,name,expires})).toString('base64url')
     return {name,token:`${payload}.${this.sign(payload).toString('base64url')}`}
   }catch(error){if(error instanceof BadRequestException||error instanceof ServiceUnavailableException)throw error;throw new ServiceUnavailableException('文件解析超时或服务暂不可用')}
   finally{this.active.delete(userId)}
 }
 verify(tokens:string[],userId:string){
   return tokens.map(token=>{
     try{
       const [body,signature,...rest]=token.split('.'),actual=Buffer.from(signature,'base64url'),expected=this.sign(body)
       if(rest.length||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error()
       const data=JSON.parse(Buffer.from(body,'base64url').toString('utf8'))
       if(data.userId!==userId||data.expires<Date.now()||!validFile(data.id)||typeof data.name!=='string')throw Error()
       return {id:data.id as string,name:data.name as string,expires:data.expires as number}
     }catch{throw new BadRequestException('附件已过期或不属于当前账号，请重新上传')}
   })
 }
}
