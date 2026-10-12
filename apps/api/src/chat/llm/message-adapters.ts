import type {ChatMessage,LlmToolDef} from './types'

export function imageSource(url:string){
 const data=url.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i)
 return data?{type:'base64',media_type:data[1],data:data[2]}:{type:'url',url}
}
/** Provider conversion is the final boundary; tool IDs and replies survive every round. */
export function anthropicMessages(messages:ChatMessage[]){
 const output:{role:'assistant'|'user';content:any[]}[]=[]
 for(const message of messages){
  if(message.role==='system')continue
  const role=message.role==='assistant'?'assistant':'user',content:any[]=[]
  if(message.role==='tool')content.push({type:'tool_result',tool_use_id:message.toolCallId,content:message.content})
  else{
   if(message.content)content.push({type:'text',text:message.content})
   for(const image of message.images||[])content.push({type:'image',source:imageSource(image)})
   for(const call of message.toolCalls||[])content.push({type:'tool_use',id:call.id,name:call.name,input:JSON.parse(call.arguments||'{}')})
  }
  if(!content.length)content.push({type:'text',text:'（空消息）'})
  const previous=output.at(-1)
  if(previous?.role===role)previous.content.push(...content)
  else output.push({role,content})
 }
 return output
}
export function googleContents(messages:ChatMessage[]){
 const output:{role:'model'|'user';parts:any[]}[]=[]
 for(const message of messages){
  if(message.role==='system')continue
  const role=message.role==='assistant'?'model':'user',parts:any[]=[]
  if(message.role==='tool'){
   let response:any;try{response=JSON.parse(message.content)}catch{response={text:message.content}}
   if(!response||typeof response!=='object'||Array.isArray(response))response={result:response}
   parts.push({functionResponse:{name:message.name||'unknown_tool',response}})
  }else{
   if(message.content)parts.push({text:message.content})
   for(const url of message.images||[]){const source=imageSource(url);if(source.type==='base64')parts.push({inlineData:{mimeType:source.media_type,data:source.data}});else throw new Error('Gemini 图片输入需要 data URL，请先上传图片。')}
   for(const call of message.toolCalls||[])parts.push({functionCall:{name:call.name,args:JSON.parse(call.arguments||'{}')}})
  }
  if(!parts.length)parts.push({text:'（空消息）'})
  const previous=output.at(-1)
  if(previous?.role===role)previous.parts.push(...parts)
  else output.push({role,parts})
 }
 return output
}
export function googleTools(tools:LlmToolDef[]){return [{functionDeclarations:tools.map(tool=>({name:tool.name,description:tool.description,parameters:googleSchema(tool.parameters)}))}]}
function googleSchema(schema:any):any {
 const result:any={}
 for(const key of ['type','description','enum','required','nullable'])if(schema[key]!==undefined)result[key]=schema[key]
 if(schema.properties)result.properties=Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,googleSchema(value)]))
 if(schema.items)result.items=googleSchema(schema.items)
 return result
}
