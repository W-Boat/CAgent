import type { Directive, DirectiveBinding } from "vue"
import { useAuthStore } from "@/stores/auth"

/**
 * v-permission="'user:create'"
 * v-permission="['user:create','user:update']"  命中任意一个即显示
 * v-permission.all="['a','b']"                  必须全部命中
 * 不满足时直接从 DOM 中移除元素。
 */
function allowed(binding: DirectiveBinding): boolean {
  const value = binding.value
  if (!value) return true
  const codes = Array.isArray(value) ? (value as string[]) : [String(value)]
  if (codes.length === 0) return true
  const auth = useAuthStore()
  return binding.modifiers.all ? auth.canAll(codes) : auth.can(codes)
}

export const permissionDirective: Directive<HTMLElement, string | string[]> = {
  mounted(el, binding) {
    if (!allowed(binding)) el.parentNode?.removeChild(el)
  }
}