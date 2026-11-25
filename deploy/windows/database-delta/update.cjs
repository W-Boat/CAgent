'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { gunzipSync } = require('node:zlib')
const { parseEnv } = require('node:util')

const hash = value => createHash('sha256').update(value).digest('hex')
const sourceFor = row => row.deltaSource || row.extra?.kb?.collection
const isLecture = row => row.extra?.kb?.collection === 'lectures'
const entriesFor = (payload, source) => payload.portable ? payload.entries.filter(row => row.baseId === source.id) : payload.entries
const comparableUrl = value => {
  try { const url = new URL(value); url.hash = ''; return url.href } catch { return '' }
}

function loadDelta(directory = __dirname) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  const archive = fs.readFileSync(path.join(directory, 'delta.json.gz'))
  if (!['cagent-database-delta-v1','cagent-database-delta-v2'].includes(manifest.format) || hash(archive) !== manifest.sha256) throw Error('The database delta failed its integrity check.')
  const payload = JSON.parse(gunzipSync(archive, { maxOutputLength: 120 * 1024 * 1024 }).toString('utf8'))
  payload.portable = manifest.format === 'cagent-database-delta-v2'
  const counts = Object.fromEntries(payload.sources.map(source => [source.key,
    source.kind === 'LOCAL' ? entriesFor(payload, source).length : payload.guide.filter(row => sourceFor(row) === source.key).length]))
  const entryIdentities = payload.entries.map(row => `${row.baseId || ''}:${row.questionKey}`)
  const sourceKeys = new Set(payload.sources.map(source => source.key))
  if (JSON.stringify(counts) !== JSON.stringify(manifest.counts) || new Set(payload.guide.map(row => row.externalId)).size !== payload.guide.length ||
      sourceKeys.size !== payload.sources.length || new Set(entryIdentities).size !== payload.entries.length ||
      payload.guide.some(row => !sourceKeys.has(sourceFor(row))) ||
      payload.portable && payload.entries.some(row => !payload.sources.some(source => source.kind === 'LOCAL' && source.id === row.baseId))) {
    throw Error('The database delta has inconsistent record counts or identities.')
  }
  return { ...payload, counts, fingerprint: manifest.sha256 }
}

function selectDelta(payload, ids) {
  if (!ids.length) return payload
  const chosen = new Set(ids)
  if ([...chosen].some(id => !Object.hasOwn(payload.counts,id))) throw Error('A selected knowledge base is not in the package.')
  const sources = payload.sources.filter(source => chosen.has(source.key))
  const guide = payload.guide.filter(row => chosen.has(sourceFor(row)))
  const entries = sources.filter(source => source.kind === 'LOCAL').flatMap(source => entriesFor(payload, source))
  return {...payload, sources, guide, entries}
}

async function planDelta(tx, payload) {
  const bases = [], guide = [], entries = [], counts = {}
  const liveBases = await tx.knowledgeBase.findMany({ select: { id: true, kind: true, connection: true } })
  const existing = await tx.campusGuideItem.findMany({where:{externalId:{in:payload.guide.map(row=>row.externalId)}},select:{externalId:true}})
  const liveLectures = payload.guide.some(isLecture) ? await tx.campusGuideItem.findMany({
    where:{extra:{path:['kb','collection'],equals:'lectures'}},select:{url:true,extra:true},
  }) : []
  const externalIds = new Set(existing.map(row => row.externalId))
  const lectureUrls = new Set(liveLectures.map(row => comparableUrl(row.url)).filter(Boolean))
  const lectureIds = new Set(liveLectures.map(row => row.extra?.lecture?.id).filter(Boolean))
  const sourceState = []

  for (const source of payload.sources) {
    const candidates = source.kind === 'LOCAL' ? entriesFor(payload, source) : payload.guide.filter(row => sourceFor(row) === source.key)
    const matches = liveBases.filter(base => base.id === source.id || source.kind === 'EMBEDDED' && base.connection?.sourceKey === source.connection.sourceKey)
    // A removed source or conflicting registration is left completely alone.
    if (matches.length > 1 || matches.some(base => base.kind !== source.kind)) {
      counts[source.key] = { total: candidates.length, add: 0, exists: 0, blocked: candidates.length, newBase: false }
      sourceState.push([source.key, 'blocked', matches.map(base => [base.id, base.kind]).sort()])
      continue
    }
    const base = matches[0], baseId = base?.id ?? source.id
    let missing
    if (source.kind === 'LOCAL') {
      const known = base ? await tx.knowledgeEntry.findMany({ where: { baseId }, select: { questionKey: true, externalKey: true } }) : []
      const questions = new Set(known.map(row => row.questionKey)), external = new Set(known.map(row => row.externalKey))
      missing = candidates.filter(row => !questions.has(row.questionKey) && (!row.externalKey || !external.has(row.externalKey)))
      entries.push(...missing.map(row => ({ ...row, baseId })))
    } else {
      missing = candidates.filter(row => !externalIds.has(row.externalId) && (!isLecture(row) ||
        !lectureIds.has(row.extra?.lecture?.id) && !lectureUrls.has(comparableUrl(row.url))))
      guide.push(...missing)
    }
    if (!base && candidates.length) {
      const { key, ...data } = source
      bases.push(data)
    }
    counts[source.key] = { total: candidates.length, add: missing.length, exists: candidates.length - missing.length, blocked: 0, newBase: !base && !!candidates.length }
    sourceState.push([source.key, baseId, base?.kind ?? null])
  }
  const token = hash(JSON.stringify([payload.fingerprint, sourceState, guide.map(row => row.externalId), entries.map(row => [row.baseId, row.externalKey])]))
  return { counts, token, bases, guide, entries }
}

async function runDelta(db, payload, confirmation) {
  return db.$transaction(async tx => {
    if (confirmation !== undefined) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(202611247040)::text`
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(714020261029)::text`
    }
    const plan = await planDelta(tx, payload)
    const report = { counts: plan.counts, token: plan.token, bases: plan.bases.length, rows: plan.entries.length + plan.guide.length }
    if (confirmation === undefined) return report
    if (plan.token !== confirmation) throw Error('The target changed after preview. Run the update again to see the new plan.')
    // These are the only writes. No schema commands, settings writes, updates or deletes.
    const insert = async (table, rows) => {
      let written = 0
      for (let i = 0; i < rows.length; i += 150) written += (await table.createMany({ data: rows.slice(i, i + 150), skipDuplicates: true })).count
      if (written !== rows.length) throw Error('A conflicting record appeared. The entire import was rolled back; preview again.')
      return written
    }
    const bases = await insert(tx.knowledgeBase, plan.bases)
    const entries = await insert(tx.knowledgeEntry, plan.entries)
    const guide = await insert(tx.campusGuideItem, plan.guide.map(row =>
      Object.fromEntries(Object.entries(row).filter(([key, value]) => key !== 'deltaSource' && (value !== null || !['steps', 'keyFacts', 'detailParts', 'extra'].includes(key))))))
    return { ...report, inserted: { bases, entries, guide } }
  }, { isolationLevel: confirmation === undefined ? 'RepeatableRead' : 'Serializable', timeout: 90000, maxWait: 10000 })
}

async function main() {
  const [installRoot, mode, ...rest] = process.argv.slice(2)
  const payload = loadDelta()
  if (installRoot === '--list') {
    console.log(JSON.stringify(payload.sources.map(source=>({id:source.key,name:source.name,count:payload.counts[source.key]}))))
    return
  }
  const token = mode === '--apply' ? rest.shift() : undefined
  if (!installRoot || !['--preview', '--apply'].includes(mode) || mode === '--apply' && !/^[a-f0-9]{64}$/.test(token || '')) {
    throw Error('Run Update-Database.cmd to select an installation and preview missing data.')
  }
  const root = path.resolve(installRoot)
  const configFile = path.join(root, 'data/config.json')
  let url, siteOrigin
  if (fs.existsSync(configFile)) {
    const data = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    if (!Number.isInteger(data.dbPort) || data.dbPort < 1 || data.dbPort > 65535 || typeof data.dbPassword !== 'string' || !data.dbPassword) {
      throw Error('The Windows installation does not contain a usable local database configuration.')
    }
    url = new URL('postgresql://cagent@127.0.0.1/cagent')
    url.port = String(data.dbPort)
    url.password = encodeURIComponent(data.dbPassword)
    siteOrigin = data.siteOrigin
  } else {
    const envFile = path.join(root, '.env')
    const env = parseEnv(fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, ''))
    siteOrigin = env.SITE_ORIGIN || env.WEB_ORIGIN?.split(',')[0]
    try { url = new URL(env.DATABASE_URL) } catch { throw Error('The installation .env does not contain a usable DATABASE_URL.') }
    if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
      throw Error('The installation must use a PostgreSQL database.')
    }
  }
  const { PrismaClient } = require(path.join(root, 'apps/api/node_modules/@prisma/client'))
  const db = new PrismaClient({ datasourceUrl: url.href })
  try {
    const selected = selectDelta(payload,rest)
    if (selected.portable) {
      const origin = new URL(siteOrigin || 'http://localhost:8080')
      if (!['http:','https:'].includes(origin.protocol) || origin.username || origin.password) throw Error('Invalid installation site origin.')
      selected.guide = JSON.parse(JSON.stringify(selected.guide).replaceAll('{{SITE_ORIGIN}}',origin.origin))
      selected.entries = JSON.parse(JSON.stringify(selected.entries).replaceAll('{{SITE_ORIGIN}}',origin.origin))
      selected.fingerprint = hash(JSON.stringify([selected.fingerprint,origin.origin]))
    }
    console.log(JSON.stringify(await runDelta(db, selected, token)))
  }
  finally { await db.$disconnect() }
}

if (require.main === module) main().catch(error => {
  if (error?.code === 'P2034') console.error('The target changed during import. Run the preview again.')
  else if (error?.code === 'P1001' || error?.name === 'PrismaClientInitializationError') console.error('Could not connect to the installed database. Start CAgent and check the chosen installation directory.')
  else if (error?.code || error?.name?.startsWith('Prisma')) console.error('The database could not accept this delta. Check the installation and database version. No incomplete transaction was committed.')
  else console.error(error.message)
  process.exitCode = 1
})
module.exports = { loadDelta, runDelta, selectDelta }
