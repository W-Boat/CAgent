/** Login redirects stay inside this application, including encoded/backslash URLs. */
export function safeAuthRedirect(value: unknown, fallback: string, origin: string): string {
  if (typeof value !== 'string' || !/^\/(?!\/)/.test(value) || /[\\\u0000-\u001f]/.test(value)) return fallback
  try {
    const target = new URL(value, origin)
    if (target.origin !== origin || /^\/(login|register)(\/|$)/.test(target.pathname)) return fallback
    return target.pathname + target.search + target.hash
  } catch { return fallback }
}
