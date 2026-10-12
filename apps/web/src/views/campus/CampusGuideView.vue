<template>
  <div class="campus-page">
    <!-- 手机端：列表 / 页面 二选一，避免在窄屏上把两块内容堆成长长一列 -->
    <div v-if="isNarrow" class="mobile-switch">
      <button
        type="button"
        class="switch-btn"
        :class="{ on: mobilePane === 'list' }"
        @click="mobilePane = 'list'"
      >
        <el-icon><Search /></el-icon> 找事项
      </button>
      <button
        type="button"
        class="switch-btn"
        :class="{ on: mobilePane === 'stage' }"
        @click="mobilePane = 'stage'"
      >
        <el-icon><Monitor /></el-icon> 看页面
        <span v-if="hints.length" class="switch-badge">{{ doneCount }}/{{ hints.length }}</span>
      </button>
    </div>

    <!-- 左：搜索与条目 -->
    <aside class="side" :class="{ 'mobile-hide': isNarrow && mobilePane !== 'list' }">
      <div class="side-head">
        <div class="side-title">
          <el-icon><MapLocation /></el-icon>
          <span>社科大校园导览</span>
        </div>
        <el-tooltip placement="right" effect="dark">
          <template #content>
            <div style="max-width: 260px; line-height: 1.7">
              导览只负责<b>打开页面</b>、<b>指路</b>。<br />
              登录、填表、提交都由你自己完成。
            </div>
          </template>
          <el-tag size="small" type="warning" effect="plain">指路不代办</el-tag>
        </el-tooltip>
      </div>

      <div class="side-search">
        <el-input
          v-model="keyword"
          placeholder="要办什么事？如：校园卡丢了"
          clearable
          @keyup.enter="doSearch"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" :loading="searching" @click="doSearch">查一查</el-button>
      </div>

      <div class="quick-tags">
        <el-select v-model="contentType" clearable placeholder="全部内容形式" size="small" @change="browseLibrary"><el-option v-for="(label,value) in FORMATS" :key="value" :label="label" :value="value"/></el-select>
        <el-button size="small" @click="browseLibrary">浏览知识库</el-button>
        <el-select v-model="collection" placeholder="联动查询全部知识库" clearable size="small" @change="browseLibrary"><el-option v-for="c in COLLECTIONS" :key="c.value" :label="c.label" :value="c.value"/></el-select>
        <el-tag
          v-for="t in QUICK"
          :key="t"
          size="small"
          effect="plain"
          class="quick-tag"
          @click="quickSearch(t)"
        >
          {{ t }}
        </el-tag>
      </div>

      <el-scrollbar class="side-scroll">
        <section v-if="guidance && searched" class="guided-search">
          <strong>{{guidance.stage==='clarify'?'先确认事项':'查询向导'}}</strong><p>{{guidance.prompt}}</p>
          <el-button v-for="choice in guidance.choices" :key="choice.query" size="small" @click="quickSearch(choice.query)">{{choice.label}}</el-button>
          <p v-if="guidance.missingFields.length">未收录：{{guidance.missingFields.join('、')}}</p>
          <p v-for="conflict in guidance.conflicts" :key="conflict" class="guidance-conflict">{{conflict}}</p>
        </section>
        <!-- 搜索结果 -->
        <template v-if="hits.length > 0">
          <div class="sec-label">
            找到 {{ hits.length }} 条
            <el-tag size="small" :type="mode === 'full' ? 'warning' : 'info'" effect="plain">
              {{ mode === "full" ? "含正文" : "仅指路" }}
            </el-tag>
          </div>
          <div
            v-for="hit in hits"
            :key="hit.id"
            class="hit"
            :class="{ active: hit.id === activeHitId }"
            @click="selectHit(hit)"
          >
            <div class="hit-title">
              <el-icon v-if="hit.access === '校园网/VPN'" class="hit-ico" title="需要校园网或VPN">
                <Lock />
              </el-icon>
              <el-icon v-else-if="hit.access === '已合并下线'" class="hit-ico" title="平台已合并下线">
                <CircleClose />
              </el-icon>
              <span>{{ hit.title }}</span>
            </div>
            <div class="hit-meta">
              <el-tag size="small" effect="plain" :type="statusTagType(hit.detailStatus)">
                {{ statusLabel(hit.detailStatus) }}
              </el-tag>
              <span v-if="hit.dept" class="muted">{{ hit.dept }}</span>
            </div>
            <div v-if="hit.summaryShort" class="hit-summary">
              {{ truncate(hit.summaryShort, 96) }}
            </div>
          </div>
        </template>

        <el-pagination v-if="browsing" v-model:current-page="libraryPage" :total="libraryTotal" :page-size="20" small layout="prev,pager,next" @current-change="loadLibrary"/>
        <!-- 分类浏览 -->
        <template v-else>
          <div class="sec-label">按分类浏览（{{ meta?.total ?? 0 }} 条索引）</div>
          <div class="cat-list">
            <div
              v-for="c in topCats"
              :key="c.value"
              class="cat-item"
              @click="browseCat(c.value)"
            >
              <span>{{ c.value }}</span>
              <span class="muted">{{ c.count }}</span>
            </div>
          </div>
          <div class="sec-label">按可达性</div>
          <div class="cat-list">
            <div
              v-for="a in categories?.access ?? []"
              :key="a.value"
              class="cat-item"
              @click="browseAccess(a.value)"
            >
              <span>{{ a.value }}</span>
              <span class="muted">{{ a.count }}</span>
            </div>
          </div>
        </template>

        <el-empty
          v-if="!searching && searched && hits.length === 0"
          description="没找到对应事项，换个更短的核心词试试"
          :image-size="60"
        />
      </el-scrollbar>
    </aside>

    <!-- 右：网页画面 + 下方悬浮提示 -->
    <section class="stage" :class="{ 'mobile-hide': isNarrow && mobilePane !== 'stage' }">
      <!-- 顶部状态条 -->
      <div class="stage-bar">
        <div class="url-pill">
          <el-icon><Link /></el-icon>
          <span class="mono ellipsis">{{ currentUrl || "尚未打开任何页面" }}</span>
          <el-tag v-if="frameStale" size="small" type="warning" effect="plain">
            画面已过期
          </el-tag>
        </div>
        <div class="stage-actions">
          <el-tooltip content="重新打开当前条目页面">
            <el-button size="small" :disabled="!activeHit" :loading="opening" @click="openActive">
              <el-icon><RefreshRight /></el-icon> 重新打开
            </el-button>
          </el-tooltip>
          <el-tooltip content="刷新画面（不改变页面）">
            <el-button size="small" :disabled="!runId" @click="refreshFrame">
              <el-icon><Picture /></el-icon> 刷新画面
            </el-button>
          </el-tooltip>
          <el-tooltip content="向上翻一屏（只移动视口，不点击页面）">
            <el-button size="small" :disabled="!runId || !runAlive" @click="scrollBy(-600)">
              <el-icon><ArrowUpBold /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="向下翻一屏（只移动视口，不点击页面）">
            <el-button size="small" :disabled="!runId || !runAlive" @click="scrollBy(600)">
              <el-icon><ArrowDownBold /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="在浏览器新标签打开真实页面，自己操作">
            <el-button size="small" type="primary" plain :disabled="!currentUrl" @click="openExternal">
              <el-icon><TopRight /></el-icon> 自己去操作
            </el-button>
          </el-tooltip>
          <el-button size="small" type="danger" plain :disabled="!runId" @click="closeRun">
            <el-icon><SwitchButton /></el-icon> 结束导览
          </el-button>
        </div>
      </div>

      <!-- 网页画面：服务器不渲染时改为「入口卡片 + 指引」 -->
      <div ref="screenBox" class="screen">
        <div v-if="opening" class="screen-hint">
          <el-icon class="is-loading" :size="26"><Loading /></el-icon>
          <p>正在为你打开页面…</p>
        </div>

        <img
          v-else-if="frameSrc"
          :src="frameSrc"
          class="screen-img"
          alt="导览页面画面"
          @click="previewVisible = true"
        />

        <KnowledgeContent v-else-if="activeHit" :hit="activeHit"/>
        <div v-else class="screen-hint">
          <el-icon :size="46"><Monitor /></el-icon>
          <h3>左边搜一件事，我来告诉你怎么走</h3>
          <p class="muted">
            我会列出该去哪办、带什么、注意什么，并给出入口链接 —— 操作由你自己完成。
          </p>
          <div class="screen-quick">
            <el-button
              v-for="t in QUICK"
              :key="t"
              size="small"
              plain
              @click="quickSearch(t)"
            >
              {{ t }}
            </el-button>
          </div>
        </div>

        <!-- 画面没有正常出来时的兜底提示 -->
        <div v-if="frameSrc && !runAlive" class="frame-bad">
          <el-icon><WarningFilled /></el-icon>
          <span>画面已停止更新（会话已结束），可点击「重新打开」继续</span>
        </div>
      </div>

      <!-- ============ 网页下方的悬浮提示框 ============ -->
      <transition name="hint-rise">
        <div v-if="activeHit || hints.length > 0" class="hint-dock" :class="{ collapsed: hintCollapsed }">
          <div class="hint-head" @click="hintCollapsed = !hintCollapsed">
            <div class="hint-head-left">
              <el-icon class="hint-ico"><Compass /></el-icon>
              <span class="hint-title">导览提示</span>
              <el-tag v-if="policy" size="small" type="warning" effect="plain">
                {{ policy.openOnly ? "只打开，不代办" : "" }}
              </el-tag>
              <el-tag v-if="doneCount > 0" size="small" type="success" effect="plain">
                已完成 {{ doneCount }}/{{ hints.length }}
              </el-tag>
            </div>
            <el-icon class="hint-toggle">
              <component :is="hintCollapsed ? 'ArrowUp' : 'ArrowDown'" />
            </el-icon>
          </div>

          <div v-show="!hintCollapsed" class="hint-body">
            <!-- 第一屏的一句话横幅 -->
            <div v-if="banner" class="hint-banner">
              <el-icon><InfoFilled /></el-icon>
              <span>{{ banner }}</span>
            </div>

            <!-- 注意事项：VPN / 附件 / 已下线 / 无数据 -->
            <div v-for="(w, i) in warnings" :key="`w${i}`" class="hint-warn">
              <el-icon><WarningFilled /></el-icon>
              <span>{{ w }}</span>
            </div>

            <!-- 去哪里 / 带什么 -->
            <div class="hint-facts">
              <div v-if="activeHit?.provenance" class="fact"><span class="fact-k">来源</span><span class="fact-v">{{activeHit.provenance.file}} · {{trustLabel(activeHit.provenance.trust)}}<br/>{{activeHit.provenance.locator}}</span></div>
              <div v-if="activeHit?.dept" class="fact">
                <span class="fact-k">去哪里</span>
                <span class="fact-v">{{ activeHit.dept }}</span>
              </div>
              <div v-if="activeHit?.place" class="fact">
                <span class="fact-k">地点</span>
                <span class="fact-v">{{ activeHit.place }}</span>
              </div>
              <div v-if="activeHit?.tel" class="fact">
                <span class="fact-k">电话</span>
                <a class="fact-v" :href="`tel:${activeHit.tel}`">{{ activeHit.tel }}</a>
              </div>
              <div v-if="activeHit?.officeTime" class="fact">
                <span class="fact-k">时间</span>
                <span class="fact-v">{{ activeHit.officeTime }}</span>
              </div>
              <div v-if="activeHit?.form" class="fact">
                <span class="fact-k">表单</span>
                <span class="fact-v">{{ activeHit.form }}</span>
              </div>
              <div v-if="activeHit?.login" class="fact">
                <span class="fact-k">登录</span>
                <span class="fact-v">{{ activeHit.login }}</span>
              </div>
            </div>
            <div v-if="activeHit?.detail || activeHit?.summaryShort" class="knowledge-excerpt"><MarkdownView :content="activeHit.detail || activeHit.summaryShort"/></div>
            <div v-if="activeHit?.related?.length" class="related-knowledge"><b>关联知识</b><button v-for="related in activeHit.related" :key="related.id" type="button" @click="selectHit(related)">{{related.title}} <small>{{trustLabel(related.provenance?.trust || '')}}</small></button></div>

            <!-- 关键参数（费用、时限等） -->
            <div v-if="(activeHit?.keyFacts?.length ?? 0) > 0" class="hint-keys">
              <span
                v-for="(f, i) in activeHit?.keyFacts ?? []"
                :key="`k${i}`"
                class="key-chip"
              >
                <b>{{ f.kind }}</b>{{ f.value }}
              </span>
            </div>

            <!-- 分步提示：可以逐条打勾 -->
            <div v-if="hints.length > 0" class="hint-steps">
              <div
                v-for="s in hints"
                :key="s.index"
                class="hint-step"
                :class="{ done: s.done, current: s.index === nextStep }"
              >
                <el-checkbox
                  :model-value="s.done"
                  @change="(v: any) => toggleStep(s.index, Boolean(v))"
                />
                <div class="step-main">
                  <div class="step-text" :class="{ 'step-done': s.done }">{{ s.tip }}</div>
                  <div v-if="s.facts.length" class="step-facts">
                    <span v-for="(f, i) in s.facts" :key="i" class="muted">
                      {{ f.kind }}：{{ f.value }}
                    </span>
                  </div>
                </div>
                <el-tooltip content="在页面上把这个位置框出来给我看">
                  <el-button
                    text
                    size="small"
                    :disabled="!runId"
                    @click.stop="highlightStep(s)"
                  >
                    <el-icon><Aim /></el-icon> 指给我看
                  </el-button>
                </el-tooltip>
              </div>
            </div>

            <!-- 只有入口、没有步骤时的兜底 -->
            <div v-else-if="activeHit" class="hint-nosteps">
              <el-icon><Document /></el-icon>
              <span>{{ noStepsHint }}</span>
            </div>

            <!-- 结尾：入口 + 核实时间 -->
            <div class="hint-foot">
              <div class="foot-left">
                <span v-if="activeHit?.url" class="foot-url mono ellipsis">
                  {{ activeHit.url }}
                </span>
                <span class="muted">
                  资料更新于{{ activeHit?.verifiedAt || "未标注" }}
                  ，之后如有变更不会反映
                </span>
              </div>
              <div class="foot-right">
                <el-button
                  v-if="activeHit?.url"
                  size="small"
                  @click="copyUrl(activeHit.url)"
                >
                  <el-icon><CopyDocument /></el-icon> 复制入口
                </el-button>
                <el-button
                  v-if="canFull && mode === 'guide'"
                  size="small"
                  type="warning"
                  plain
                  @click="switchToFull"
                >
                  看完整正文
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- 打开失败：仍然给提示，不代办 -->
      <div v-if="openError" class="open-error">
        <el-icon><CircleCloseFilled /></el-icon>
        <div>
          <b>页面没能正常打开</b>
          <p>{{ openError }}</p>
          <p class="muted">下面的提示依然有效，你也可以点击「自己去操作」用本机浏览器打开。</p>
        </div>
      </div>
    </section>

    <!-- 大图预览 -->
    <el-dialog v-model="previewVisible" title="页面画面" width="86%" top="3vh" append-to-body>
      <img v-if="frameSrc" :src="frameSrc" class="preview-img" alt="画面预览" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { campusApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import type {
  CampusCategories,
  CampusFrame,
  CampusGuideHit,
  CampusGuideMode,
  CampusMeta,
  CampusPolicy,
  CampusStepHint
} from "@/api/types"
import { artifactUrl, truncate } from "@/utils/format"
import { useAuthStore } from "@/stores/auth"
import KnowledgeContent from '@/components/KnowledgeContent.vue'
import {trackCampus} from '@/utils/campus-activity'

const auth = useAuthStore()

const QUICK = ["校园卡补办", "四六级报名", "报销流程", "VPN 怎么连", "宿舍报修", "成绩查询"]

const keyword = ref("")
const collection=ref('')
const contentType=ref(''),libraryPage=ref(1),libraryTotal=ref(0),browsing=ref(false)
const FORMATS={article:'文章 / 知识块',link:'入口与正文',document:'文档 / 附件',map:'校园地图',fixed:'固定问答 / 纠错',rule:'关键词约定',cards:'排版卡片'}
async function loadLibrary(){searching.value=true;try{const data=await campusApi.library({collection:collection.value||undefined,format:contentType.value||undefined,keyword:keyword.value||undefined,page:libraryPage.value,pageSize:20});hits.value=data.items;libraryTotal.value=data.total;searched.value=true;guidance.value=undefined}catch(e){toastError(e,'知识库浏览失败')}finally{searching.value=false}}
function browseLibrary(){browsing.value=true;libraryPage.value=1;void loadLibrary()}

const COLLECTIONS=ref([{value:'matters',label:'办事事项'},{value:'portal',label:'校园门户'},{value:'services',label:'一站式平台'},{value:'freshman',label:'新生指南'},{value:'courses',label:'课程测评'},{value:'takeout',label:'外卖红黑榜'},{value:'survival',label:'生活经验'},{value:'handbook',label:'UCASSbook'}])
function trustLabel(trust:string){return ({official_index:'官方索引',curated:'整理资料',community:'同学经验',unverified:'待核实',handbook:'手册转录',reviewed:'管理员审核'} as Record<string,string>)[trust] || '来源未分类'}
const searching = ref(false)
const searched = ref(false)
const guidance=ref<import('@/api/types').CampusSearchResult['guidance']>()
const hits = ref<CampusGuideHit[]>([])
const mode = ref<CampusGuideMode>("guide")
const meta = ref<CampusMeta | null>(null)
/** 搜索接口附带的轻量元信息（快照时间与条数），用于兜底展示 */
const searchMeta = ref<{ verifiedAt: string | null; total: number; schema: string } | null>(null)
const categories = ref<CampusCategories | null>(null)

const activeHit = ref<CampusGuideHit | null>(null)
const activeHitId = computed(() => activeHit.value?.id ?? "")

const runId = ref("")
const sessionId = ref("")
const hints = ref<CampusStepHint[]>([])
const banner = ref("")
const warnings = ref<string[]>([])
const policy = ref<CampusPolicy | null>(null)
const currentUrl = ref("")
const openError = ref("")
const runAlive = ref(true)
/**
 * 服务端是否提供实时画面。
 *
 * 服务器默认不装浏览器（内存有限），此时 frame 恒为空：
 * 页面改为展示「入口卡片 + 分步指引」，引导用户在自己的浏览器里打开。
 * 为 false 时也不再轮询画面，省掉无谓请求。
 */
const hasLiveFrame = ref(false)
const opening = ref(false)
const hintCollapsed = ref(false)
const previewVisible = ref(false)
/** 当前画面是上一帧（页面正在跳转，这次没抓到新的） */
const frameStale = ref(false)
/** 连续拉取失败次数，用于区分「跳转抖动」和「会话真的没了」 */
let frameFailures = 0
/** 网页画面容器，用来量出内嵌区域的真实宽高 */
const screenBox = ref<HTMLElement | null>(null)

const frame = ref<CampusFrame | null>(null)
/** 每次拉取后换一个时间戳，浏览器才会重新请求同一张 live.png */
const frameStamp = ref(0)
const frameSrc = computed(() =>
  frame.value?.screenshotPath
    ? `${artifactUrl(frame.value.screenshotPath)}?t=${frameStamp.value}`
    : ""
)

const doneCount = computed(() => hints.value.filter((h) => h.done).length)

/** 手机端：搜索列表与网页画面分开显示，默认先给学生检索 */
const narrowQuery =
  typeof window !== "undefined" ? window.matchMedia("(max-width: 1100px)") : null
const isNarrow = ref(narrowQuery?.matches ?? false)
const mobilePane = ref<"list" | "stage">("list")

let stopNarrowWatch: (() => void) | undefined
const nextStep = computed(() => {
  const first = hints.value.find((h) => !h.done)
  return first ? first.index : -1
})

const canFull = computed(() => auth.can("campus:full"))

const topCats = computed(() => (categories.value?.cats ?? []).slice(0, 10))

const noStepsHint = computed(() => {
  const hit = activeHit.value
  if (!hit) return ""
  if (hit.detailStatus === "link_only") {
    return "这条只有系统入口，没有整理好的办理步骤。点上面的入口进去后按页面提示操作；需要登录的用统一身份认证。"
  }
  if (hit.detailStatus === "attachment_only") {
    return "办理细节写在随附的附件里，索引中没有正文。请打开入口后在页面上下载附件查看具体要求。"
  }
  if (hit.detailStatus === "unavailable") {
    return "校方尚未启用该事项，接口中没有数据。不要凭猜测准备材料，建议直接联系相关部门的电话确认。"
  }
  return "索引里没有为这条整理出分步说明。可以打开入口看页面提示，或联系对应部门确认。"
})

let pollTimer: number | undefined

// ---------- 搜索 ----------

async function doSearch() {
  browsing.value=false
  const q = keyword.value.trim()
  if (!q) {
    toastError(new Error("请输入要办理的事项"))
    return
  }
  searching.value = true
  try {
    const res = await campusApi.search({ q, mode: mode.value, limit: 5,collection:collection.value || undefined })
    hits.value = res.hits
    guidance.value=res.guidance
    mode.value = res.mode
    searchMeta.value = res.meta
    searched.value = true
    if (res.hits.length > 0) {
      await selectHit(res.hits[0])
    } else {
      activeHit.value = null
    }
  } catch (error) {
    toastError(error, "搜索失败")
  } finally {
    searching.value = false
  }
}

function quickSearch(text: string) {
  keyword.value = text
  void doSearch()
}

async function selectHit(hit: CampusGuideHit) {
  try{hit=await campusApi.item(hit.id)}catch(e){toastError(e,'资料内容加载失败');return}
  activeHit.value = hit
  trackCampus('CONTENT_VIEW',{entryId:hit.id,collection:hit.provenance?.collection,title:hit.title})
  if (!hit.url || hit.id.startsWith('managed:') || ['article','map','fixed','rule','cards','document'].includes(hit.contentFormat||'')) {
    if (pollTimer) window.clearInterval(pollTimer)
    frame.value=null;runId.value='';sessionId.value='';currentUrl.value=hit.url || '';openError.value='';opening.value=false
    hints.value=hit.steps.map((s,i)=>({index:i+1,text:s,tip:s,facts:[],done:false}));warnings.value=hit.warnings || [];hasLiveFrame.value=false
    banner.value=hit.url?'资料入口已提供，点击查看原页面。':'可直接阅读已收录的知识内容。'
    policy.value=null;hintCollapsed.value=false
    if(isNarrow.value) mobilePane.value='stage'
    return
  }
  // 换条目就重新打开页面：导览的核心动作只有「打开」
  await openActive()
}

async function browseCat(cat: string) {
  try {
    const list = await campusApi.items({ cat, pageSize: 10 })
    hits.value = list.items
    searched.value = true
    mode.value = "guide"
    if (list.items.length > 0) await selectHit(list.items[0])
  } catch (error) {
    toastError(error, "分类浏览失败")
  }
}

async function browseAccess(access: string) {
  try {
    const list = await campusApi.items({ access, pageSize: 10 })
    hits.value = list.items
    searched.value = true
    mode.value = "guide"
    if (list.items.length > 0) await selectHit(list.items[0])
  } catch (error) {
    toastError(error, "筛选失败")
  }
}

async function switchToFull() {
  if (!keyword.value.trim() && activeHit.value) keyword.value = activeHit.value.title
  mode.value = "full"
  await doSearch()
  toastOk("已切换到完整正文")
}

// ---------- 打开页面（只打开，不代办） ----------

async function openActive() {
  const hit = activeHit.value
  if (!hit) return
  if (!hit.url || hit.id.startsWith('managed:')) return
  opening.value = true
  openError.value = ""
  try {
    const res = await campusApi.open({
      itemId: hit.id,
      // 把内嵌区域的真实尺寸告诉后端，让画面比例贴近容器
      width: screenBox.value?.clientWidth || undefined,
      height: screenBox.value?.clientHeight || undefined
    })
    runId.value = res.runId
    // 服务器不渲染页面时后端返回 null，前端统一用空串表示「无会话」
    sessionId.value = res.sessionId ?? ""
    hints.value = res.hints
    banner.value = res.banner
    warnings.value = res.warnings
    policy.value = res.policy
    frame.value = res.frame
    frameStamp.value = Date.now()
    currentUrl.value = res.frame?.url || hit.url
    runAlive.value = res.pageOk
    // 服务器不渲染页面时没有实时画面，据此停掉轮询、改展示入口卡片
    hasLiveFrame.value = res.hasLiveFrame ?? Boolean(res.frame)
    openError.value = res.openError || ""
    hintCollapsed.value = false
    frameStale.value = false
    frameFailures = 0
    // 窄屏：页面已经打开，直接把学生带到画面那边，省掉一次手动切换
    if (isNarrow.value) mobilePane.value = "stage"
  } catch (error) {
    openError.value = error instanceof Error ? error.message : "打开页面失败"
    toastError(error, "打开页面失败")
  } finally {
    opening.value = false
  }
}

async function refreshFrame() {
  if (!runId.value || !hasLiveFrame.value) return
  try {
    const f = await campusApi.frame(runId.value)
    frame.value = f
    frameStamp.value = Date.now()
    currentUrl.value = f.url
    runAlive.value = true
    frameStale.value = Boolean(f.stale)
    openError.value = ""
    frameFailures = 0
  } catch (error) {
    // 服务器不渲染页面时后端返回 SERVER_BROWSER_DISABLED，这不是错误，直接停止轮询
    const msg = error instanceof Error ? error.message : ""
    if (msg.includes("SERVER_BROWSER_DISABLED")) {
      hasLiveFrame.value = false
      return
    }
    // 单次拉取失败多半是页面正在跳转，只有连续失败才认定会话结束。
    // 否则每 5 秒弹一次错误提示，学生会被吵到没法用。
    frameFailures += 1
    if (frameFailures >= 3) {
      runAlive.value = false
      openError.value = msg || "画面刷新失败"
    }
  }
}

function openExternal() {
  // 服务器不渲染时 currentUrl 可能为空，退回条目自身的入口地址
  const target = currentUrl.value || activeHit.value?.url || ""
  if (!target) {
    toastError(new Error("该事项没有提供入口地址"))
    return
  }
  trackCampus("LINK_CLICK",{url:target,entryId:activeHit.value?.id,collection:activeHit.value?.provenance?.collection,title:activeHit.value?.title})
  window.open(target, "_blank", "noopener,noreferrer")
}

/** 只移动视口看下一页，不做任何点击 —— 页面上的表单依然由学生自己填 */
async function scrollBy(y: number) {
  if (!runId.value) return
  try {
    const res = await campusApi.scroll(runId.value, y)
    if (res.frame) {
      frame.value = res.frame
      frameStamp.value = Date.now()
      currentUrl.value = res.frame.url
      runAlive.value = true
    }
  } catch (error) {
    toastError(error, "滚动失败")
  }
}

async function closeRun() {
  if (!runId.value) return
  try {
    await ElMessageBox.confirm(
      "结束本次导览？浏览器会话会被释放，提示记录仍会保留。",
      "结束导览",
      { type: "warning", confirmButtonText: "结束", cancelButtonText: "继续" }
    )
  } catch {
    return
  }
  try {
    await campusApi.close(runId.value)
    toastOk("导览已结束")
    runId.value = ""
    sessionId.value = ""
    frame.value = null
    runAlive.value = false
  } catch (error) {
    toastError(error)
  }
}

// ---------- 提示交互 ----------

async function toggleStep(step: number, done: boolean) {
  if (!runId.value) return
  // 先本地落勾，界面立刻响应；失败再回滚，避免点一下要等一个来回
  const before = hints.value.map((h) => ({ ...h }))
  hints.value = hints.value.map((h) => (h.index === step ? { ...h, done } : h))
  try {
    const res = await campusApi.advance(runId.value, step, done)
    hints.value = res.hints
  } catch (error) {
    hints.value = before
    toastError(error, "步骤状态保存失败")
  }
}

/**
 * 「指给我看」：只做视觉标注，不点击、不填表。
 * 优先用步骤里的关键参数或文字片段定位页面元素。
 */
async function highlightStep(step: CampusStepHint) {
  if (!runId.value) return
  // 从步骤文本里挑一个最像页面文案的片段（长度适中的连续中文）
  const fragment =
    step.facts[0]?.value ||
    (step.text.match(/[\u4e00-\u9fa5A-Za-z0-9]{4,14}/g) || [])[0] ||
    step.text.slice(0, 12)

  try {
    const res = await campusApi.highlight(runId.value, {
      text: fragment,
      label: `第 ${step.index} 步：${truncate(step.text, 28)}`
    })
    if (res.frame) {
      frame.value = res.frame
      frameStamp.value = Date.now()
    }
    if (res.matched > 0) {
      toastOk(`已在页面上框出「${fragment}」`)
    } else if (res.error) {
      toastError(new Error(res.error))
    } else {
      toastError(new Error("页面上没找到对应的位置，可能内容需要登录后才显示"))
    }
  } catch (error) {
    toastError(error, "标注失败")
  }
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toastOk("入口已复制，去浏览器自己打开吧")
  } catch {
    toastError(new Error("复制失败，请手动选中链接"))
  }
}

// ---------- 状态展示辅助 ----------

function statusLabel(status: string): string {
  return (
    {
      full: "官方全文",
      verified: "已核实",
      rendered: "已渲染",
      basic: "基本可用",
      attachment_only: "正文在附件",
      link_only: "仅入口",
      unavailable: "未启用"
    } as Record<string, string>
  )[status] || status
}

function statusTagType(status: string): "success" | "warning" | "info" | "danger" | "primary" {
  if (["full", "verified", "rendered"].includes(status)) return "success"
  if (status === "basic") return "primary"
  if (status === "attachment_only") return "warning"
  if (status === "unavailable") return "danger"
  return "info"
}

onMounted(async () => {
  const onNarrowChange = (e: MediaQueryListEvent) => {
    isNarrow.value = e.matches
    // 回到宽屏时两栏同时可见，固定回列表侧避免「右侧空白」
    if (!e.matches) mobilePane.value = "list"
  }
  narrowQuery?.addEventListener("change", onNarrowChange)
  stopNarrowWatch = () => narrowQuery?.removeEventListener("change", onNarrowChange)

  try {
    const [m, c, collections] = await Promise.all([campusApi.meta(), campusApi.categories(),campusApi.collections()])
    meta.value = m
    categories.value = c
    COLLECTIONS.value=collections
  } catch {
    // 索引统计不是关键路径，失败也不阻塞
  }
  browseLibrary()
  // 画面轮询：只在「服务端确实有画面」且导览进行中时拉取，否则不发请求
  pollTimer = window.setInterval(() => {
    if (hasLiveFrame.value && runId.value && runAlive.value && !opening.value) {
      void refreshFrame()
    }
  }, 5000)
})

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
  stopNarrowWatch?.()
})
</script>

<style scoped>
.knowledge-reader { height:100%; padding:28px; overflow:auto; max-width:960px; margin:auto; box-sizing:border-box; text-align:left; line-height:1.7; }
.knowledge-reader h2 { margin:16px 0; }
.guided-search { margin:12px; padding:14px; border:1px solid var(--el-border-color); border-radius:12px; background:var(--el-fill-color-light); font-size:12px; line-height:1.6; }
.guided-search .el-button { margin:4px; max-width:100%; height:auto; white-space:normal; padding:8px; }
.guidance-conflict { color:var(--el-color-warning-dark-2); }
.knowledge-excerpt { margin:12px 0; padding:12px; border-radius:12px; background:var(--el-fill-color-light); max-height:380px; overflow:auto; }
.related-knowledge { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; align-items:center; }
.related-knowledge button { border:1px solid var(--el-border-color); background:var(--el-bg-color); border-radius:8px; padding:8px 10px; cursor:pointer; color:var(--el-text-color-primary); }
.related-knowledge small { color:var(--el-text-color-secondary); }
.campus-page {
  display: flex;
  height: 100%;
  gap: 14px;
  padding: 14px;
  overflow: hidden;
}

/* ---------- 左侧搜索栏 ---------- */

.side {
  display: flex;
  flex-direction: column;
  width: 316px;
  flex: 0 0 316px;
  background: var(--cg-card-bg);
  border: 1px solid var(--cg-border);
  border-radius: var(--cg-radius);
  overflow: hidden;
}

.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--cg-border);
}

.side-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
}

.side-search {
  display: flex;
  gap: 8px;
  padding: 12px 14px 8px;
}

.quick-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 14px 10px;
}

.quick-tag {
  cursor: pointer;
}

.side-scroll {
  flex: 1;
  min-height: 0;
  padding: 0 8px 12px;
}

.sec-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 8px 6px;
  font-size: 12px;
  color: var(--cg-text-muted);
}

.hit {
  padding: 10px 12px;
  margin-bottom: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: all 0.15s;
}

.hit:hover {
  background: var(--cg-card-bg-soft);
}

.hit.active {
  background: var(--cg-brand-soft);
  border-color: var(--cg-brand);
}

.hit-title {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.5;
}

.hit-ico {
  margin-top: 3px;
  color: #e6a23c;
}

.hit-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 6px;
  font-size: 11.5px;
}

.hit-summary {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--cg-text-muted);
}

.cat-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  font-size: 13px;
  cursor: pointer;
  border-radius: 7px;
}

.cat-item:hover {
  background: var(--cg-card-bg-soft);
}

/* ---------- 右侧舞台 ---------- */

.stage {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.stage-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  background: var(--cg-card-bg);
  border: 1px solid var(--cg-border);
  border-radius: var(--cg-radius);
}

.url-pill {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--cg-text-muted);
  background: var(--cg-card-bg-soft);
  border-radius: 18px;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.screen {
  position: relative;
  flex: 1;
  min-height: 0;
  margin-top: 12px;
  background: var(--cg-hover-bg);
  border: 1px solid var(--cg-border);
  border-radius: var(--cg-radius);
  overflow: auto;
}

.screen-img {
  display: block;
  width: 100%;
  cursor: zoom-in;
}

.screen-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  padding: 40px 20px;
  color: var(--cg-text-muted);
  text-align: center;
}

.screen-hint h3 {
  margin: 6px 0 0;
  font-size: 16px;
  color: var(--cg-text);
}

.screen-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 8px;
}

/* 服务器不渲染页面时的大入口卡片 */
.entry-hint h3 {
  font-size: 18px;
  font-weight: 600;
}

.entry-hint .muted {
  max-width: 460px;
  margin: 0 auto;
  line-height: 1.7;
}

.entry-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  margin-top: 18px;
}

.entry-url {
  max-width: 520px;
  margin: 14px auto 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--cg-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frame-bad {
  position: absolute;
  top: 10px;
  left: 50%;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 14px;
  font-size: 12.5px;
  color: var(--cg-warning-text);
  background: var(--cg-warning-soft);
  border: 1px solid var(--cg-warning-border);
  border-radius: 20px;
  transform: translateX(-50%);
}

.open-error {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 14px;
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--cg-danger-text);
  background: var(--cg-danger-soft);
  border: 1px solid var(--cg-danger-border);
  border-radius: var(--cg-radius);
}

.open-error b {
  font-size: 13px;
}

.open-error p {
  margin: 4px 0 0;
}

/* ---------- 网页下方的悬浮提示框 ---------- */

.hint-dock {
  position: absolute;
  right: 14px;
  bottom: 14px;
  left: 14px;
  z-index: 20;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid #c7d2fe;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(8px);
}

.hint-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
  cursor: pointer;
  border-bottom: 1px solid #e8ecf7;
}

.hint-dock.collapsed .hint-head {
  border-bottom: none;
}

.hint-head-left {
  display: flex;
  gap: 8px;
  align-items: center;
}

.hint-ico {
  color: var(--cg-brand);
}

.hint-title {
  font-size: 13.5px;
  font-weight: 600;
}

.hint-toggle {
  color: var(--cg-text-muted);
}

.hint-body {
  max-height: 42vh;
  padding: 12px 14px 14px;
  overflow-y: auto;
}

.hint-banner {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 9px 12px;
  margin-bottom: 10px;
  font-size: 13px;
  line-height: 1.65;
  color: #1e3a8a;
  background: var(--cg-brand-soft);
  border-radius: 8px;
}

.hint-warn {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 12px;
  margin-bottom: 8px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--cg-warning-text);
  background: var(--cg-warning-soft);
  border: 1px solid var(--cg-warning-border);
  border-radius: 8px;
}

.hint-facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.fact {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 7px 10px;
  font-size: 12.5px;
  background: var(--cg-card-bg-soft);
  border-radius: 7px;
}

.fact-k {
  flex-shrink: 0;
  color: var(--cg-text-muted);
}

.fact-v {
  font-weight: 500;
  word-break: break-all;
}

.hint-keys {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.key-chip {
  padding: 4px 10px;
  font-size: 12px;
  background: var(--cg-brand-soft);
  border-radius: 14px;
}

.key-chip b {
  margin-right: 4px;
  color: var(--cg-brand);
}

.hint-steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hint-step {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  border-radius: 8px;
  transition: background 0.15s;
}

.hint-step.current {
  background: var(--cg-brand-soft);
  box-shadow: inset 3px 0 0 var(--cg-brand);
}

.hint-step.done {
  opacity: 0.62;
}

.step-main {
  flex: 1;
  min-width: 0;
}

.step-text {
  font-size: 13px;
  line-height: 1.7;
}

.step-done {
  text-decoration: line-through;
}

.step-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
  font-size: 11.5px;
}

.hint-nosteps {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: #475569;
  background: var(--cg-card-bg-soft);
  border-radius: 8px;
}

.hint-foot {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  margin-top: 10px;
  border-top: 1px dashed var(--cg-border);
}

.foot-left {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  font-size: 11.5px;
}

.foot-url {
  color: var(--cg-brand);
  text-decoration: underline;
}

.foot-right {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.preview-img {
  width: 100%;
}

.hint-rise-enter-active,
.hint-rise-leave-active {
  transition: transform 0.22s ease, opacity 0.22s ease;
}

.hint-rise-enter-from,
.hint-rise-leave-to {
  opacity: 0;
  transform: translateY(24px);
}

/* ---------- 窄屏 ---------- */

.mobile-switch {
  display: none;
}

.mobile-hide {
  display: none !important;
}

@media (max-width: 1100px) {
  .campus-page {
    flex-direction: column;
    gap: 10px;
    padding: 10px;
    overflow: hidden;
  }

  /* 二选一的切换条 */
  .mobile-switch {
    display: flex;
    flex: 0 0 auto;
    gap: 6px;
    padding: 4px;
    background: var(--cg-card-bg);
    border: 1px solid var(--cg-border);
    border-radius: 10px;
  }

  .switch-btn {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 38px;
    font-size: 14px;
    color: var(--cg-text-muted);
    cursor: pointer;
    background: transparent;
    border: none;
    border-radius: 7px;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .switch-btn.on {
    color: var(--platform-on-accent, #fff);
    background: var(--cg-brand);
  }

  .switch-badge {
    padding: 1px 7px;
    font-size: 11.5px;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.22);
  }

  .switch-btn:not(.on) .switch-badge {
    color: var(--cg-text-muted);
    background: var(--cg-hover-bg);
  }

  /* 两块内容各占满剩余高度，不再堆成长条 */
  .side {
    width: 100%;
    flex: 1 1 auto;
    max-height: none;
    min-height: 0;
  }

  .stage {
    flex: 1 1 auto;
    min-height: 0;
  }

  .hint-body {
    max-height: 46vh;
  }

  /* 工具条按钮在窄屏允许换行。
     注意要解开 flex-shrink: 0 —— 否则容器按内容宽度撑开、不肯收缩，
     最后一个按钮会被挤出可视区（截图里「自己去操作」就被切掉了）。 */
  .stage-bar {
    flex-wrap: wrap;
    gap: 8px;
  }

  .url-pill {
    flex: 1 1 100%;
  }

  .stage-actions {
    flex: 1 1 100%;
    min-width: 0;
    flex-shrink: 1;
    flex-wrap: wrap;
    gap: 6px;
  }

  .stage-actions :deep(.el-button) {
    margin-left: 0;
  }

  .hint-dock {
    left: 8px;
    right: 8px;
    bottom: 8px;
  }

  .hint-facts {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 560px) {
  .hint-facts {
    grid-template-columns: 1fr;
  }

  .hint-head {
    flex-wrap: wrap;
    gap: 6px;
  }

  .step-row {
    flex-wrap: wrap;
    gap: 6px;
  }

  .hint-dock {
    max-height: 62%;
  }
}
</style>
