'use strict'
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')
const runtime = require('./runtime.cjs')
const keys = require('./keys.cjs')
const { root, data, api, postgres, configPath, command } = runtime
const loginFile = path.join(data, 'initial-login.txt')
const readyFile = path.join(data, 'installed.json')
const testFile = path.join(data, 'test-accounts.json')
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

async function installTestAccounts(db, actor, settings) {
  const bcrypt = require(path.join(api, 'node_modules/bcryptjs'))
  const roles = [['super_admin','测试超管'],['user','测试学生']]
  const previous = fs.existsSync(testFile) ? JSON.parse(fs.readFileSync(testFile,'utf8')) : []
  const credentials = await Promise.all(roles.map(async ([role,name]) => {
    const password = previous.find(row=>row.role===role)?.password || secret(24)
    const email = role==='super_admin' ? 'bootstrap-admin@testing.cagent.invalid' : 'bootstrap-student@testing.cagent.invalid'
    return {role,name,email,password,passwordHash:await bcrypt.hash(password,10)}
  }))
  const leases = await db.$transaction(async tx => {
    const mode = await tx.setting.upsert({where:{key:'test_accounts_enabled'},create:{key:'test_accounts_enabled',group:'test',value:true},update:{value:true}})
    const issuedAt = Math.max(Date.now(),mode.updatedAt.getTime()), expiresAt = issuedAt + 24 * 3600_000
    for (const row of credentials) {
      const role = await tx.role.findUniqueOrThrow({where:{key:row.role}})
      const member = await tx.user.upsert({where:{email:row.email},
        create:{email:row.email,name:row.name,passwordHash:row.passwordHash,status:'ACTIVE',roles:{create:{roleId:role.id}}},
        update:{name:row.name,passwordHash:row.passwordHash,status:'ACTIVE'},
        include:{roles:true}})
      if (member.roles.length!==1 || member.roles[0].roleId!==role.id) throw Error('Bootstrap test account role was already used for another purpose.')
      const key = 'test_account:'+member.id, value = {issuedAt,expiresAt,role:row.role}
      await tx.setting.upsert({where:{key},create:{key,group:'test-accounts',value},update:{value}})
      await tx.auditLog.create({data:{userId:actor.id,actor:actor.email,action:'auth.test_account.issue',resource:'user',
        resourceId:member.id,detail:{role:row.role,expiresAt:new Date(expiresAt).toISOString()},success:true}})
    }
    return credentials.map(({email,password,role})=>({email,password,role,expiresAt:new Date(expiresAt).toISOString()}))
  })
  fs.writeFileSync(testFile,JSON.stringify(leases))
  settings.installTestAccounts = true
  runtime.writeConfig(settings)
}

async function main() {
  const [webPort, apiPort, dbPort, listenAddress, siteOrigin, adminEmail, ...args] = process.argv.slice(2)
  if (args.length % 2 || args.some((value,index) => index % 2 === 0 && !['--keys','--restore','--test-accounts'].includes(value))) {
    throw Error('Unsupported installation options.')
  }
  const bundles = Object.fromEntries(Array.from({length:args.length/2},(_,index)=>args.slice(index*2,index*2+2)))
  const options = { webPort: Number(webPort), apiPort: Number(apiPort), dbPort: Number(dbPort), listenAddress, siteOrigin, adminEmail }
  const passwords = bundles['--keys'] || bundles['--restore'] ? JSON.parse(keys.passwordFromInput() || '{}') : {}
  const packet = bundles['--keys'] ? keys.open(keys.readJson(bundles['--keys']), passwords.keys || '') : null
  const installed = fs.existsSync(readyFile) ? JSON.parse(fs.readFileSync(readyFile,'utf8')) : null
  require(path.join(api, 'node_modules/reflect-metadata'))
  let restoreFile, restoreDigest
  if (bundles['--restore']) {
    const {backupUploadLimit, openBackup} = require(path.join(api,'dist/src/settings/platform-backup-format.js'))
    if (fs.statSync(bundles['--restore']).size > backupUploadLimit) throw Error('Platform backup exceeds its file size limit.')
    restoreFile = fs.readFileSync(bundles['--restore'])
    restoreDigest = createHash('sha256').update(restoreFile).digest('hex')
    if (installed && installed.restoreDigest !== restoreDigest) {
      throw Error('An existing installation must restore a different backup from Settings, after reviewing the preview.')
    }
    if (!installed) await openBackup(restoreFile, passwords.restore)
  }
  if (installed && !packet) { console.log('Already installed; data and credentials preserved.'); return }
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

    if (!installed) {
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
      const admin = await db.user.findUniqueOrThrow({ where: { email: settings.adminEmail }, select: { id: true, email: true } })
      if (restoreFile) {
        const { PlatformBackupService } = require(path.join(api,'dist/src/settings/platform-backup.service.js'))
        const backup = new PlatformBackupService(db, runtime.cryptoService(settings))
        const actor = {...admin, roles:['super_admin']}
        const preview = await backup.import(restoreFile, passwords.restore, actor)
        const restored = await backup.import(restoreFile, passwords.restore, actor, preview.confirmation)
        console.log('Platform backup restored: '+JSON.stringify(restored.totals))
      } else {
        command(node, [path.join(api, 'scripts/import-campus-profile.mjs'), path.join(root, 'payload/profile'), '--apply'], { env })
        const lectureSnapshot = path.join(root, 'payload/lectures.json')
        if (fs.existsSync(lectureSnapshot)) command(node, [path.join(api, 'scripts/import-lectures.cjs'), lectureSnapshot], { env })
      }
      if (bundles['--test-accounts']==='true') await installTestAccounts(db,admin,settings)
    }
    if (packet) await installKeys(db, settings, packet)
    if (!installed) fs.writeFileSync(readyFile, JSON.stringify({ installedAt: new Date().toISOString(), restoreDigest }))
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
