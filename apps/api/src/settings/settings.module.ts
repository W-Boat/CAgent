import { Module } from "@nestjs/common"
import { SettingsService } from "./settings.service"
import { SettingsController } from "./settings.controller"
import { PlatformBackupController } from './platform-backup.controller'
import { PlatformBackupService } from './platform-backup.service'

@Module({
  controllers: [SettingsController, PlatformBackupController],
  providers: [SettingsService, PlatformBackupService],
  exports: [SettingsService]
})
export class SettingsModule {}
