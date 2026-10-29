import type {LlmToolDef} from '../chat/llm/types'
export const lectureIntent=(query:string)=>/讲座|学术活动|学术沙龙|报告会|讲座日历|校园日历/.test(query)
export const lectureToolDefinition:LlmToolDef={name:'campus_lectures',readOnly:true,knowledgeRetrieval:true,
 description:'查询校园讲座与学术活动日历，按日期、月份、校区筛选。默认只查待开展预告；历史资料需scope=all。返回真实来源与日历入口；只读，不报名。',
 parameters:{type:'object',properties:{q:{type:'string',description:'讲座主题或主讲人关键词'},date:{type:'string',description:'活动日期 YYYY-MM-DD；今天/明天需按当前日期换算'},month:{type:'string',description:'月份 YYYY-MM'},campus:{type:'string',description:'良乡校区/望京校区/线上'},scope:{type:'string',enum:['upcoming','all','undated'],description:'upcoming待开展预告；all含历史；undated日期不明确'}},additionalProperties:false}}
