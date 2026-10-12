import {z} from 'zod'
import {randomInt} from 'node:crypto'
const phrases=z.array(z.string().min(1).max(100)).max(20)
const factsCard=z.object({type:z.literal('facts'),title:z.string().max(80),items:z.array(z.object({label:z.string().max(80),value:z.string().max(500)})).max(8),note:z.string().max(500).optional()})
const takeoutCard=z.object({type:z.literal('takeout'),title:z.string().max(80),verdict:z.enum(['good','bad','mixed']).optional()})
const dinnerCard=z.object({type:z.literal('dinner'),title:z.string().max(80),restaurants:z.array(z.string().trim().min(1).max(80)).min(1).max(500),additionalRestaurants:z.array(z.string().trim().min(1).max(80)).max(100).optional(),sourceCollection:z.literal('takeout').optional(),sourceCount:z.number().int().min(0).max(500).optional(),redNameCount:z.number().int().min(0).max(500).optional(),foodItems:z.array(z.object({id:z.number().int(),name:z.string(),price:z.string(),place:z.string(),pgroup:z.string(),category:z.string(),verdict:z.enum(['good','bad','mixed']).optional(),reviews:z.array(z.string()).optional(),sources:z.array(z.string()).optional(),drawable:z.boolean().optional()})).max(500).optional(),note:z.string().max(500).optional()})
export const keywordRuleSchema=z.object({
  version:z.literal(1),all:z.array(phrases.min(1)).max(10).default([]),any:phrases.default([]),
  match:z.enum(['CONTAINS','EXACT']).default('CONTAINS'),
  behavior:z.enum(['REPLACE','APPEND','INSTRUCT']),text:z.string().max(3000).default(''),
  effect:z.enum(['tiger','melon','cat']).optional(),
  card:z.union([factsCard,dinnerCard,takeoutCard]).optional(),
  instruction:z.string().max(2000).optional()
}).refine(r=>r.all.length || r.any.length,'至少填写一个匹配词')
export type KeywordRule=z.infer<typeof keywordRuleSchema>
export const campusQuery=(query:string)=>query.replace(/🐍\ufe0f?/gu,'社科大')
const normalized=(s:string)=>campusQuery(s).normalize('NFKC').toLowerCase().replace(/\s+/g,'')
export function parseKeywordRule(text:string):KeywordRule {return keywordRuleSchema.parse(JSON.parse(text))}
export function matchesKeywordRule(rule:KeywordRule,query:string){const q=normalized(query),raw=query.normalize('NFKC').toLowerCase().replace(/\s+/g,'');const exact=(s:string)=>normalized(s).replace(/^[，。！？、,.!?]+|[，。！？、,.!?]+$/g,'');const contains=(p:string)=>rule.match==='EXACT'?exact(query)===exact(p):p.includes('🐍')?raw.includes(p):q.includes(normalized(p));return rule.all.every(group=>group.some(contains))&&(!rule.any.length || rule.any.some(contains))}
/** Crisis support must not be replaced by a joke, even when another trigger matches. */
export const isSupportUrgent=(q:string)=>/自杀|自残|不想活|活不下去|结束生命|轻生|寻死|想死|伤害自己|跳楼|跳河|杀了自己|想不开|绝望|撑不下去|救命|流血|被.{0,8}(咬|攻击)|遭.{0,5}(虐待|侵犯|威胁)/.test(q)
export function keywordCardMarkup(rule:KeywordRule,id:string){const card=rule.card?.type==='dinner'?{...rule.card,restaurants:[...new Set(rule.card.restaurants)],initial:rule.card.restaurants[randomInt(rule.card.restaurants.length)]}:rule.card;return [card,rule.effect?{type:'effect',effect:rule.effect,title:rule.effect==='tiger'?'大老虎':rule.effect==='melon'?'小辛瓜':'猫咪',ruleId:id}:null].filter(Boolean).map(card=>'\n\n```card\n'+JSON.stringify(card)+'\n```').join('')}
