import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {PrismaClient} from '@prisma/client'
const root=new URL('../../../',import.meta.url)
if(existsSync(new URL('.env',root)))for(const line of readFileSync(new URL('.env',root),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const artifact=JSON.parse(readFileSync(process.argv[2]||new URL('knowledge/dist/campus-kb.json',root),'utf8')),items=artifact.items.filter(e=>e.source==='campus-maps.json');assert.equal(items.length,58)
const prisma=new PrismaClient();try{const existing=await prisma.campusGuideItem.findMany({where:{externalId:{in:items.map(a=>a.id)}},select:{externalId:true,source:true}});assert.equal(existing.length,58);assert(existing.every(e=>e.source==='campus-maps.json'),'Unexpected original source')
 await prisma.$transaction([...items.map(e=>prisma.campusGuideItem.update({where:{externalId:e.id},data:{summaryShort:e.summary_short,detail:e.detail,searchText:e.search_text,extra:e.extra}})),prisma.setting.upsert({where:{key:'knowledge_revision'},create:{key:'knowledge_revision',value:String(Date.now())},update:{value:String(Date.now())}})])
 const verified=await prisma.campusGuideItem.findMany({where:{externalId:{in:items.map(a=>a.id)}},select:{externalId:true,detail:true,extra:true}});assert(verified.every(e=>e.detail===items.find(i=>i.id===e.externalId).detail));console.log(JSON.stringify({updated:58,source:'campus-maps.json',scope:'Only map descriptions, original map attribution and building aliases; existing IDs and base switches preserved'}))
}finally{await prisma.$disconnect()}
