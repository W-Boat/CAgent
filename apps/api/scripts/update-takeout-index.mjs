import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {PrismaClient} from '@prisma/client'
const root=new URL('../../../',import.meta.url),source='社科大外卖红黑榜_RAG.json'
if(existsSync(new URL('.env',root)))for(const line of readFileSync(new URL('.env',root),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const artifact=JSON.parse(readFileSync(process.argv[2]||new URL('knowledge/dist/campus-kb.json',root),'utf8')),items=artifact.items.filter(e=>e.source===source),food=items.filter(e=>e.extra?.food)
assert.equal(new Set(food.map(e=>e.extra.food.id)).size,714);assert(food.every(e=>e.extra.kb.file===source&&e.extra.kb.collection==='takeout'))
const ids=items.map(e=>e.id);assert.equal(new Set(ids).size,ids.length)
const prisma=new PrismaClient(),scope={extra:{path:['kb','file'],equals:source}}
try{
 const existing=await prisma.campusGuideItem.count({where:scope});assert(existing>0,'Expected an existing takeout knowledge source')
 const collisions=await prisma.campusGuideItem.count({where:{externalId:{in:ids},NOT:scope}});assert.equal(collisions,0,'Foreign source ID collision')
 let removed=0
 await prisma.$transaction(async tx=>{
  for(const e of items){const data={title:e.title,url:e.url||'',cat:e.cat,type:e.type,source,summaryShort:e.summary_short,detail:e.detail,detailStatus:e.detail_status,searchText:e.search_text,extra:e.extra,steps:e.steps||[],keyFacts:e.key_facts||[]};await tx.campusGuideItem.upsert({where:{externalId:e.id},create:{externalId:e.id,...data},update:data})}
  removed=(await tx.campusGuideItem.deleteMany({where:{AND:[scope,{externalId:{notIn:ids}}]}})).count
  await tx.setting.upsert({where:{key:'knowledge_revision'},create:{key:'knowledge_revision',group:'campus',value:'takeout-extracted-'+Date.now()},update:{value:'takeout-extracted-'+Date.now()}})
 },{timeout:60000})
 assert.equal(await prisma.campusGuideItem.count({where:scope}),items.length)
 console.log(JSON.stringify({source,importedRecords:714,indexRows:items.length,previousIndexRows:existing,obsoleteRowsRemoved:removed,scope:'Only the existing takeout source; source enable switch and unrelated knowledge retained'}))
}finally{await prisma.$disconnect()}
