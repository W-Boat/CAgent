import { BadRequestException } from '@nestjs/common'
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import { gzip, gunzip } from 'node:zlib'

const derive = promisify(scrypt)
const signature = Buffer.from('CAGENT-BACKUP-1\n')
const headerSize = signature.length + 16 + 12 + 16
export const backupUploadLimit = 64 * 1024 * 1024
const unpackedLimit = 192 * 1024 * 1024

function checkPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new BadRequestException('备份口令须为 12–256 个字符')
  }
}

export async function sealBackup(payload: unknown, password: unknown) {
  checkPassword(password)
  const plain = Buffer.from(JSON.stringify(payload))
  if (plain.length > unpackedLimit) throw new BadRequestException('当前资料量超过单包上限')
  const [compressed, salt, iv] = await Promise.all([promisify(gzip)(plain), randomBytes(16), randomBytes(12)])
  if (compressed.length + headerSize > backupUploadLimit) throw new BadRequestException('压缩后仍超过单包上限')
  const key = await derive(password, salt, 32) as Buffer
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(signature)
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()])
  return Buffer.concat([signature, salt, iv, cipher.getAuthTag(), encrypted])
}

export async function openBackup(bytes: Buffer | undefined, password: unknown): Promise<unknown> {
  checkPassword(password)
  if (!bytes || bytes.length <= headerSize || bytes.length > backupUploadLimit || !bytes.subarray(0, signature.length).equals(signature)) {
    throw new BadRequestException('请选择有效的 CAgent 备份包（最大 64 MB）')
  }
  const start = signature.length
  try {
    const key = await derive(password, bytes.subarray(start, start + 16), 32) as Buffer
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(start + 16, start + 28))
    decipher.setAAD(signature)
    decipher.setAuthTag(bytes.subarray(start + 28, headerSize))
    const compressed = Buffer.concat([decipher.update(bytes.subarray(headerSize)), decipher.final()])
    const plain = await promisify(gunzip)(compressed, { maxOutputLength: unpackedLimit })
    return JSON.parse(plain.toString('utf8'))
  } catch {
    throw new BadRequestException('备份口令不正确，或文件已损坏')
  }
}
