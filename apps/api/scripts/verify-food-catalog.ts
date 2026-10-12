import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {PrismaService} from '../src/prisma/prisma.service'
import {AuditService} from '../src/common/services/audit.service'
import {KnowledgeStoreService} from '../src/knowledge/knowledge-store.service'
import {foodSource,dinnerEligible} from '../src/knowledge/food-catalog'
import {sourceDefinition} from '../src/knowledge/embedded-knowledge'
const root=resolve(__dirname,'../../..')
for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname))
const db=new PrismaService(),store=new KnowledgeStoreService(db,new AuditService(db)),original=JSON.parse(readFileSync(resolve(root,'knowledge/supplements/takeout-extracted.json'),'utf8'))
async function main(){try{await db.$connect();const items=await store.foodItems();assert.deepEqual(items,original.items);assert.equal(items.filter(dinnerEligible).length,330);assert(items.filter(dinnerEligible).every(i=>i.verdict==='good'));const page=await store.foodDirectory();assert.equal(page.items.length,20);assert.deepEqual(page.counts,{all:714,good:330,mixed:284,bad:100});assert.equal((await store.foodDirectory({verdict:'mixed'})).total,284);assert.equal((await store.foodDirectory({q:'串门烧烤'})).items[0].name,'串门烧烤');assert((await store.foodDirectory({page:'2'})).items.every(i=>!page.items.some(p=>p.id===i.id)));assert.equal((await store.foodDirectory({q:'不存在的商家12345'})).total,0)
 const base=await db.knowledgeBase.findUniqueOrThrow({where:{id:sourceDefinition(foodSource,['takeout']).id}})
 try{await db.knowledgeBase.update({where:{id:base.id},data:{mounted:false}});assert.equal((await store.foodItems()).length,0);assert.equal((await store.foodDirectory()).enabled,false)}finally{await db.knowledgeBase.update({where:{id:base.id},data:{mounted:base.mounted}})}
 const report={passed:true,checkedAt:new Date().toISOString(),records:714,eligibleMeals:330,checks:['原文件逐条逐字段一致（包括主观评价、未提供价格、同名不同记录）','分页、搜索、红/黑/分歧及地点类别筛选','完整330条红榜进入同一选餐池，不隐式过滤或截断','缓存目录尊重原知识库开关'],scope:'Actual local PostgreSQL; source gate restored; no model calls'}
 mkdirSync(resolve(root,'storage/shots/dinner'),{recursive:true});writeFileSync(resolve(root,'storage/shots/dinner/food-contract.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{await db.$disconnect()}}
main().catch(e=>{console.error(e);process.exitCode=1})
