import { defineStore } from "pinia"

/**
 * 校园网模式。
 *
 * ── 需求 ──
 * 每次进入平台询问「是否已连接校园网」；选择校园网后，默认模型调用
 * 优先走学校本地化部署的两个模型（见 utils/skill-presets.ts 的
 * CAMPUS_MODEL_KEYS，10.27.66.12 仅校园网可达）。
 *
 * ── 为什么放 sessionStorage ──
 * 「每次进入都问」= 每个浏览器标签会话问一次：sessionStorage 在标签关闭后
 * 清空、刷新与站内跳转保持 —— 正好是这个语义。localStorage 会让询问变成
 * 「只在第一次问」，不符合需求。
 *
 * ── 提醒 ──
 * 模型请求由**后端**发起：后端所在机器必须能路由到 10.27.66.12（校内地址）。
 * 本地开发/校内部署可直接用；公有云上的生产后端默认不可达，此时校内模型
 * 调用会失败回落报错 —— pickDefaultModel 只在「清单里真的有校内模型」时
 * 才选它，未部署场景不受影响。
 */

const ANSWERED_KEY = "cagent-campusnet-answered"
const CAMPUS_KEY = "cagent-campusnet-campus"

function sessionGet(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function sessionSet(key: string, value: string) {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    /* 存不了就只在当前会话内存里生效 */
  }
}

export const useCampusNetStore = defineStore("campus-net", {
  state: () => ({
    /** 本次标签会话是否已经回答过询问 */
    answered: sessionGet(ANSWERED_KEY) === "1",
    /** 用户是否选择「已连接校园网」 */
    campus: sessionGet(CAMPUS_KEY) === "1"
  }),

  getters: {
    /** 弹窗可见：本次会话还没回答过 */
    needAsk: (state) => !state.answered
  },

  actions: {
    answer(campus: boolean) {
      this.campus = campus
      this.answered = true
      sessionSet(ANSWERED_KEY, "1")
      sessionSet(CAMPUS_KEY, campus ? "1" : "0")
    },
    /** 设置页/对话页允许改主意（不重置 asked，不再弹窗） */
    setCampus(campus: boolean) {
      this.campus = campus
      sessionSet(CAMPUS_KEY, campus ? "1" : "0")
    }
  }
})
