'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')

const root = __dirname
const data = path.join(root, 'data')
const api = path.join(root, 'apps/api')
const web = path.join(root, 'apps/web/dist')
const postgres = path.join(root, 'runtime/pgsql/bin')
const configPath = path.join(data, 'config.json')
const config = () => JSON.parse(fs.readFileSync(configPath, 'utf8'))

function apiEnv(settings) {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (/_API_KEY$/i.test(name) || /^(?:SEED_|PROFILE_PROVIDER_)/i.test(name)) delete env[name]
  }
  return {
    ...env,
    ...Object.fromEntries(Object.entries(settings.serviceKeys || {}).map(([name, encrypted]) => [name, cryptoService(settings).decrypt(encrypted)])),
    NODE_ENV: 'production', API_HOST: '127.0.0.1', API_PREFIX: 'api', ENABLE_DOCS: 'false',
    API_PORT: String(settings.apiPort), WEB_ORIGIN: settings.siteOrigin, SITE_ORIGIN: settings.siteOrigin,
    CAGENT_MAP_ASSETS_DIR: path.join(web, 'maps'),
    DATABASE_URL: `postgresql://cagent:${settings.dbPassword}@127.0.0.1:${settings.dbPort}/cagent`,
    DIRECT_URL: `postgresql://cagent:${settings.dbPassword}@127.0.0.1:${settings.dbPort}/cagent`,
    JWT_SECRET: settings.jwtSecret, ENCRYPTION_KEY: settings.encryptionKey,
  }
}

function cryptoService(settings) {
  require(path.join(api, 'node_modules/reflect-metadata'))
  const { CryptoService } = require(path.join(api, 'dist/src/common/services/crypto.service.js'))
  return new CryptoService({ get: name => name === 'ENCRYPTION_KEY' ? settings.encryptionKey : undefined })
}

function command(exe, args, { cwd = data, env = process.env, input, quiet = false } = {}) {
  const result = spawnSync(exe, args, { cwd, env, input, stdio: [input ? 'pipe' : 'ignore', quiet ? 'pipe' : 'inherit', quiet ? 'pipe' : 'inherit'], windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw Error(`${path.basename(exe)} ${args[0] || ''} exited with code ${result.status}`)
}

function startDatabase(settings) {
  const log = fs.openSync(path.join(data, 'postgres.log'), 'a')
  try {
    return spawn(path.join(postgres, 'postgres.exe'), ['-D', 'postgres', '-h', '127.0.0.1', '-p', String(settings.dbPort)], {
      cwd: data, windowsHide: true, stdio: ['ignore', log, log],
    })
  } finally { fs.closeSync(log) }
}

function stopDatabase(child) {
  if (!child?.pid || child.exitCode !== null) return
  try { command(path.join(postgres, 'pg_ctl.exe'), ['stop', '-D', 'postgres', '-m', 'fast', '-w', '-t', '20'], { quiet: true }) }
  catch { child.kill() }
}

async function waitFor(check, description, milliseconds = 45000) {
  const end = Date.now() + milliseconds
  while (Date.now() < end) {
    if (await check()) return
    await delay(400)
  }
  throw Error(`${description} did not become ready`)
}

async function waitForDatabase(settings, child) {
  let spawnError
  child.once('error', error => { spawnError = error })
  await waitFor(() => {
    if (spawnError) throw spawnError
    if (child.exitCode !== null) throw Error('PostgreSQL exited; check data/postgres.log')
    const result = spawnSync(path.join(postgres, 'pg_isready.exe'), ['-h', '127.0.0.1', '-p', String(settings.dbPort), '-t', '1'], {
      cwd: data, stdio: 'ignore', windowsHide: true,
    })
    if (result.error) throw result.error
    return result.status === 0
  }, 'PostgreSQL')
}

function writeConfig(settings) {
  const temporary = `${configPath}.new`
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2))
  fs.renameSync(temporary, configPath)
}

module.exports = { root, data, api, web, postgres, config, configPath, writeConfig, apiEnv, cryptoService, command, startDatabase, stopDatabase, waitForDatabase, waitFor }
