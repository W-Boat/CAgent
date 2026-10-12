import {Public} from "../common/decorators/public.decorator"
import {CampusActivityService} from "./campus-activity.service"
import {CampusActivityDto,LibraryGuideDto} from "./dto/campus.dto"
import { Body, Headers, Req, Controller, Get, Param, Post, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import { CampusGuideService } from "./campus-guide.service"
import { CampusGuideRunService } from "./campus-guide-run.service"
import {
  AdvanceStepDto,
  HighlightDto,
  ListGuideDto,
  OpenGuideDto,
  ScrollDto,
  SearchGuideDto
} from "./dto/campus.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import { CurrentUser, type AuthUser } from "../common/decorators/current-user.decorator"
import {KnowledgeStoreService} from '../knowledge/knowledge-store.service'

/**
 * UCASS 校园门户导览。
 *
 * 定位：**指路人，不是代办者**。
 *   - 检索只给路径（部门/地点/电话/步骤/关键参数/入口）
 *   - 「打开页面」只做 goto + 视觉标注，绝不代填表、代提交、代登录
 *   - 提示统一在网页下方用悬浮提示框展示，由学生自己照着做
 */
@ApiTags("校园导览")
@ApiBearerAuth()
@Controller("campus")
export class CampusController {
  constructor(
    private readonly guide: CampusGuideService,
    private readonly runs: CampusGuideRunService,
    private readonly activity:CampusActivityService,
    private readonly knowledge:KnowledgeStoreService
  ) {}

  @Post('activity') @Public()
  recordActivity(@Body() dto:CampusActivityDto,@Headers('authorization') bearer:string|undefined,@Req() req:any){return this.activity.client(dto,bearer,req.ip||'unknown')}
  // Only the public embedded food source, never arbitrary managed entries.
  @Get('food') @Public()
  food(@Query() query:Record<string,string>){return this.knowledge.foodDirectory(query)}
  @Get('shortcuts') @Public()
  shortcuts(){return this.knowledge.publicShortcuts()}
  @Get('activities') @RequirePermissions('campus:admin')
  activities(@Query() query:any){return this.activity.list(query)}
  @Get('activity/stats') @RequirePermissions('campus:admin')
  activityStats(@Query('days') days?:string){return this.activity.stats(Number(days)||14)}
  @Get('library') @RequirePermissions('campus:read')
  library(@Query() query:LibraryGuideDto,@CurrentUser() me:AuthUser){return this.guide.library(query,me.permissions.includes("*")||me.permissions.includes("campus:admin"))}
  // ---------- 静态路径必须声明在 :id 之前 ----------
  @Get('collections') @RequirePermissions('campus:read') collections(@CurrentUser() me:AuthUser) {return this.guide.collections(me.permissions.includes('*')||me.permissions.includes('campus:admin'))}

  @Get("meta")
  @RequirePermissions("campus:read")
  @ApiOperation({ summary: "导览索引元信息（快照时间、覆盖范围）" })
  meta() {
    return this.guide.meta()
  }

  @Get("categories")
  @RequirePermissions("campus:read")
  @ApiOperation({ summary: "分类 / 完整度 / 可达性统计" })
  categories() {
    return this.guide.categories()
  }

  @Get("search")
  @RequirePermissions("campus:read")
  @ApiOperation({
    summary: "检索办理指引",
    description:
      "guide（默认）只返回指引层：部门/地点/电话/步骤/关键参数/入口；full 追加正文与清单，需要 campus:full 权限。"
  })
  async search(@Query() query: SearchGuideDto, @CurrentUser() me: AuthUser) {
    const wantsFull = query.mode === "full"
    const canFull =
      me.permissions.includes("*") || me.permissions.includes("campus:full")
    const mode = wantsFull && canFull ? "full" : "guide"
    const result=await this.guide.search(query.q, mode, query.limit ?? 5, {collection:query.collection,topic:query.topic})
    await this.activity.write({userId:me.id,eventType:'QUERY',origin:'campus-guide',query:query.q,collection:query.collection,resultCount:result.hits.length,references:result.hits.map(h=>({id:h.id,title:h.title,collection:h.provenance?.collection||'',used:false}))})
    return result
  }

  /** 供对话/技能调用的纯文本作答块 */
  @Get("answer")
  @RequirePermissions("campus:read")
  @ApiOperation({ summary: "生成面向学生的指引文本（供对话与技能复用）" })
  async answer(@Query() query: SearchGuideDto, @CurrentUser() me: AuthUser) {
    const canFull =
      me.permissions.includes("*") || me.permissions.includes("campus:full")
    const mode = query.mode === "full" && canFull ? "full" : "guide"
    const text = await this.guide.answerBlock(query.q, mode, query.limit ?? 5, {collection:query.collection,topic:query.topic})
    return { query: query.q, mode, text }
  }

  @Get("items")
  @RequirePermissions("campus:read")
  @ApiOperation({ summary: "条目列表（支持分类/可达性/完整度/部门筛选）" })
  list(@Query() query: ListGuideDto) {
    return this.guide.list(query)
  }

  @Get("filter")
  @RequirePermissions("campus:read")
  @ApiOperation({ summary: "按部门 / 可达性 / 完整度 / 类型快速筛选" })
  filter(
    @Query("key") key: "dept" | "access" | "detailStatus" | "type",
    @Query("value") value: string,
    @Query("limit") limit?: string
  ) {
    return this.guide.filter(key || "dept", value || "", Number(limit) || 20)
  }

  // ---------- 导览会话 ----------

  @Post("runs")
  @RequirePermissions("campus:guide")
  @ApiOperation({
    summary: "打开导览页面（只打开，不代办）",
    description:
      "创建或复用浏览器会话，导航到目标页面并抓取实时画面；同时返回分步提示、注意事项与悬浮提示文案。"
  })
  open(@CurrentUser() me: AuthUser, @Body() dto: OpenGuideDto) {
    return this.runs.open({
      userId: me.id,
      itemId: dto.itemId,
      url: dto.url,
      reuse: dto.reuse,
      headless: dto.headless,
      width: dto.width,
      height: dto.height
    })
  }

  @Get("runs")
  @RequirePermissions("campus:read")
  @ApiOperation({ summary: "导览记录列表" })
  listRuns(
    @CurrentUser() me: AuthUser,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("all") all?: string,
    @Query("keyword") keyword?:string,
    @Query("status") status?:string
  ) {
    const canAll =
      me.permissions.includes("*") || me.permissions.includes("campus:admin")
    return this.runs.list(me.id, {
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
      all: canAll && all === "true",keyword:keyword?.slice(0,160),status
    })
  }

  @Get("runs/stats")
  @RequirePermissions("campus:admin")
  @ApiOperation({ summary: "导览使用统计" })
  runsStats(@Query("days") days?: string) {
    return this.runs.stats(Number(days) || 14)
  }

  @Get("runs/:id")
  @RequirePermissions("campus:read")
  @ApiOperation({ summary: "导览记录详情（含提示与当前画面）" })
  runDetail(@CurrentUser() me: AuthUser, @Param("id") id: string) {
    return this.runs.detail(me.id, id,me.permissions.includes("*")||me.permissions.includes("campus:admin"))
  }

  @Get("runs/:id/frame")
  @RequirePermissions("campus:read")
  @ApiOperation({ summary: "拉取最新画面（前端轮询用）" })
  frame(@CurrentUser() me: AuthUser, @Param("id") id: string, @Query("fullPage") fullPage?: string) {
    return this.runs.frame(me.id, id, fullPage === "true")
  }

  @Post("runs/:id/steps")
  @RequirePermissions("campus:guide")
  @ApiOperation({ summary: "勾选某一步已完成（由学生自己操作）" })
  advance(@CurrentUser() me: AuthUser, @Param("id") id: string, @Body() dto: AdvanceStepDto) {
    return this.runs.advance(me.id, id, dto.step, dto.done !== false, dto.note)
  }

  @Post("runs/:id/highlight")
  @RequirePermissions("campus:guide")
  @ApiOperation({
    summary: "在页面上高亮某处（只标注，不点击）",
    description: "仅修改 DOM 样式并返回新画面，用于「指哪里」，不会代替学生点击或填表。"
  })
  highlight(@CurrentUser() me: AuthUser, @Param("id") id: string, @Body() dto: HighlightDto) {
    return this.runs.highlight(me.id, id, dto.selector, dto.label, dto.clear === true, dto.text)
  }

  @Post("runs/:id/scroll")
  @RequirePermissions("campus:guide")
  @ApiOperation({ summary: "滚动导览页面（学生主动触发）" })
  scroll(@CurrentUser() me: AuthUser, @Param("id") id: string, @Body() dto: ScrollDto) {
    return this.runs.scroll(me.id, id, dto.y ?? 600)
  }

  @Post("runs/:id/reload")
  @RequirePermissions("campus:guide")
  @ApiOperation({ summary: "刷新导览页面（学生主动触发）" })
  reload(@CurrentUser() me: AuthUser, @Param("id") id: string) {
    return this.runs.reload(me.id, id)
  }

  @Post("runs/:id/close")
  @RequirePermissions("campus:guide")
  @ApiOperation({ summary: "结束导览会话" })
  close(@CurrentUser() me: AuthUser, @Param("id") id: string) {
    return this.runs.close(me.id, id)
  }

  // ---------- 条目详情（放在最后，避免吞掉上面的静态路径） ----------

  @Get("items/:id")
  @RequirePermissions("campus:read")
  @ApiOperation({ summary: "条目详情（始终含全部字段）" })
  detail(@Param("id") id: string,@CurrentUser() me:AuthUser) {
    return this.guide.detail(id,me.permissions.includes("*")||me.permissions.includes("campus:admin"))
  }
}
