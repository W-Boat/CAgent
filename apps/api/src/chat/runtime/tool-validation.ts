import Ajv, {type ValidateFunction} from 'ajv'
import addFormats from 'ajv-formats'
import type {LlmToolDef} from '../llm/types'

/** Schemas never coerce values, insert defaults or silently remove model arguments. */
const ajv=new Ajv({allErrors:true,strict:false,coerceTypes:false,useDefaults:false,removeAdditional:false,logger:false})
addFormats(ajv)
const validators=new WeakMap<object,ValidateFunction>()
export function parseToolArguments(def:LlmToolDef,raw:string):Record<string,unknown> {
  if(raw.length>100_000)throw new Error('工具参数过长')
  let args:unknown
  try{args=JSON.parse(raw||'{}')}catch{throw new Error('工具参数必须是完整的 JSON 对象，请修正后重试')}
  if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('工具参数必须是 JSON 对象')
  let validate=validators.get(def.parameters)
  if(!validate){try{validate=ajv.compile(def.parameters);validators.set(def.parameters,validate)}catch{throw new Error('工具参数定义无效，请联系管理员检查该技能的输入结构')}}
  if(!validate(args))throw new Error('工具参数不符合定义：'+ajv.errorsText(validate.errors,{separator:'；'}).slice(0,500))
  return args as Record<string,unknown>
}
export function canonicalArguments(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonicalArguments).join(',')+']'
  if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonicalArguments(v)).join(',')+'}'
  return JSON.stringify(value)
}
