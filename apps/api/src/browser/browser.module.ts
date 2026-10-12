import { Module, OnModuleInit } from "@nestjs/common"
import { BrowserEngineService } from "./browser-engine.service"
import { BrowserCommandService } from "./browser-command.service"
import { BrowserController } from "./browser.controller"
import { TimetableOnlyGuard } from './timetable-only.guard'

@Module({
  controllers: [BrowserController],
  providers: [BrowserEngineService, BrowserCommandService, TimetableOnlyGuard],
  exports: [BrowserEngineService, BrowserCommandService]
})
export class BrowserModule implements OnModuleInit {
  constructor(private readonly engine: BrowserEngineService) {}

  async onModuleInit() {
    /*
     * 只回收 SERVER 执行器的残留会话。
     *
     * 本地执行（LOCAL）的会话不依赖服务端进程：用户浏览器还开着，会话就还有效，
     * 服务端重启不该把它们标记为崩溃——否则用户刷新一下后端就丢了会话。
     */
    await this.engine.cleanupStaleSessions()
  }
}
