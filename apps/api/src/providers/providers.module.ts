import { Module } from "@nestjs/common"
import { ProvidersService } from "./providers.service"
import { ProviderKeyService } from "./provider-key.service"
import { ProvidersController } from "./providers.controller"

@Module({
  controllers: [ProvidersController],
  providers: [ProvidersService, ProviderKeyService],
  exports: [ProvidersService, ProviderKeyService]
})
export class ProvidersModule {}
