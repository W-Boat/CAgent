import { watch, type Ref } from 'vue'

/** Page-local drafts never cross accounts or persist private text to browser storage. */
export function useConversationDraft(activeId: Ref<string>, draft: Ref<string>, images: Ref<string[]>) {
  const drafts = new Map<string, { text: string; images: string[] }>()
  watch(activeId, (id, previous) => {
    if (draft.value || images.value.length) drafts.set(previous, { text: draft.value, images: [...images.value] })
    else drafts.delete(previous)
    draft.value = drafts.get(id)?.text || ''
    images.value = [...(drafts.get(id)?.images || [])]
  }, { flush: 'sync' })
}
