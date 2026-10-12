import { Injectable } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto"

/**
 * 密钥与哈希工具：
 *  - API Key 用 AES-256-GCM 加密后入库，避免明文落盘
 *  - 主密钥由 JWT_SECRET 派生（生产环境应改为独立环境变量）
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer

  constructor(private readonly config: ConfigService) {
    const secret =
      this.config.get<string>("ENCRYPTION_KEY") ||
      this.config.get<string>("JWT_SECRET") ||
      "cagent-insecure-default-key"
    // scrypt 派生固定长度密钥
    this.key = scryptSync(secret, "cagent-api-key-salt", 32)
  }

  encrypt(plain: string): string {
    if (!plain) return ""
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", this.key, iv)
    const encrypted = Buffer.concat([
      cipher.update(plain, "utf8"),
      cipher.final()
    ])
    const tag = cipher.getAuthTag()
    return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`
  }

  decrypt(payload: string | null | undefined): string {
    if (!payload) return ""
    if (!payload.startsWith("v1:")) return payload // 兼容历史明文
    try {
      const [, ivB64, tagB64, dataB64] = payload.split(":")
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(ivB64, "base64")
      )
      decipher.setAuthTag(Buffer.from(tagB64, "base64"))
      return Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64")),
        decipher.final()
      ]).toString("utf8")
    } catch {
      return ""
    }
  }

  /** 展示用掩码，永不回传明文 */
  mask(plain: string | null | undefined): string {
    const value = this.decrypt(plain)
    if (!value) return ""
    if (value.length <= 8) return "*".repeat(value.length)
    return `${value.slice(0, 4)}${"*".repeat(8)}${value.slice(-4)}`
  }

  sha256(input: string): string {
    return createHash("sha256").update(input).digest("hex")
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString("hex")
  }

  safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  }
}