import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomBytes} from 'node:crypto'
import {PrismaService} from '../src/prisma/prisma.service'
import {AuditService} from '../src/common/services/audit.service'
import {KnowledgeStoreService} from '../src/knowledge/knowledge-store.service'
import {parseKeywordRule,matchesKeywordRule,keywordCardMarkup} from '../src/knowledge/keyword-rule'
import {dinnerEligible,mealName} from '../src/knowledge/food-catalog'
const root=resolve(__dirname,'../../..'),spec=JSON.parse(readFileSync(resolve(root,'knowledge/dinner-choice.json'),'utf8'))
for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname),'Only local fixtures')
const card={type:'dinner',title:spec.title,restaurants:spec.restaurants,additionalRestaurants:spec.additionalRestaurants,sourceCollection:spec.sourceCollection,note:spec.note}
const rule=parseKeywordRule(JSON.stringify({version:1,any:spec.aliases,match:'EXACT',behavior:'REPLACE',card}))
assert(matchesKeywordRule(rule,'今天吃什么？'));assert(matchesKeywordRule(rule,'今晚吃什么'))
assert(!matchesKeywordRule(rule,'今天吃什么，我对花生过敏'));assert(!matchesKeywordRule(rule,'不是问今天吃什么，我想知道食堂位置'))
assert.throws(()=>parseKeywordRule(JSON.stringify({...rule,card:{...card,restaurants:[]}})))
const previous=parseKeywordRule(JSON.stringify({version:1,any:['社科大'],behavior:'APPEND',card:{type:'facts',title:'原有',items:[]}}));assert(matchesKeywordRule(previous,'请介绍社科大'))
const db=new PrismaService(),store=new KnowledgeStoreService(db,new AuditService(db)),prefix='dinner-fixture-'+randomBytes(5).toString('hex');let userId='',baseId='',entryId=''
async function main(){
 await db.$connect();const role=await db.role.findUniqueOrThrow({where:{key:'super_admin'}}),user=await db.user.create({data:{email:prefix+'@example.invalid',name:prefix,passwordHash:'fixture-no-login',roles:{create:{roleId:role.id}}}});userId=user.id
 const base=await db.knowledgeBase.create({data:{name:prefix,kind:'LOCAL',mounted:true}});baseId=base.id
 const entry=await store.save({baseId,title:prefix,question:'今天吃什么',answer:JSON.stringify(rule),mode:'TRIGGER',status:'APPROVED'},user);entryId=entry.id
 const result=(await store.keywordRules('今天吃什么')).find(r=>r.entry.id===entryId)!,dinner=result.rule.card!;assert.equal(dinner.type,'dinner');if(dinner.type!=='dinner')throw Error('wrong card')
 const source=JSON.parse(readFileSync(resolve(root,'knowledge/src/社科大外卖红黑榜_RAG.json'),'utf8'))
 const expected=[...new Set<string>(source.sheets.flatMap((s:any)=>s.rows).map((r:any)=>r.food).filter(dinnerEligible).map(mealName))].filter(name=>name!=='麦当劳')
 assert(expected.length>80);assert.deepEqual([...dinner.restaurants].sort(),[...new Set([...spec.restaurants,...expected])].sort());assert.equal(dinner.sourceCount,330);assert.equal(dinner.foodItems?.length,330);assert.deepEqual(dinner.foodItems?.map(i=>i.id).sort((a,b)=>a-b),source.sheets.flatMap((s:any)=>s.rows).map((r:any)=>r.food).filter(dinnerEligible).map((i:any)=>i.id).sort((a:number,b:number)=>a-b));assert(dinner.foodItems?.every(i=>!('reviews' in i)));assert(Buffer.byteLength(keywordCardMarkup(result.rule,entryId),'utf8')<128*1024)
 const payload=JSON.parse(keywordCardMarkup(result.rule,entryId).split('\n')[3]);assert(dinner.restaurants.includes(payload.initial));assert.equal(new Set(payload.restaurants).size,payload.restaurants.length)
 const original=store.embeddedEnabled.bind(store);store.embeddedEnabled=async()=>false
 const gated=(await store.keywordRules('今天吃什么')).find(r=>r.entry.id===entryId)!.rule.card!;assert.equal(gated.type,'dinner');if(gated.type==='dinner')assert.deepEqual(gated.restaurants,spec.restaurants);store.embeddedEnabled=original
 assert.equal((await store.keywordRules('今天吃什么，我不想活了')).length,0)
 await db.knowledgeBase.update({where:{id:baseId},data:{mounted:false}});assert(!(await store.keywordRules('今天吃什么')).some(r=>r.entry.id===entryId))
 console.log('PASS exact intent, old rules, live red-list names, three canteens, source gate, urgent override and base switch')
}main().catch(error=>{console.error('Dinner verification failed',error instanceof assert.AssertionError?error.message:{type:error?.name,code:error?.code,locations:String(error?.stack||'').split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,4)});process.exitCode=1}).finally(async()=>{if(entryId){await db.knowledgeRevision.deleteMany({where:{entryId}});await db.knowledgeEntry.deleteMany({where:{id:entryId}})}if(baseId)await db.knowledgeBase.deleteMany({where:{id:baseId}});if(userId){await db.auditLog.deleteMany({where:{userId}});await db.userRole.deleteMany({where:{userId}});await db.user.deleteMany({where:{id:userId}})}await db.$disconnect()})
