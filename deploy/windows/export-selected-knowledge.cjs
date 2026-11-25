'use strict'
const fs = require('node:fs')
const path = require('node:path')

const select = (...keys) => Object.fromEntries(keys.map(key => [key, true]))
const fields = select('id', 'name', 'description', 'kind', 'mounted', 'connection')
const entryFields = select('id', 'baseId', 'externalKey', 'title', 'question', 'questionKey', 'answer', 'summary', 'aliases', 'url', 'mode', 'status', 'priority', 'source')
const guideFields = select('externalId','title','url','cat','type','source','name','dept','place','tel','campus','form','officeTime','contact','login','access','detailStatus','subtype','summaryShort','detail','steps','keyFacts','detailParts','extra','verifiedAt','note','searchText')

async function main() {
  const [installation, output, ...ids] = process.argv.slice(2)
  if (!installation || !output || !ids.length || new Set(ids).size !== ids.length) {
    throw Error('Usage: node export-selected-knowledge.cjs INSTALL_ROOT OUTPUT BASE_ID...')
  }
  const root = path.resolve(installation)
  const runtime = require(path.join(root, 'runtime.cjs'))
  const {PrismaClient, Prisma} = require(path.join(root, 'apps/api/node_modules/@prisma/client'))
  require(path.join(root, 'apps/api/node_modules/reflect-metadata'))
  const {KnowledgeStoreService} = require(path.join(root, 'apps/api/dist/src/knowledge/knowledge-store.service.js'))
  const {embeddedSourceWhere} = require(path.join(root, 'apps/api/dist/src/knowledge/embedded-knowledge.js'))
  const config = runtime.config()
  const db = new PrismaClient({datasourceUrl: runtime.apiEnv(config).DATABASE_URL})
  try {
    const store = new KnowledgeStoreService(db, {})
    const counts = await store.ensureEmbedded()
    const snapshot = await db.$transaction(async tx => {
      const bases = await tx.knowledgeBase.findMany({where:{id:{in:ids},kind:{in:['LOCAL','EMBEDDED']}},select:fields})
      if (bases.length !== ids.length) throw Error('A selected knowledge base is missing or requires a private connection.')
      const ordered = ids.map(id => bases.find(base => base.id === id))
      const entries = await tx.knowledgeEntry.findMany({where:{baseId:{in:ids},status:'APPROVED'},select:entryFields,orderBy:{id:'asc'}})
      const modern = await tx.campusGuideItem.findFirst({where:{externalId:{gte:500000000,lt:900000000}},select:{id:true}})
      const items = []
      const inventory = []
      for (const base of ordered) {
        let total = entries.filter(row => row.baseId === base.id).length
        if (base.kind === 'EMBEDDED') {
          const source = base.connection?.sourceKey
          if (!source || !counts.some(row => row.sourceKey === source)) throw Error('Invalid embedded knowledge base: ' + base.name)
          const rows = await tx.campusGuideItem.findMany({where:{AND:[
            embeddedSourceWhere(source),
            {OR:[{extra:{path:['kb','superseded'],equals:Prisma.AnyNull}},{NOT:{extra:{path:['kb','superseded'],equals:true}}}]},
            ...(modern?[{OR:[{externalId:{lt:2000000}},{externalId:{gte:3000000}}]}]:[]),
          ]},select:guideFields,orderBy:{externalId:'asc'}})
          total = rows.length
          items.push(...rows)
        }
        inventory.push({id:base.id,name:base.name,kind:base.kind,count:total,mounted:base.mounted})
      }
      return {bases:ordered,entries,items,inventory}
    }, {isolationLevel:'RepeatableRead',timeout:90000})
    const origin = new URL(config.siteOrigin).origin
    fs.writeFileSync(output, JSON.stringify(snapshot).replaceAll(origin, '{{SITE_ORIGIN}}'), {flag:'wx'})
    for (const row of snapshot.inventory) console.log(`${row.name}: ${row.count} (${row.mounted?'on':'off'})`)
  } finally {
    await db.$disconnect()
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
