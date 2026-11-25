'use strict'
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const runtime = require('./runtime.cjs')
const keys = require('./keys.cjs')
const { root, data, api, postgres, configPath, command } = runtime
const loginFile = path.join(data, 'initial-login.txt')
const readyFile = path.join(data, 'installed.json')
const secret = (bytes = 32) => randomBytes(bytes).toString('base64url')

function available(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer().once('error', () => reject(Error(`Address ${host}:${port} is unavailable`)))
    server.listen({ port, host, exclusive: true }, () => server.close(resolve))
  })
}

async function configure(options) {
  if (fs.existsSync(configPath)) return runtime.config()
  const { webPort, apiPort, dbPort, listenAddress, siteOrigin, adminEmail } = options
  if (new Set([webPort, apiPort, dbPort]).size !== 3) throw Error('Web, API and database ports must be different')
  const origin = new URL(siteOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== siteOrigin) throw Error('SiteOrigin must be an HTTP(S) origin')
  await available(webPort, listenAddress)
  await available(apiPort, '127.0.0.1')
  await available(dbPort, '127.0.0.1')
  const settings = { webPort, apiPort, dbPort, listenAddress, siteOrigin, adminEmail, dbPassword: secret(), jwtSecret: secret(), encryptionKey: secret() }
  // Write the same credentials first so an interrupted installation can resume.
  if (!fs.existsSync(loginFile)) {
    fs.writeFileSync(loginFile, `URL=${siteOrigin}\r\nEMAIL=${adminEmail}\r\nPASSWORD=Ca!${secret(18)}\r\n`, { flag: 'wx' })
  }
  runtime.writeConfig(settings)
  return settings
}

function initializeDatabase(settings) {
  if (fs.existsSync(path.join(data, 'postgres/PG_VERSION'))) return
  fs.mkdirSync(path.join(data, 'postgres'), { recursive: true })
  const file = path.join(data, 'db-bootstrap-password')
  try {
    fs.writeFileSync(file, `${settings.dbPassword}\n`)
    command(path.join(postgres, 'initdb.exe'), ['-D', 'postgres', '-U', 'cagent', '-A', 'scram-sha-256', '--pwfile=db-bootstrap-password', '--encoding=UTF8', '--locale=C'])
  } finally { fs.rmSync(file, { force: true }) }
}

async function installKeys(db, settings, packet) {
  const crypto = runtime.cryptoService(settings)
  const count = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(202611245321)::text`
    let imported = 0, skipped = 0
    for (const row of packet.providers) {
      const provider = await tx.provider.findUnique({ where: { key: row.providerKey }, include: { apiKeys: true } })
      if (!provider) throw Error(`Unknown provider identifier: ${row.providerKey}`)
      const plain = row.apiKey.trim()
      if (provider.apiKeys.some(key => crypto.decrypt(key.apiKey) === plain)) { skipped += 1; continue }
      await tx.providerApiKey.create({ data: {
        providerId: provider.id, apiKey: crypto.encrypt(plain), label: row.label?.trim() || null,
        enabled: row.enabled ?? true, sort: provider.apiKeys.length,
      } })
      if (!provider.apiKey && row.enabled !== false) {
        await tx.provider.update({ where: { id: provider.id }, data: { apiKey: crypto.encrypt(plain) } })
      }
      imported += 1
    }
    return { imported, skipped, serviceKeys: Object.keys(packet.environment).length }
  }, { timeout: 45000 })
  settings.serviceKeys ||= {}
  for (const [name, value] of Object.entries(packet.environment)) settings.serviceKeys[name] = crypto.encrypt(value.trim())
  runtime.writeConfig(settings)
  console.log('API key import: ' + JSON.stringify(count))
}

async function main() {
  const [webPort, apiPort, dbPort, listenAddress, siteOrigin, adminEmail, keyBundle] = process.argv.slice(2)
  const options = { webPort: Number(webPort), apiPort: Number(apiPort), dbPort: Number(dbPort), listenAddress, siteOrigin, adminEmail, keyBundle }
  const packet = options.keyBundle ? keys.open(keys.readJson(options.keyBundle), keys.passwordFromInput()) : null
  if (fs.existsSync(readyFile) && !packet) { console.log('Already installed; data and credentials preserved.'); return }
  const active = path.join(data, 'runtime.pid')
  if (fs.existsSync(active)) {
    try { process.kill(Number(fs.readFileSync(active, 'utf8')), 0) }
    catch (error) { if (error.code === 'ESRCH') fs.unlinkSync(active); else throw error }
    if (fs.existsSync(active)) throw Error('Stop the running deployment before importing API keys.')
  }
  const lock = path.join(data, 'install.lock')
  const descriptor = fs.openSync(lock, 'wx')
  let child, db
  try {
    const settings = await configure(options)
    await available(settings.dbPort, '127.0.0.1')
    initializeDatabase(settings)
    child = runtime.startDatabase(settings)
    await runtime.waitForDatabase(settings, child)
    const env = runtime.apiEnv(settings)
    Object.assign(process.env, env)
    const { PrismaClient } = require(path.join(api, 'node_modules/@prisma/client'))
    db = new PrismaClient()

    if (!fs.existsSync(readyFile)) {
      const psql = path.join(postgres, 'psql.exe')
      const dbEnv = { ...env, PGPASSWORD: settings.dbPassword }
      const result = require('node:child_process').spawnSync(psql, ['-X', '-h', '127.0.0.1', '-p', String(settings.dbPort), '-U', 'cagent', '-d', 'postgres', '-Atc', "SELECT 1 FROM pg_database WHERE datname='cagent'"], { env: dbEnv, encoding: 'utf8', windowsHide: true })
      if (result.error || result.status !== 0) throw Error('Unable to check the deployment database')
      if (result.stdout.trim() !== '1') command(path.join(postgres, 'createdb.exe'), ['-h', '127.0.0.1', '-p', String(settings.dbPort), '-U', 'cagent', 'cagent'], { env: dbEnv })
      const node = process.execPath
      command(node, [path.join(api, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', path.join(api, 'prisma/schema.prisma')], { cwd: api, env })
      const password = fs.readFileSync(loginFile, 'utf8').match(/^PASSWORD=(.+)\r?$/m)?.[1].trim()
      if (!password) throw Error('Missing bootstrap credentials in data/initial-login.txt')
      command(node, [path.join(api, 'dist/prisma/seed.js')], { env: { ...env, SEED_ADMIN_EMAIL: settings.adminEmail, SEED_ADMIN_PASSWORD: password, SEED_DEMO_USERS: 'false' } })
      command(node, [path.join(api, 'scripts/import-campus-profile.mjs'), path.join(root, 'payload/profile'), '--apply'], { env })
      const lectureSnapshot = path.join(root, 'payload/lectures.json')
      if (fs.existsSync(lectureSnapshot)) command(node, [path.join(api, 'scripts/import-lectures.cjs'), lectureSnapshot], { env })
      require(path.join(api, 'node_modules/reflect-metadata'))
      const { StudentPortalService } = require(path.join(api, 'dist/src/campus/student-portal.service.js'))
      const { KnowledgeStoreService } = require(path.join(api, 'dist/src/knowledge/knowledge-store.service.js'))
      const { LECTURE_BASE } = require(path.join(api, 'dist/src/lectures/lectures.service.js'))
      const admin = await db.user.findUniqueOrThrow({ where: { email: settings.adminEmail }, select: { id: true, email: true } })
      const catalogues = ['kb-ucass-portal-fusion-2026', 'kb-ucass-portal-services-2026', 'kb-ucass-information-services-2026']
      await db.knowledgeBase.updateMany({ where: { id: { in: [...catalogues, LECTURE_BASE] }, kind: { not: 'REMOVED' } }, data: { mounted: true } })
      const selection = JSON.parse(fs.readFileSync(path.join(root, 'payload/profile/manifest.json'), 'utf8')).selectedKnowledge
      if (!selection || selection.some(base => base.id === 'kb-ucass-portal-navigation')) {
        const navigation = await new StudentPortalService(db, undefined, new KnowledgeStoreService(db, {})).installNavigation(admin)
        console.log('Portal navigation: ' + JSON.stringify(navigation))
      }
      fs.writeFileSync(readyFile, JSON.stringify({ installedAt: new Date().toISOString() }))
    }
    if (packet) await installKeys(db, settings, packet)
  } finally {
    try { await db?.$disconnect() } finally {
      runtime.stopDatabase(child)
      fs.closeSync(descriptor)
      fs.unlinkSync(lock)
    }
  }
}

main().catch(error => {
  console.error(error.message.replace(/postgresql:\/\/[^\s"']+/g, 'postgresql://[redacted]'))
  process.exitCode = 1
})
