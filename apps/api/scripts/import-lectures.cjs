// Explicit, incremental seed/import. Never called automatically on API startup.
require('reflect-metadata')
const fs=require('node:fs'),path=require('node:path')
if(!process.env.DATABASE_URL){
 const env=path.resolve(__dirname,'../../../.env')
 if(fs.existsSync(env)){const match=fs.readFileSync(env,'utf8').match(/^DATABASE_URL\s*=\s*["']?([^\r\n"']+)/m);if(match)process.env.DATABASE_URL=match[1].trim()}
}
const {PrismaService}=require('../dist/src/prisma/prisma.service')
const {KnowledgeStoreService}=require('../dist/src/knowledge/knowledge-store.service')
const {LecturesService}=require('../dist/src/lectures/lectures.service')
const file=path.resolve(process.argv[2]||path.resolve(__dirname,'../../../knowledge/lectures/lectures.json'))
const packet=JSON.parse(fs.readFileSync(file,'utf8')),records=Array.isArray(packet)?packet:packet.lectures
if(!Array.isArray(records)||!records.length||records.length>10000)throw new Error('Expected 1–10000 lecture records')
const db=new PrismaService(),store=new KnowledgeStoreService(db,{}),service=new LecturesService(db,store)
;(async()=>{
 const result={created:0,changed:0,skipped:0,total:records.length}
 for(let i=0;i<records.length;i+=100){const batch=await service.importRecords(records.slice(i,i+100));for(const k of ['created','changed','skipped'])result[k]+=batch[k]}
 console.log(JSON.stringify(result))
})().catch(e=>{console.error(e.message?.slice(0,300)||'Lecture import failed');process.exitCode=1}).finally(()=>db.$disconnect())
