import { Body, Controller, Get, Ip, Param, Post, Query, Req, Res } from "@nestjs/common"
import { ApiOperation, ApiTags } from "@nestjs/swagger"
import type { Request, Response } from "express"
import { Public } from "../common/decorators/public.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import { TrialService } from "./trial.service"

@ApiTags("体验版")
@Controller("trial")
export class TrialController {
  constructor(private readonly trial: TrialService) {}

  /** 反向代理/CDN 后取真实访客 IP：CF → XFF 首段 → socket */
  private clientIp(req: Request, fallback?: string): string {
    const cf = req.headers["cf-connecting-ip"]
    if (typeof cf === "string" && cf.trim()) return cf.trim()
    const xff = req.headers["x-forwarded-for"]
    if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim()
    if (Array.isArray(xff) && xff.length) return String(xff[0]).trim()
    return fallback || req.ip || "unknown"
  }

  @Public()
  @Get("quota")
  @ApiOperation({ summary: "当前 IP 今日剩余体验轮数" })
  quota(@Req() req: Request, @Ip() ip: string) {
    return this.trial.quota(this.clientIp(req, ip))
  }

  @Public()
  @Post("chat")
  @ApiOperation({
    summary: "体验版对话（免登录，SSE）",
    description:
      "模型锁定 deepseek-chat、智能体锁定校园导览；每 IP 每日 5 轮，超限返回 429。"
  })
  async chat(
    @Req() req: Request,
    @Res() res: Response,
    @Ip() ip: string,
    @Body() body: { content?: string; conversationId?: string;outputPreference?:string;bypassCache?:boolean;revisionMessageId?:string }
  ) {
    const content = String(body?.content || "").slice(0, 4000)
    const conversationId =
      typeof body?.conversationId === "string" ? body.conversationId : undefined
    const outputPreference=['cards','adaptive','text'].includes(body.outputPreference||'')?body.outputPreference as 'cards'|'adaptive'|'text':'adaptive'
    return this.trial.chatRound(this.clientIp(req, ip), content, conversationId, res,{outputPreference,bypassCache:body.bypassCache===true,revisionMessageId:typeof body.revisionMessageId==='string'?body.revisionMessageId:undefined})
  }

  @Public()
  @Post("survey")
  @ApiOperation({ summary: "提交每轮问卷（可跳过）" })
  survey(
    @Req() req: Request,
    @Ip() ip: string,
    @Body()
    body: {
      roundId?: string
      overall?: number
      problems?: string[]
      wants?: string[]
      advice?: string
    }
  ) {
    return this.trial.survey(this.clientIp(req, ip), body)
  }

  @Get("stats")
  @RequirePermissions("dashboard:read")
  @ApiOperation({ summary: "体验版统计数据（后台）" })
  stats() {
    return this.trial.stats()
  }

  @Get("rounds")
  @RequirePermissions("dashboard:read")
  @ApiOperation({ summary: "最近问答明细（后台）" })
  rounds(@Query("take") take?: string) {
    return this.trial.recentRounds(Number(take) || 30)
  }

  @Get("surveys")
  @RequirePermissions("dashboard:read")
  @ApiOperation({ summary: "最近问卷明细（后台）" })
  surveys(@Query("take") take?: string) {
    return this.trial.recentSurveys(Number(take) || 30)
  }

  @Get("session/:conversationId")
  @RequirePermissions("dashboard:read")
  @ApiOperation({ summary: "会话追溯：整段体验问答（后台）" })
  session(@Param("conversationId") conversationId: string) {
    return this.trial.session(conversationId)
  }
}
