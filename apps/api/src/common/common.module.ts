import { Global, Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { CryptoService } from "./services/crypto.service"
import { AuditService } from "./services/audit.service"
import { QuotaService } from "./services/quota.service"
import { PrismaModule } from "../prisma/prisma.module"

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"]
    }),
    PrismaModule
  ],
  providers: [CryptoService, AuditService, QuotaService],
  exports: [CryptoService, AuditService, QuotaService, ConfigModule]
})
export class CommonModule {}