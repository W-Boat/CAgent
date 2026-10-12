// Only live messages may play effects, and switching conversations cannot replay them.
const played = new Set<string>()
export function claimEffect(key: string) {
  if (played.has(key)) return false
  played.add(key)
  if (played.size > 1000) played.delete(played.values().next().value!)
  return true
}
