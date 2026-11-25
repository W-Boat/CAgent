import { BadRequestException, ConflictException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'

export type Row = Record<string, any>
type Table = { model: string; identity: string[]; fields: string[]; preserve?: string[] }
export const tables = {
  providers: { model: 'Provider', identity: ['key'], fields: ['id', 'key', 'name', 'type', 'baseUrl', 'apiKey', 'enabled', 'isSystem', 'sort', 'description', 'extra'] },
  keys: { model: 'ProviderApiKey', identity: ['providerId', 'apiKey'], fields: ['id', 'providerId', 'apiKey', 'label', 'enabled', 'sort'] },
  models: { model: 'Model', identity: ['providerId', 'key'], fields: ['id', 'providerId', 'key', 'name', 'enabled', 'isDefault', 'sort', 'contextWindow', 'maxOutputTokens', 'supportsVision', 'supportsTools', 'supportsStream', 'inputPricePerM', 'outputPricePerM', 'description', 'extra'] },
  skills: { model: 'Skill', identity: ['key'], fields: ['id', 'key', 'name', 'description', 'category', 'type', 'enabled', 'isSystem', 'icon', 'sort', 'note', 'systemPrompt', 'inputSchema', 'config', 'permissionCode', 'createdById'], preserve: ['createdById'] },
  agents: { model: 'Agent', identity: ['key'], fields: ['id', 'key', 'name', 'description', 'avatar', 'systemPrompt', 'greeting', 'starters', 'mode', 'note', 'modelId', 'ownerId', 'enabled', 'visibility', 'isSystem', 'sort', 'allowBrowser', 'temperature', 'maxToolRounds', 'maxContextMessages'], preserve: ['ownerId'] },
  bindings: { model: 'AgentSkill', identity: ['agentId', 'skillId'], fields: ['agentId', 'skillId', 'sort', 'config'] },
  bases: { model: 'KnowledgeBase', identity: ['id'], fields: ['id', 'name', 'description', 'kind', 'mounted', 'agentId', 'connection', 'passwordEncrypted', 'lastSyncAt', 'aiReviewEnabled', 'aiSummaryEnabled', 'automationModelId', 'automationUserId'] },
  entries: { model: 'KnowledgeEntry', identity: ['baseId', 'questionKey'], fields: ['id', 'baseId', 'externalKey', 'title', 'question', 'questionKey', 'answer', 'summary', 'aiReviewStatus', 'aiReview', 'automationFingerprint', 'automationUpdatedAt', 'aliases', 'url', 'mode', 'status', 'priority', 'source'] },
  guide: { model: 'CampusGuideItem', identity: ['externalId'], fields: ['id', 'externalId', 'title', 'url', 'cat', 'type', 'source', 'name', 'dept', 'place', 'tel', 'campus', 'form', 'officeTime', 'contact', 'login', 'access', 'detailStatus', 'subtype', 'summaryShort', 'detail', 'steps', 'keyFacts', 'detailParts', 'extra', 'verifiedAt', 'note', 'searchText'] },
  settings: { model: 'Setting', identity: ['key'], fields: ['key', 'value', 'group', 'description'] },
} satisfies Record<string, Table>
export type Section = keyof typeof tables
export const sections = Object.keys(tables) as Section[]
const models = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]))
const enums = new Map(Prisma.dmmf.datamodel.enums.map(type => [type.name, type.values.map(value => value.name)]))

export function table(section: Section) {
  const spec: Table = tables[section]
  const model = models.get(spec.model)!
  const fields = new Map(model.fields.map(field => [field.name, field]))
  const primary = spec.fields.includes('id') ? ['id'] : spec.identity
  return { ...spec, model, fields, primary, db: txDelegate(spec.model) }
}

function txDelegate(name: string) {
  return (tx: Prisma.TransactionClient) => (tx as unknown as Record<string, {
    findMany(args: { select: Record<string, boolean>; where?: Row }): Promise<Row[]>
  }>)[name[0].toLowerCase() + name.slice(1)]
}

export function selectFields(fields: string[]) {
  return Object.fromEntries(fields.map(key => [key, true]))
}

export function validateRows(section: Section, value: unknown) {
  if (!Array.isArray(value) || value.length > (section === 'guide' ? 160000 : 35000)) throw new BadRequestException(`备份分区无效：${section}`)
  const spec = table(section)
  const identities = new Set<string>(), ids = new Set<string>(), external = new Set<string>()
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== tables[section].fields.length) throw new BadRequestException(`备份记录格式无效：${section}`)
    for (const key of tables[section].fields) {
      const field = spec.fields.get(key)!, v = row[key]
      if (!Object.hasOwn(row, key) || !validField(field.type, field.isRequired, v)) throw new BadRequestException(`备份记录字段无效：${section}.${key}`)
    }
    const identity = identityOf(row, spec.identity), primary = identityOf(row, spec.primary)
    if (identities.has(identity) || ids.has(primary)) throw new BadRequestException(`备份中存在重复记录：${section}`)
    identities.add(identity); ids.add(primary)
    if (section === 'entries' && row.externalKey) {
      const key = identityOf(row, ['baseId', 'externalKey'])
      if (external.has(key)) throw new BadRequestException('备份中存在重复的外挂知识条目')
      external.add(key)
    }
  }
  return value as Row[]
}

function validField(type: string, required: boolean, value: unknown) {
  if (type === 'Json') return value !== undefined && (value !== null || !required)
  if (value === null) return !required
  if (type === 'String') return typeof value === 'string' && !value.includes('\0')
  if (type === 'DateTime') return typeof value === 'string' && Number.isFinite(Date.parse(value))
  if (type === 'Boolean') return typeof value === 'boolean'
  if (type === 'Int') return Number.isInteger(value) && Number(value) >= -2147483648 && Number(value) <= 2147483647
  if (type === 'Float') return Number.isFinite(value)
  return typeof value === 'string' && !!enums.get(type)?.includes(value)
}

export const identityOf = (row: Row, keys: string[]) => JSON.stringify(keys.map(key => row[key]))
export const assignedId = () => randomUUID()

// Only identifiers from the installed Prisma schema are interpolated, with row data bound as one JSON parameter.
export async function writeRows(tx: Prisma.TransactionClient, section: Section, inserts: Row[], updates: Row[]) {
  const spec = table(section)
  const raw = (value: string) => Prisma.raw('"' + value.replaceAll('"', '""') + '"')
  const target = raw(spec.model.dbName || spec.model.name)
  const dbName = (key: string) => spec.fields.get(key)!.dbName || key
  const timestamp = new Date().toISOString()
  const batches = async (rows: Row[], insert: boolean) => {
    const keys = tables[section].fields.filter(key => insert || !spec.preserve?.includes(key))
    if (spec.fields.has('updatedAt')) keys.push('updatedAt')
    if (insert && spec.fields.has('createdAt')) keys.push('createdAt')
    const columns = Prisma.join(keys.map(key => raw(dbName(key))))
    for (let start = 0; start < rows.length; start += 300) {
      const values = rows.slice(start, start + 300).map(row => Object.fromEntries(keys.map(key => [dbName(key), ['updatedAt', 'createdAt'].includes(key) ? timestamp : row[key]])))
      const projected = Prisma.sql`jsonb_populate_recordset(NULL::${target}, ${JSON.stringify(values)}::jsonb)`
      if (insert) await tx.$executeRaw(Prisma.sql`INSERT INTO ${target} (${columns}) SELECT ${columns} FROM ${projected}`)
      else {
        const changes = keys.filter(key => !spec.primary.includes(key))
        const sets = Prisma.join(changes.map(key => Prisma.sql`${raw(dbName(key))} = incoming.${raw(dbName(key))}`))
        const joins = Prisma.join(spec.primary.map(key => Prisma.sql`live.${raw(dbName(key))} = incoming.${raw(dbName(key))}`), ' AND ')
        const written = await tx.$executeRaw(Prisma.sql`UPDATE ${target} AS live SET ${sets} FROM ${projected} AS incoming WHERE ${joins}`)
        if (written !== values.length) throw new ConflictException('有记录在导入期间发生变化，请重新预览')
      }
    }
  }
  await batches(updates, false)
  await batches(inserts, true)
}
