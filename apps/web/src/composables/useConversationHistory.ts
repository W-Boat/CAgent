import { nextTick, ref, watch, type Ref } from 'vue'
import { conversationsApi } from '@/api'
import type { MessageItem } from '@/api/types'
import { errorMessage } from '@/api/client'

export function useConversationHistory<T extends { id: string }>(
  activeId: Ref<string>, messages: Ref<T[]>, scrollEl: Ref<HTMLElement | undefined>,
  map: (item: MessageItem) => T, onLoaded: (id: string) => void,
  scrollBottom: () => Promise<void>
) {
  const loadingMessages = ref(false), historyError = ref(''), loadingEarlier = ref(false)
  const hasEarlier = ref(false)
  let generation = 0, cursor: string | undefined
  watch(activeId, () => {
    generation++; loadingMessages.value = false; loadingEarlier.value = false
    historyError.value = ''; hasEarlier.value = false; cursor = undefined
  }, { flush: 'sync' })
  const visible = (items: MessageItem[]) => items.filter(m => m.role === 'user' || m.role === 'assistant').map(map)
  async function loadMessages(id: string) {
    const request = ++generation
    messages.value = []; historyError.value = ''; loadingMessages.value = true; hasEarlier.value = false
    try {
      const page = await conversationsApi.messages(id, { latest: 'true', pageSize: 100 })
      if (request !== generation || id !== activeId.value) return
      messages.value = visible(page.items)
      cursor = page.nextBeforeId || page.items[0]?.id
      hasEarlier.value = Boolean(page.hasMore)
      onLoaded(id)
      await scrollBottom()
    } catch (error) {
      if (request === generation && id === activeId.value) historyError.value = errorMessage(error) || '消息加载失败'
    } finally {
      if (request === generation) loadingMessages.value = false
    }
  }
  async function loadEarlier() {
    if (!cursor || !activeId.value || loadingEarlier.value || loadingMessages.value) return
    const request = generation, id = activeId.value, beforeId = cursor
    loadingEarlier.value = true; historyError.value = ''
    try {
      const page = await conversationsApi.messages(id, { latest: 'true', beforeId, pageSize: 100 })
      if (request !== generation || id !== activeId.value) return
      const el = scrollEl.value, height = el?.scrollHeight || 0, top = el?.scrollTop || 0
      const existing = new Set(messages.value.map(m => m.id))
      messages.value = [...visible(page.items).filter(m => !existing.has(m.id)), ...messages.value]
      cursor = page.nextBeforeId || page.items[0]?.id
      hasEarlier.value = Boolean(page.hasMore)
      await nextTick()
      if (el && request === generation) el.scrollTop = top + el.scrollHeight - height
    } catch (error) {
      if (request === generation) historyError.value = errorMessage(error) || '更早消息加载失败'
    } finally {
      if (request === generation) loadingEarlier.value = false
    }
  }
  return { loadingMessages, historyError, loadingEarlier, hasEarlier, loadMessages, loadEarlier }
}
