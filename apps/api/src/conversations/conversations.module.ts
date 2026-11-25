import { Module } from "@nestjs/common"
import { ConversationsService } from "./conversations.service"
import { ConversationsController } from "./conversations.controller"
import { SettingsModule } from '../settings/settings.module'

@Module({
  imports: [SettingsModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService]
})
export class ConversationsModule {}
