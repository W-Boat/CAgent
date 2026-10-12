import { Module } from "@nestjs/common"
import { MemoryService } from "./memory.service"
import { MemoryController } from "./memory.controller"
import {SettingsModule} from '../settings/settings.module'

@Module({
  imports:[SettingsModule],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService]
})
export class MemoryModule {}
