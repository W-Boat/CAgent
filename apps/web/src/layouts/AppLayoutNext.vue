<template>
  <div class="nx-root nx-shell">
    <!-- 手机端抽屉遮罩 -->
    <div v-if="isMobile && mobileOpen" class="nx-backdrop" aria-hidden="true" @click="closeMobileDrawer"></div>

    <aside
      id="nx-sidebar"
      ref="drawerRef"
      class="nx-sidebar"
      :class="{ rail: collapsed, open: isMobile && mobileOpen }"
      :role="isMobile && mobileOpen ? 'dialog' : undefined"
      :aria-label="isMobile && mobileOpen ? '导航菜单' : undefined"
      :aria-modal="isMobile && mobileOpen ? 'true' : undefined"
      :aria-hidden="isMobile && !mobileOpen ? 'true' : undefined"
      :inert="isMobile && !mobileOpen"
    >
      <div class="nx-brand" @click="router.push(auth.homePath)">
        <!-- CAgentMark 继承 currentColor：新版用主文字色做单色品牌印，扁平克制 -->
        <CAgentMark :size="26" class="nx-brand-logo" />
        <span v-if="showText" class="nx-brand-text">
          <span class="nx-brand-name">{{ auth.siteName }}</span>
          <span class="nx-brand-sub">校园智能体平台</span>
        </span>
        <button
          v-if="isMobile"
          ref="drawerCloseButton"
          type="button"
          class="nx-icon-btn nx-drawer-close"
          aria-label="关闭导航菜单"
          @click.stop="closeMobileDrawer"
        >
          <el-icon :size="18"><component :is="'Close'" /></el-icon>
        </button>
      </div>

      <nav ref="navRef" class="nx-nav">
        <template v-for="group in visibleGroups" :key="group.id">
          <button
            type="button"
            class="nx-nav-group-toggle"
            :class="{ active: group.id === activeGroupId }"
            :title="showText ? undefined : groupTooltip(group)"
            :aria-label="groupLabel(group)"
            :aria-expanded="!isGroupCollapsed(group.id)"
            :aria-controls="`nx-nav-items-${group.id}`"
            :aria-current="group.id === activeGroupId ? 'true' : undefined"
            @click="toggleGroup(group.id)"
          >
            <span v-if="showText" class="nx-nav-group-title">{{ group.title }}</span>
            <span v-else class="nx-sr-only">{{ group.title }}</span>
            <span v-if="showText && group.id === activeGroupId" class="nx-nav-current">当前</span>
            <span class="nx-nav-group-chevron" :class="{ collapsed: isGroupCollapsed(group.id) }" aria-hidden="true"></span>
          </button>

          <!--
            图标栏（折叠 / ≤1024px）下文字被隐藏，靠原生 title 提示目标；
            展开态文字可见，再加 title 只会和文本重复。
          -->
          <div
            :id="`nx-nav-items-${group.id}`"
            v-show="!isGroupCollapsed(group.id)"
            class="nx-nav-items"
          >
            <router-link
              v-for="item in group.items"
              :key="item.path"
              :to="item.path"
              class="nx-nav-item"
              :class="{ active: isActive(item.path) }"
              :title="showText ? undefined : itemTooltip(group, item)"
              :aria-current="isActive(item.path) ? 'page' : undefined"
              @mouseenter="warm(item.path)"
              @focus="warm(item.path)"
              @touchstart.passive="warm(item.path)"
            >
              <el-icon class="nx-nav-icon"><component :is="item.icon" /></el-icon>
              <span v-if="showText" class="nx-nav-text">{{ item.title }}</span>
              <span v-if="showText && item.badge" class="nx-nav-badge">{{ item.badge }}</span>
            </router-link>
          </div>
        </template>
      </nav>

      <div class="nx-sidebar-foot">
        <!-- 文案随折叠状态切换；图标栏下由样式转纵向排布，保证 64px 宽度装得下 -->
        <button
          v-if="!isMobile"
          type="button"
          class="nx-btn nx-btn-ghost nx-collapse"
          :title="collapsed ? '展开菜单' : '收起菜单'"
          @click="collapsed = !collapsed"
        >
          <el-icon><component :is="collapsed ? 'Expand' : 'Fold'" /></el-icon>
          <span>{{ collapsed ? "展开菜单" : "收起菜单" }}</span>
        </button>
      </div>
    </aside>

    <div class="nx-main">
      <header class="nx-topbar">
        <button
          v-if="isMobile"
          ref="drawerTrigger"
          type="button"
          class="nx-icon-btn nx-burger"
          :aria-label="mobileOpen ? '关闭菜单' : '打开菜单'"
          :aria-expanded="mobileOpen"
          aria-controls="nx-sidebar"
          @click="mobileOpen = !mobileOpen"
        >
          <el-icon :size="18"><component :is="mobileOpen ? 'Close' : 'Expand'" /></el-icon>
        </button>

        <!--
          新版不做面包屑：侧栏已承担「我在哪个区块」的空间感，
          顶栏只需要回答「当前在哪」一个问题。
        -->
        <h1 class="nx-topbar-title">{{ currentTitle }}</h1>

        <div class="nx-topbar-right">
          <el-tooltip v-if="theme.allowToggle" :content="theme.isDark ? '切换到浅色模式' : '切换到深色模式'" placement="bottom">
            <button type="button" class="nx-icon-btn" @click="theme.toggle()">
              <el-icon :size="17"><component :is="theme.isDark ? 'Sunny' : 'Moon'" /></el-icon>
            </button>
          </el-tooltip>

          <!--
            强调色设置：setAccent 同步写 localStorage 并落到 <html> 的
            --nx-accent-raw，派生色由 CSS 即时重算，无需确认/刷新。
          -->
          <el-popover v-if="!ui.managed" placement="bottom" :width="236" trigger="click">
            <template #reference>
              <button type="button" class="nx-icon-btn" aria-label="强调色" title="强调色">
                <el-icon :size="17"><Brush /></el-icon>
              </button>
            </template>
            <div class="nx-accent-pop">
              <div class="nx-accent-dots">
                <button
                  v-for="p in ACCENT_PRESETS"
                  :key="p.key"
                  type="button"
                  class="nx-accent-dot"
                  :class="{ 'is-on': ui.accent === p.value }"
                  :style="{ '--nx-dot': p.value }"
                  :title="p.label"
                  :aria-label="p.label"
                  @click="ui.setAccent(p.value)"
                ></button>
              </div>
              <p class="nx-accent-tip">强调色会同步应用于新版界面的全部页面与图表</p>
            </div>
          </el-popover>

          <el-tooltip content="新建对话" placement="bottom">
            <button type="button" class="nx-icon-btn nx-new-chat" @click="router.push('/chat')">
              <el-icon :size="17"><EditPen /></el-icon>
            </button>
          </el-tooltip>

          <el-tooltip content="接口文档" placement="bottom">
            <a class="nx-icon-btn nx-docs" href="/api/docs" target="_blank" rel="noreferrer">
              <el-icon :size="17"><Document /></el-icon>
            </a>
          </el-tooltip>

          <el-dropdown trigger="click" @command="onUserCommand">
            <div class="nx-user">
              <span class="nx-avatar nx-user-avatar">
                <img v-if="auth.user?.avatar" :src="auth.user.avatar" alt="" />
                <template v-else>{{ (auth.user?.name || "U").slice(0, 1) }}</template>
              </span>
              <span class="nx-user-meta">
                <span class="nx-user-name">{{ auth.displayName }}</span>
                <span class="nx-user-role">{{ roleLabel }}</span>
              </span>
              <el-icon class="nx-user-caret" :size="12"><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">
                  <el-icon><User /></el-icon>个人设置
                </el-dropdown-item>
                <el-dropdown-item command="usage">
                  <el-icon><DataLine /></el-icon>我的用量
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided>
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main
        class="nx-content"
        :class="{ 'nx-content-full': isFullscreen }"
        :inert="isMobile && mobileOpen"
        :aria-hidden="isMobile && mobileOpen ? 'true' : undefined"
      >
        <router-view v-slot="{ Component }">
          <!--
            切页淡入，刻意**不用** mode="out-in"（与经典外壳同一决策）：
            out-in 会等旧页面完全离场才渲染新页面，对 keep-alive 缓存页
            等于凭空加一段串行等待，与「秒开」目标相反。
            只给进入做淡入，旧节点立即移除；只动 opacity 不动 transform，
            避免滚动容器在过渡期间被位移撑出横向抖动。
          -->
          <transition name="page">
            <keep-alive :include="keepAlive">
              <component :is="Component" />
            </keep-alive>
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { menuGroups, collectKeepAliveNames, verifyKeepAliveComponents } from "@/router/routes"
import { useAuthStore } from "@/stores/auth"
import { useThemeStore } from "@/stores/theme"
import { ACCENT_PRESETS, useUiStore } from "@/stores/ui"
import { roleText } from "@/utils/format"
import { registerClosable } from "@/utils/back-navigation"
import { prefetchByPath } from "@/utils/prefetch"
import CAgentMark from "@/components/CAgentMark.vue"

const auth = useAuthStore()
const theme = useThemeStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()

/** 折叠状态持久化键：存 "1"/"0"，读写都容忍 localStorage 不可用 */
const SIDEBAR_COLLAPSED_KEY = "cagent-sidebar-collapsed"
const SIDEBAR_GROUPS_KEY = "cagent-sidebar-collapsed-groups"

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
  } catch {
    /* 隐私模式等场景读不到就按展开走 */
    return false
  }
}

/** 桌面端折叠成图标栏：启动时恢复上次的选择 */
const collapsed = ref(readCollapsed())

function readCollapsedGroups(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const value = JSON.parse(window.localStorage.getItem(SIDEBAR_GROUPS_KEY) || "[]")
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [])
  } catch {
    return new Set()
  }
}

/** 每组的收起状态单独保存；新组默认展开，路由所在组会自动展开。 */
const collapsedGroupIds = ref(readCollapsedGroups())

watch(collapsedGroupIds, (ids) => {
  try {
    window.localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify([...ids]))
  } catch {
    /* 存储不可用时仍可在当前会话中折叠分组 */
  }
})

watch(collapsed, (value) => {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? "1" : "0")
  } catch {
    /* 写不进去就只在当前会话生效 */
  }
})

/** 手机端抽屉打开状态：默认收起 */
const mobileOpen = ref(false)
const drawerRef = ref<HTMLElement>()
const drawerCloseButton = ref<HTMLButtonElement>()
const drawerTrigger = ref<HTMLButtonElement>()

function closeMobileDrawer() {
  mobileOpen.value = false
}

/**
 * 需要缓存的视图组件名，从路由 meta.keepAlive 自动派生。
 * keep-alive 的 include 匹配组件名而非路由名，约定见 routes.ts。
 */
const keepAlive = ref<string[]>(collectKeepAliveNames())

/** 手机端（≤768px）：侧边栏是浮层抽屉 */
const mobileQuery =
  typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)") : null
const isMobile = ref(mobileQuery?.matches ?? false)

/** 窄屏（≤1024px）：侧边栏强制转 64px 图标栏，文字全部隐藏 */
const railQuery =
  typeof window !== "undefined" ? window.matchMedia("(max-width: 1024px)") : null
const isRail = ref(railQuery?.matches ?? false)

function syncMobile(matches: boolean) {
  isMobile.value = matches
  // 进出移动端都把抽屉复位，避免「回到宽屏抽屉还开着」的错乱
  mobileOpen.value = false
}

let stopMobileWatch: (() => void) | undefined
let stopRailWatch: (() => void) | undefined

let drawerReturnFocus: HTMLElement | null = null

function drawerFocusableElements(): HTMLElement[] {
  const drawer = drawerRef.value
  if (!drawer) return []
  return Array.from(
    drawer.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'))
}

function handleDrawerKeydown(event: KeyboardEvent) {
  if (!isMobile.value || !mobileOpen.value) return
  if (event.key === "Escape") {
    event.preventDefault()
    closeMobileDrawer()
    return
  }
  if (event.key !== "Tab") return

  const focusable = drawerFocusableElements()
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) {
    event.preventDefault()
    drawerCloseButton.value?.focus()
    return
  }

  const active = document.activeElement
  if (!drawerRef.value?.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => isMobile.value && mobileOpen.value,
  (open) => {
    if (open) {
      const active = document.activeElement
      drawerReturnFocus = active instanceof HTMLElement ? active : drawerTrigger.value ?? null
      document.addEventListener("keydown", handleDrawerKeydown, true)
      void nextTick(() => {
        ;(drawerCloseButton.value ?? drawerFocusableElements()[0])?.focus()
      })
      return
    }

    document.removeEventListener("keydown", handleDrawerKeydown, true)
    const returnTarget = drawerReturnFocus
    drawerReturnFocus = null
    if (returnTarget) {
      void nextTick(() => {
        if (returnTarget.isConnected) returnTarget.focus()
      })
    }
  }
)

onMounted(() => {
  /*
   * 开发模式自检：keepAlive 路由的组件名是否匹配。
   * 不匹配时缓存静默失效（页面照常显示，只是每次都在重新加载）。
   */
  if (import.meta.env.DEV) {
    void verifyKeepAliveComponents()
  }

  syncMobile(isMobile.value)
  const handler = (e: MediaQueryListEvent) => syncMobile(e.matches)
  mobileQuery?.addEventListener("change", handler)
  stopMobileWatch = () => mobileQuery?.removeEventListener("change", handler)

  const railHandler = (e: MediaQueryListEvent) => (isRail.value = e.matches)
  railQuery?.addEventListener("change", railHandler)
  stopRailWatch = () => railQuery?.removeEventListener("change", railHandler)
})

onBeforeUnmount(() => {
  stopMobileWatch?.()
  stopRailWatch?.()
  document.removeEventListener("keydown", handleDrawerKeydown, true)
})

// 手机端点菜单跳转后自动收起抽屉
watch(
  () => route.fullPath,
  () => {
    if (isMobile.value) mobileOpen.value = false
  }
)

/** 菜单滚动容器：用于定位当前激活项 */
const navRef = ref<HTMLElement>()

/*
 * 移动端抽屉接管返回键：抽屉展开时按返回键应关抽屉而不是退出页面。
 * 登记一次、用 isOpen 实时求值（原因见 utils/back-navigation.ts 文件头）。
 */
const unregisterDrawer = registerClosable({
  name: "app-sidebar",
  isOpen: () => isMobile.value && mobileOpen.value,
  close: () => {
    mobileOpen.value = false
  }
})

onBeforeUnmount(unregisterDrawer)

/*
 * 菜单可见性 = 权限 ∩ 功能开关（与经典外壳同一规则）：
 * permission 决定「你有没有资格」，feature 决定「平台开没开」，
 * 两者都要过，缺一不可。
 */
const visibleGroups = computed(() =>
  menuGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          auth.can(item.permission) &&
          (!item.feature || auth.featureOn(item.feature))
      )
    }))
    .filter((group) => group.items.length > 0)
)

const activeGroupId = computed(() =>
  visibleGroups.value.find((group) => group.items.some((item) => isActive(item.path)))?.id
)

function isGroupCollapsed(groupId: string): boolean {
  return collapsedGroupIds.value.has(groupId)
}

function setGroupCollapsed(groupId: string, collapsed: boolean) {
  const next = new Set(collapsedGroupIds.value)
  if (collapsed) next.add(groupId)
  else next.delete(groupId)
  collapsedGroupIds.value = next
}

function toggleGroup(groupId: string) {
  setGroupCollapsed(groupId, !isGroupCollapsed(groupId))
}

function groupLabel(group: (typeof visibleGroups.value)[number]): string {
  const state = isGroupCollapsed(group.id) ? "已收起，点击展开" : "已展开，点击收起"
  return `${group.title}${group.id === activeGroupId.value ? "，当前路由所在分组" : ""}，${state}`
}

function groupTooltip(group: (typeof visibleGroups.value)[number]): string {
  return `${group.title}${group.id === activeGroupId.value ? " · 当前路由" : ""} · ${isGroupCollapsed(group.id) ? "展开分组" : "收起分组"}`
}

function itemTooltip(group: (typeof visibleGroups.value)[number], item: (typeof group.items)[number]): string {
  return [item.title, item.badge, group.title].filter(Boolean).join(" · ")
}

/* 深链/刷新时展开当前组；窄栏下组按钮仍可操作，当前项 tooltip 也标明组名。 */
watch(
  [() => route.path, activeGroupId],
  ([, groupId]) => {
    if (groupId && isGroupCollapsed(groupId)) setGroupCollapsed(groupId, false)
    void nextTick(() => {
      navRef.value?.querySelector(".nx-nav-item.active")?.scrollIntoView({ block: "nearest" })
    })
  },
  { immediate: true }
)

/** 是否渲染侧栏文字：手机抽屉永远显示；桌面在折叠态与 ≤1024px 图标栏下隐藏 */
const showText = computed(() => isMobile.value || (!collapsed.value && !isRail.value))

function isActive(path: string): boolean {
  // /chat 带 id 参数（/chat/:id?），必须按前缀匹配才算激活
  if (path === "/chat") return route.path.startsWith("/chat")
  return route.path === path || route.path.startsWith(`${path}/`)
}

/**
 * 菜单预取：hover / 键盘聚焦 / 手指按下时提前拉取目标页 chunk。
 * 从悬停到点击通常有 100~300ms，足够把动态 import 的下载提前完成；
 * 重复调用幂等（见 utils/prefetch.ts）。
 */
function warm(path: string) {
  prefetchByPath(path)
}

const currentTitle = computed(() => (route.meta.title as string) || "工作台")
const isFullscreen = computed(() => Boolean(route.meta.fullscreen))

const roleLabel = computed(() => {
  const keys = auth.roles || []
  if (keys.length === 0) return "访客"
  return keys.map((k) => roleText(k)).join(" / ")
})

async function onUserCommand(command: string) {
  if (command === "profile") {
    router.push("/profile")
  } else if (command === "usage") {
    router.push("/usage")
  } else if (command === "logout") {
    try {
      await ElMessageBox.confirm("确定要退出登录吗？", "提示", {
        type: "warning",
        confirmButtonText: "退出",
        cancelButtonText: "取消"
      })
    } catch {
      return
    }
    await auth.logout()
    router.replace("/login")
  }
}
</script>

<style scoped>
/* ---------- 整页骨架 ---------- */
.nx-shell {
  display: flex;
  height: 100dvh;
  overflow: hidden;
  background: var(--nx-bg);
}

/* ---------- 侧边栏 ---------- */
.nx-sidebar {
  display: flex;
  flex-direction: column;
  flex: 0 0 var(--nx-sidebar-width);
  width: var(--nx-sidebar-width);
  background: var(--nx-bg);
  /* 与内容区只用一条发丝线分隔，不投影 —— 扁平设计的核心语言 */
  border-right: 1px solid var(--nx-border);
  transition: width 0.22s ease, flex-basis 0.22s ease;
}

.nx-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--nx-topbar-height);
  flex: 0 0 var(--nx-topbar-height);
  padding: 0 16px;
  cursor: pointer;
  /* 与顶栏同高，让横向发丝线连成一条 */
  border-bottom: 1px solid var(--nx-border);
  overflow: hidden;
}

.nx-brand-logo {
  color: var(--nx-text);
  /* 品牌印 hover 变色与其他 hover 过渡统一为 0.15s */
  transition: color 0.15s ease;
}

.nx-brand:hover .nx-brand-logo {
  color: var(--nx-accent);
}

.nx-drawer-close {
  flex: 0 0 auto;
  margin-left: auto;
}

.nx-brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
  white-space: nowrap;
}

.nx-brand-name {
  font-size: 13.5px;
  font-weight: 650;
  color: var(--nx-text);
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nx-brand-sub {
  font-size: 11px;
  color: var(--nx-text-3);
}

.nx-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px 16px;
}

/* 可折叠分组；图标栏也保留一个小型可操作控件。 */
.nx-nav-group-toggle {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  margin: 5px 0 2px;
  padding: 4px 10px;
  color: var(--nx-text-3);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.nx-nav-group-toggle:hover {
  color: var(--nx-text-2);
  background: var(--nx-surface-hover);
}

.nx-nav-group-toggle:focus-visible {
  outline: none;
  box-shadow: var(--nx-focus-ring);
}

.nx-nav-group-toggle.active {
  color: var(--nx-accent);
}

.nx-nav-group-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nx-nav-current {
  flex: 0 0 auto;
  padding: 1px 5px;
  border: 1px solid var(--nx-accent-border);
  border-radius: 999px;
  color: var(--nx-accent);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.4;
}

.nx-nav-group-chevron {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translateY(-2px);
  transition: transform 0.15s ease;
}

.nx-nav-group-chevron.collapsed {
  transform: rotate(-45deg);
}

.nx-nav-items {
  min-width: 0;
}

.nx-nav-badge {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 1px 5px;
  border: 1px solid var(--nx-accent-border);
  border-radius: 999px;
  color: var(--nx-accent);
  font-size: 9px;
  font-weight: 600;
  line-height: 1.4;
}

.nx-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* 菜单行：36px 高、8px 圆角、扁平灰悬停、accent 浅底激活 */
.nx-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  margin-bottom: 2px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--nx-text-2);
  text-decoration: none;
  white-space: nowrap;
  border-radius: 8px;
  transition: background 0.15s ease, color 0.15s ease;
}

.nx-nav-item:hover {
  color: var(--nx-text);
  background: var(--nx-surface-hover);
}

.nx-nav-item:focus-visible {
  outline: none;
  box-shadow: var(--nx-focus-ring);
}

/* 左缘 3px accent 竖条：只在激活态出现，圆角收口并渐显（淡入而非突现） */
.nx-nav-item::before {
  content: "";
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 18px;
  background: var(--nx-accent);
  border-radius: 999px;
  opacity: 0;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.nx-nav-item.active {
  color: var(--nx-accent);
  font-weight: 600;
  background: var(--nx-accent-soft);
}

.nx-nav-item.active::before {
  transform: translateY(-50%) scaleY(1);
  opacity: 1;
}

.nx-nav-icon {
  font-size: 16px;
  flex: 0 0 16px;
}

.nx-nav-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nx-sidebar-foot {
  flex: 0 0 auto;
  padding: 10px 12px;
  border-top: 1px solid var(--nx-border);
}

.nx-collapse {
  width: 100%;
  justify-content: center;
  gap: 8px;
}

/* ---------- 主区域 ---------- */
.nx-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.nx-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--nx-topbar-height);
  flex: 0 0 var(--nx-topbar-height);
  padding: 0 16px;
  background: var(--nx-bg);
  border-bottom: 1px solid var(--nx-border);
}

.nx-burger {
  flex: 0 0 auto;
}

.nx-topbar-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--nx-text);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nx-topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.nx-docs {
  text-decoration: none;
}

/* ---------- 强调色设置弹层 ---------- */
/*
 * 弹层内容默认传送到 body（.nx-root 令牌取不到）：
 * 文案颜色用 Element Plus 的文本变量，明暗模式都能正确解析；
 * 色点颜色经内联自定义属性传入，不依赖作用域令牌。
 */
.nx-accent-dots {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.nx-accent-dot {
  position: relative;
  width: 26px;
  height: 26px;
  padding: 0;
  cursor: pointer;
  background: var(--nx-dot);
  border: 0;
  border-radius: 50%;
  transition: transform 0.15s ease;
}

.nx-accent-dot:hover {
  transform: scale(1.1);
}

/* 选中态 2px 外圈：与色点留 3px 空隙，浅底深底上都清晰 */
.nx-accent-dot.is-on::after {
  content: "";
  position: absolute;
  inset: -5px;
  border: 2px solid var(--nx-dot);
  border-radius: 50%;
}

.nx-accent-tip {
  margin: 10px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--el-text-color-secondary, #909399);
}

/* 用户区：点开 el-dropdown 的触发器 */
.nx-user {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-left: 6px;
  padding: 4px 8px 4px 4px;
  cursor: pointer;
  border-radius: 999px;
  transition: background 0.15s ease;
  outline: none;
}

.nx-user:hover {
  background: var(--nx-surface-hover);
}

.nx-user-avatar {
  width: 26px;
  height: 26px;
}

.nx-user-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.nx-user-name {
  max-width: 9em;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 550;
  color: var(--nx-text);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nx-user-role {
  font-size: 11px;
  color: var(--nx-text-3);
}

.nx-user-caret {
  color: var(--nx-text-3);
}

/* ---------- 内容区 ---------- */
.nx-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--nx-bg);
}

.nx-content-full {
  /* 对话这类沉浸式页面自己管滚动，外壳不滚 */
  overflow: hidden;
}

/* 切页淡入：只做进入（理由见模板注释），时长与经典版一致 */
.page-enter-active {
  transition: opacity 0.16s ease-out;
}

.page-enter-from {
  opacity: 0;
}

/* ---------- 图标栏（桌面折叠 / ≤1024px） ---------- */
.nx-sidebar.rail {
  flex: 0 0 64px;
  width: 64px;
}

.nx-sidebar.rail .nx-brand {
  padding: 0;
  justify-content: center;
}

.nx-sidebar.rail .nx-nav {
  padding: 10px 8px 16px;
}

.nx-sidebar.rail .nx-nav-item {
  justify-content: center;
  padding: 0;
}

.nx-sidebar.rail .nx-nav-group-toggle {
  min-height: 24px;
  justify-content: center;
  margin: 7px 0 4px;
  padding: 4px 0;
}

.nx-sidebar.rail .nx-nav-current {
  display: none;
}

.nx-sidebar.rail .nx-nav-item::before {
  left: -8px;
}

/* 图标栏下收起按钮转纵向（图标在上、文案在下）：文案随状态切换仍要装进 64px 宽度 */
.nx-sidebar.rail .nx-sidebar-foot {
  padding: 8px 6px;
}

.nx-sidebar.rail .nx-collapse {
  flex-direction: column;
  gap: 3px;
  height: auto;
  padding: 8px 2px;
  font-size: 11px;
}

.nx-sidebar.rail .nx-collapse .el-icon {
  font-size: 15px;
}

@media (max-width: 1024px) {
  /* 窄屏强制图标栏：文字隐藏，汉堡由折叠状态接管 */
  .nx-sidebar,
  .nx-sidebar.rail {
    flex: 0 0 64px;
    width: 64px;
  }

  .nx-brand {
    padding: 0;
    justify-content: center;
  }

  .nx-brand-text,
  .nx-nav-text,
  .nx-nav-group-title,
  .nx-nav-current,
  .nx-user-meta {
    display: none;
  }

  .nx-nav {
    padding: 10px 8px 16px;
  }

  .nx-nav-item {
    justify-content: center;
    padding: 0;
  }

  .nx-nav-item::before {
    left: -8px;
  }

  /* 窄屏图标栏下的收起按钮与桌面折叠态同款纵向布局 */
  .nx-sidebar-foot {
    padding: 8px 6px;
  }

  .nx-collapse {
    flex-direction: column;
    gap: 3px;
    height: auto;
    padding: 8px 2px;
    font-size: 11px;
  }

  .nx-collapse .el-icon {
    font-size: 15px;
  }
}

/* ---------- 手机抽屉（≤768px） ---------- */
@media (max-width: 768px) {
  .nx-shell {
    position: relative;
  }

  .nx-sidebar,
  .nx-sidebar.rail {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 100;
    width: 264px;
    flex-basis: 264px;
    padding: 0;
    background: var(--nx-bg);
    transform: translateX(-100%);
    transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .nx-sidebar.open {
    transform: translateX(0);
    box-shadow: var(--nx-shadow-lg);
  }

  /* 抽屉恢复完整信息密度 */
  .nx-brand {
    padding: 0 16px;
    justify-content: flex-start;
  }

  .nx-brand-text,
  .nx-nav-text,
  .nx-nav-group-title,
  .nx-nav-current {
    display: flex;
  }

  .nx-brand-text {
    flex-direction: column;
  }

  .nx-nav {
    padding: 10px 12px 16px;
  }

  .nx-sidebar.rail .nx-nav {
    padding: 10px 12px 16px;
  }

  .nx-nav-item {
    justify-content: flex-start;
    padding: 0 10px;
  }

  .nx-sidebar.rail .nx-nav-item {
    justify-content: flex-start;
    padding: 0 10px;
  }

  .nx-nav-item::before {
    left: -12px;
  }

  .nx-sidebar.rail .nx-nav-item::before {
    left: -12px;
  }

  .nx-sidebar.rail .nx-nav-group-toggle {
    min-height: 30px;
    justify-content: flex-start;
    margin: 5px 0 2px;
    padding: 4px 10px;
  }

  .nx-sidebar.rail .nx-nav-current {
    display: inline-flex;
  }

  /* 抽屉模式下不需要折叠按钮 */
  .nx-sidebar-foot {
    display: none;
  }

  .nx-backdrop {
    position: absolute;
    inset: 0;
    z-index: 99;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
  }

  .nx-topbar {
    padding: 0 10px;
    gap: 8px;
  }

  /* 手机上收起接口文档这类低频入口，保留主题切换与新建对话 */
  .nx-docs {
    display: none;
  }

  .nx-content {
    padding-bottom: env(safe-area-inset-bottom);
  }
}

@media (prefers-reduced-motion: reduce) {
  .nx-sidebar,
  .nx-nav-group-toggle,
  .nx-nav-group-chevron,
  .nx-nav-item,
  .nx-nav-item::before {
    transition-duration: 0.01ms !important;
  }
}

/* ---------- 手机窄屏（≤640px） ---------- */
@media (max-width: 640px) {
  /*
   * 右侧只留主题 / 强调色 / 用户头像：新建对话与接口文档这类
   * 低频入口收起（接口文档在 ≤768px 已隐藏）。
   * 页面标题本身已是 flex:1 + ellipsis，空间不足时自动截断。
   */
  .nx-new-chat {
    display: none;
  }
}

/* ---------- 触控优化 ---------- */
@media (hover: none) and (pointer: coarse) {
  .nx-nav-item {
    min-height: 44px;
  }
}

@media (min-width: 769px) {
  .nx-drawer-close {
    display: none;
  }
}
</style>
