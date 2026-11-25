'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const rt = require('./runtime.cjs')

async function main() {
  if (!fs.existsSync(path.join(rt.data, 'installed.json'))) throw Error('Run Deploy.cmd first')
  const settings = rt.config()
  const host = settings.listenAddress === '0.0.0.0' ? '127.0.0.1' : settings.listenAddress === '::' ? '::1' : settings.listenAddress
  const address = new URL(`http://${host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host}:${settings.webPort}/healthz`)
  async function healthy() {
    try {
      const result = await fetch(address, { signal: AbortSignal.timeout(1500) })
      return result.ok && (await result.json()).service === 'cagent'
    } catch { return false }
  }
  if (!(fs.existsSync(path.join(rt.data, 'runtime.pid')) && await healthy())) {
    const out = fs.openSync(path.join(rt.data, 'runtime.log'), 'a')
    const err = fs.openSync(path.join(rt.data, 'runtime-error.log'), 'a')
    let child, failure
    try {
      child = spawn(process.execPath, [path.join(rt.root, 'run.cjs')], {
        cwd: rt.root, detached: true, windowsHide: true, stdio: ['ignore', out, err],
      })
      child.once('error', error => { failure = error })
      child.unref()
    } finally { fs.closeSync(out); fs.closeSync(err) }
    await rt.waitFor(async () => {
      if (failure) throw failure
      if (child.exitCode !== null) throw Error('CAgent exited; review data/runtime-error.log and data/api.log')
      return healthy()
    }, 'CAgent', 65000)
  }
  console.log(`CAgent URL: ${settings.siteOrigin}`)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
