import { Module } from "@nestjs/common"
import { ChatModule } from "../chat/chat.module"
import { TrialController } from "./trial.controller"
import { TrialService } from "./trial.service"

@Module({
  imports: [ChatModule],
  controllers: [TrialController],
  providers: [TrialService]
})
export class TrialModule {}
