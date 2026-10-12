import {readFileSync,existsSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {PrismaClient} from '@prisma/client'
const here=dirname(fileURLToPath(import.meta.url)),env=resolve(here,'../../../.env')
if(existsSync(env))for(const line of readFileSync(env,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const path=resolve(process.argv[2]||resolve(here,'../../../knowledge/dist/campus-v2-contest.json')),data=JSON.parse(readFileSync(path,'utf8')),dataset=data.meta?.dataset
if(dataset?.collection!=='campus-v2-contest'||!data.items?.length||data.items.some(r=>r.extra?.kb?.collection!==dataset.collection||r.extra?.kb?.simulation!==true)||dataset.evaluationImported!==0)throw Error('不是经过审计的校园事务赛事资料')
const id='embedded-'+createHash('sha256').update(dataset.collection).digest('hex').slice(0,24),db=new PrismaClient()
try{
 const connection={collection:dataset.collection,readOnly:true,simulation:true,version:dataset.packageVersion,storage:'SQLite + Markdown',tables:Object.keys(dataset.tables).length,tableCounts:dataset.tables,sqliteRecords:dataset.sqliteRecords,markdownFiles:dataset.markdownFiles,sqliteSha256:dataset.sqliteSha256}
 await db.knowledgeBase.upsert({where:{id},create:{id,name:'校园事务 2.0 · 赛事数据库',kind:'EMBEDDED',mounted:false,description:'包内标注 v2.2；包含 SQLite 八张表及 Markdown 规则，运营记录为赛事模拟数据。',connection},update:{connection}})
 const imported=spawnSync(process.execPath,[resolve(here,'import-campus-guide.mjs'),path,'--keep-meta'],{stdio:'inherit',env:process.env})
 if(imported.status!==0)throw Error('导入失败')
 await db.setting.upsert({where:{key:'embedded_dataset:campus-v2-contest'},create:{key:'embedded_dataset:campus-v2-contest',group:'campus',value:dataset},update:{value:dataset}})
 console.log(JSON.stringify({baseId:id,items:data.items.length,mounted:(await db.knowledgeBase.findUnique({where:{id}})).mounted,dataset},null,2))
}finally{await db.$disconnect()}
