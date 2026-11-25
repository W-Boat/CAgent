'use strict'
const { createCipheriv, createDecipheriv, randomBytes, scryptSync } = require('node:crypto')
const { readFileSync, writeFileSync } = require('node:fs')

const serviceKeys = new Set(['DEEPSEEK_SEARCH_API_KEY', 'DEEPSEEK_VOICE_API_KEY', 'TAVILY_API_KEY'])
const readJson = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const format = 'cagent-api-keys-v1'
const kdf = (password, salt) => scryptSync(password, salt, 32, { N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 })

function validate(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw Error('Invalid key list')
  const { providers = [], environment = {} } = packet
  if (!Array.isArray(providers) || providers.length > 1000 || !environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw Error('Invalid key list')
  }
  const clean = (value, max) => typeof value === 'string' && value.length <= max && !/[\r\n\0]/.test(value)
  for (const row of providers) {
    if (!row || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.providerKey || '') || !clean(row.apiKey, 400) || !row.apiKey.trim()
      || (row.label !== undefined && !clean(row.label, 120)) || (row.enabled !== undefined && typeof row.enabled !== 'boolean')) {
      throw Error('Invalid provider key entry')
    }
  }
  for (const [name, value] of Object.entries(environment)) {
    if (!serviceKeys.has(name) || !clean(value, 400) || !value.trim()) throw Error('Invalid service key entry')
  }
  if (!providers.length && !Object.keys(environment).length) throw Error('The key list is empty')
  return { providers, environment }
}

function seal(packet, password) {
  packet = validate(packet)
  if (password.length < 12) throw Error('The transfer passphrase must contain at least 12 characters')
  const salt = randomBytes(16), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', kdf(password, salt), iv)
  cipher.setAAD(Buffer.from(format))
  const body = Buffer.concat([cipher.update(JSON.stringify(packet), 'utf8'), cipher.final()])
  return { format, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') }
}

function open(packet, password) {
  if (packet.format !== format || typeof packet.body !== 'string' || packet.body.length > 1500000) throw Error('Unsupported key bundle')
  let plaintext
  try {
    const decipher = createDecipheriv('aes-256-gcm', kdf(password, Buffer.from(packet.salt, 'base64')), Buffer.from(packet.iv, 'base64'))
    decipher.setAAD(Buffer.from(format))
    decipher.setAuthTag(Buffer.from(packet.tag, 'base64'))
    plaintext = Buffer.concat([decipher.update(Buffer.from(packet.body, 'base64')), decipher.final()])
  } catch {
    throw Error('Key bundle could not be decrypted. Verify the transfer passphrase and file.')
  }
  try { return validate(JSON.parse(plaintext.toString('utf8'))) } finally { plaintext.fill(0) }
}

function passwordFromInput() {
  return readFileSync(0, 'utf8').replace(/^\uFEFF/, '').replace(/\r?\n$/, '')
}

if (require.main === module) {
  try {
    const [source, destination] = process.argv.slice(2)
    if (!source || !destination) throw Error('Usage: keys.cjs source.json destination.cagent-keys')
    writeFileSync(destination, JSON.stringify(seal(readJson(source), passwordFromInput())), { flag: 'wx' })
    console.log('Encrypted API key bundle created.')
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Invalid JSON in key list' : error.message)
    process.exitCode = 1
  }
}

module.exports = { readJson, passwordFromInput, open }
