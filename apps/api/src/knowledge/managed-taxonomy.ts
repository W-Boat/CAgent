/** Optional, bounded classification for managed libraries. Never changes access scope. */
export function managedTaxonomy(entry: {externalKey?: string | null; baseId: string; base: {name: string; connection?: unknown}}): {sectionPath?: string[]; sectionKey?: string} {
  const connection = entry.base.connection as any
  const taxonomy = connection && !Array.isArray(connection) ? connection.taxonomy : null
  if (!taxonomy || typeof taxonomy !== 'object' || Array.isArray(taxonomy)) return {}
  const prefix = taxonomy.entryPrefix
  if (typeof prefix !== 'string' || !/^[a-z0-9][a-z0-9:_-]{0,78}:$/.test(prefix)
    || typeof entry.externalKey !== 'string' || !entry.externalKey.startsWith(prefix)
    || !Array.isArray(taxonomy.topics) || taxonomy.topics.length > 32) return {}
  const key = entry.externalKey.slice(prefix.length).split(':')[0]
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(key)) return {}
  const topics = taxonomy.topics.filter((topic: any) => topic && typeof topic === 'object' && !Array.isArray(topic)
    && typeof topic.key === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(topic.key)
    && typeof topic.label === 'string' && topic.label.trim().length > 0 && topic.label.length <= 60
    && !/[\r\n\u0000-\u001f]/.test(topic.label))
  const matches = topics.filter((topic: any) => topic.key === key)
  if (matches.length !== 1) return {}
  return {sectionPath: [entry.base.name, matches[0].label.trim()], sectionKey: `${entry.baseId}:${key}`}
}
