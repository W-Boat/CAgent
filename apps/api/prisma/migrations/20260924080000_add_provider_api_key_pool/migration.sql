-- 供应商多 Key 池：轮询分摊配额 + 失效自动切换。
--
-- 一个供应商可配置多把 Key，请求时按「健康 + 最久未使用」挑选：
--   - 轮询分摊，避免单 Key 被限流
--   - 某把 Key 401/403 或限流时自动切到其他 Key，服务不中断
--
-- Provider.api_key 旧字段保留用于兼容单 Key 场景；Key 池有记录时以池为准。

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'COOLDOWN', 'INVALID', 'DISABLED');

-- CreateTable
CREATE TABLE "provider_api_keys" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "label" TEXT,
    "api_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error" TEXT,
    "cooldown_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_api_keys_provider_id_status_idx" ON "provider_api_keys"("provider_id", "status");

-- AddForeignKey
ALTER TABLE "provider_api_keys" ADD CONSTRAINT "provider_api_keys_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
