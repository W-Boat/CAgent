import { Module } from '@nestjs/common'
import { SettingsModule } from '../settings/settings.module'
import { ProvidersModule } from '../providers/providers.module'
import { ExperienceController } from './experience.controller'
import { TestAccounts } from './test-accounts'
import { VoiceService } from './voice.service'

@Module({
  imports: [SettingsModule, ProvidersModule],
  controllers: [ExperienceController],
  providers: [VoiceService, TestAccounts],
  exports: [TestAccounts],
})
export class ExperienceModule {}
