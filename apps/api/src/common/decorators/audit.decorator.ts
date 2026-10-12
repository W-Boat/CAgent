import { SetMetadata } from "@nestjs/common"

export const AUDIT_KEY = "audit"

export interface AuditMeta {
  action: string
  resource: string
  /** 从 params / body 中取资源 id 的字段名 */
  resourceIdFrom?: string
}

/** 声明该操作需要写入审计日志 */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta)