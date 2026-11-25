'use strict'
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')
const rt = require('./runtime.cjs')

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
}

function proxy(request, response, settings) {
  const upstream = http.request({
    hostname: '127.0.0.1', port: settings.apiPort, method: request.method, path: request.url, headers: request.headers,
  }, incoming => {
    response.writeHead(incoming.statusCode, incoming.headers)
    response.flushHeaders()
    incoming.on('error', () => response.destroy())
    incoming.pipe(response)
  })
  upstream.on('error', () => {
    if (response.headersSent) response.destroy()
    else response.writeHead(502, { 'Content-Type': 'application/json' }).end('{"message":"CAgent API is unavailable"}')
  })
  response.on('close', () => { if (!response.writableFinished) upstream.destroy() })
  request.pipe(upstream)
}

async function asset(request, response, url) {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return }
  const parts = url.split('/').filter(Boolean)
  if (parts.some(part => part.startsWith('.') || /[:\\\0]/.test(part))) { response.writeHead(404).end(); return }
  let filename = path.join(rt.web, ...parts)
  let stat = await fs.promises.stat(filename).catch(() => null)
  if (!stat?.isFile()) {
    if (path.extname(url)) { response.writeHead(404).end(); return }
    filename = path.join(rt.web, 'index.html')
    stat = await fs.promises.stat(filename)
  }
  const type = path.extname(filename)
  response.writeHead(200, {
    'Content-Type': mime[type] || 'application/octet-stream', 'Content-Length': stat.size,
    'Cache-Control': url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') response.end()
  else fs.createReadStream(filename).on('error', () => response.destroy()).pipe(response)
}

async function main() {
  const settings = rt.config()
  const pid = path.join(rt.data, 'runtime.pid'), stop = path.join(rt.data, 'stop.request')
  if (!fs.existsSync(path.join(rt.data, 'installed.json'))) throw Error('Run Install.ps1 first')
  if (fs.existsSync(pid)) {
    try { process.kill(Number(fs.readFileSync(pid, 'utf8')), 0) }
    catch (error) { if (error.code === 'ESRCH') fs.unlinkSync(pid); else throw error }
  }
  fs.writeFileSync(pid, String(process.pid), { flag: 'wx' })
  fs.rmSync(stop, { force: true })
  let database, api, server, timer, stopping = false
  const shutdown = (error) => {
    if (stopping) return
    stopping = true
    if (error) { console.error(error.message); process.exitCode = 1 }
    clearInterval(timer)
    server?.close()
    server?.closeAllConnections()
    api?.kill()
    rt.stopDatabase(database)
    fs.rmSync(stop, { force: true })
    fs.rmSync(pid, { force: true })
  }
  try {
    database = rt.startDatabase(settings)
    await rt.waitForDatabase(settings, database)
    database.once('exit', () => shutdown(Error('PostgreSQL stopped unexpectedly')))
    const log = fs.openSync(path.join(rt.data, 'api.log'), 'a')
    try {
      api = spawn(process.execPath, [path.join(rt.api, 'dist/src/main.js')], {
        cwd: rt.data, env: rt.apiEnv(settings), windowsHide: true, stdio: ['ignore', log, log],
      })
    } finally { fs.closeSync(log) }
    api.once('error', shutdown)
    api.once('exit', () => shutdown(Error('CAgent API stopped unexpectedly; check data/api.log')))
    await rt.waitFor(async () => {
      if (stopping) throw Error('CAgent API startup interrupted')
      try {
        const response = await fetch(`http://127.0.0.1:${settings.apiPort}/api/campus/shortcuts`, { signal: AbortSignal.timeout(1500) })
        return response.ok
      } catch { return false }
    }, 'CAgent API')
    server = http.createServer(async (request, response) => {
      const rawPath = request.url.split('?')[0]
      if (/^\/(?:api|static)(?:\/|$)/.test(rawPath)) { proxy(request, response, settings); return }
      try {
        if (rawPath === '/healthz') { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"status":"ready","service":"cagent"}'); return }
        await asset(request, response, decodeURIComponent(rawPath))
      } catch { if (response.headersSent) response.destroy(); else response.writeHead(400).end() }
    })
    server.once('error', shutdown)
    server.listen(settings.webPort, settings.listenAddress, () => console.log(`CAgent ready at ${settings.siteOrigin}`))
    timer = setInterval(() => { if (fs.existsSync(stop)) shutdown() }, 500)
    process.once('SIGINT', () => shutdown())
    process.once('SIGTERM', () => shutdown())
  } catch (error) { shutdown(error) }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
