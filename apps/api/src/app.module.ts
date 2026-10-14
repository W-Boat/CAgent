import { Module } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"
import { ScheduleModule } from "@nestjs/schedule"
import { CommonModule } from "./common/common.module"
import { PrismaModule } from "./prisma/prisma.module"
import { AuthModule } from "./auth/auth.module"
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard"
import { PermissionsGuard } from "./common/guards/permissions.guard"
import { UsersModule } from "./users/users.module"
import { RolesModule } from "./roles/roles.module"
import { ProvidersModule } from "./providers/providers.module"
import { ModelsModule } from "./models/models.module"
import { ConversationsModule } from "./conversations/conversations.module"
import { UsageModule } from "./usage/usage.module"
import { SkillsModule } from "./skills/skills.module"
import { BrowserModule } from "./browser/browser.module"
import { AgentsModule } from "./agents/agents.module"
import { SettingsModule } from "./settings/settings.module"
import { AuditModule } from "./audit/audit.module"
import { DashboardModule } from "./dashboard/dashboard.module"
import { ChatModule } from "./chat/chat.module"
import { TrialModule } from "./trial/trial.module"
import { CampusModule } from "./campus/campus.module"
import { LearningModule } from "./learning/learning.module"
import { MemoryModule } from "./memory/memory.module"
import { ToolsModule } from "./tools/tools.module"
import { KnowledgeAdminModule } from './knowledge/knowledge-admin.module'

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CommonModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    ProvidersModule,
    ModelsModule,
    ConversationsModule,
    UsageModule,
    SkillsModule,
    BrowserModule,
    AgentsModule,
    SettingsModule,
    AuditModule,
    DashboardModule,
    ChatModule,
    TrialModule,
    CampusModule,
    LearningModule,
    MemoryModule,
    ToolsModule,
    KnowledgeAdminModule
  ],
  providers: [
    // 全局鉴权：未标记 @Public 的接口都需要登录
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 全局权限校验：按 @RequirePermissions 声明的权限码判断
    { provide: APP_GUARD, useClass: PermissionsGuard }
  ]
})
export class AppModule {}
