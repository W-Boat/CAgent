import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../common/services/crypto.service'
import { appOrigin } from '../common/app-origin'
import type { AuthUser } from '../common/decorators/current-user.decorator'
import { campusMaps } from '../campus/campus-map'
import { exportCampusMaps, mapImagePrefix, mapSetting, mapSnapshotSchema, portableMapValue, type MapSnapshot } from '../campus/campus-map-storage'
import { SETTING_MAP } from './setting-defs'
import { shortcutBindingsSchema, shortcutSettingPrefix } from '../knowledge/knowledge-shortcuts'
import { collectorSchema } from '../lectures/lecture-data'
import { openBackup, sealBackup } from './platform-backup-format'
import { assignedId, identityOf, sections, selectFields, table, tables, validateRows, writeRows, type Row, type Section } from './platform-backup-tables'

type Sections = Record<Section, Row[]>
type Package = { version: 1; exportedAt: string; siteOrigin?: string; sections: Sections; maps: MapSnapshot }
type Planned = { inserts: Row[]; updates: Row[] }
const collector = 'lecture_collector_config'
const stamp = () => new Date().toISOString()
const operator = (actor: Pick<AuthUser, 'id' | 'email' | 'roles'>) => {
  if (!actor?.roles.includes('super_admin')) throw new ForbiddenException('仅超级管理员可管理平台备份')
}
const settingsWhere = { OR: [{ key: { in: [...SETTING_MAP.keys(), 'experience_mascot_image', collector] } }, { key: { startsWith: shortcutSettingPrefix } }] }
const whereExport = (actorId: string) => ({ OR: [{ visibility: { not: 'PRIVATE' } }, { ownerId: actorId }, { isSystem: true }] })

@Injectable()
export class PlatformBackupService {
  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService) {}

  async export(password: unknown, actor: AuthUser) {
    operator(actor)
    const snapshot = await this.prisma.$transaction(async tx => {
      const rows = {} as Sections
      rows.agents = await table('agents').db(tx).findMany({ where: whereExport(actor.id), select: selectFields(tables.agents.fields) })
      const agentIds = rows.agents.map(row => row.id)
      const filters = { settings: settingsWhere, bindings: { agentId: { in: agentIds } }, bases: { OR: [{ agentId: null }, { agentId: { in: agentIds } }] } }
      for (const section of sections) {
        if (section === 'agents') continue
        const where = section === 'entries' ? { baseId: { in: rows.bases.map(row => row.id) } } : filters[section as keyof typeof filters]
        rows[section] = await table(section).db(tx).findMany({ where, select: selectFields(tables[section].fields) })
      }
      for (const entry of rows.settings) {
        if (entry.key === collector) entry.value = { config: collectorSchema.parse(entry.value.config) }
      }
      for (const row of rows.agents) row.ownerId = null
      for (const row of rows.skills) row.createdById = null
      for (const row of rows.bases) row.automationUserId = null
      for (const row of rows.providers) row.apiKey = this.decrypt(row.apiKey)
      for (const row of rows.keys) row.apiKey = this.decrypt(row.apiKey)
      for (const row of rows.bases) row.passwordEncrypted = this.decrypt(row.passwordEncrypted)
      return { version: 1 as const, exportedAt: stamp(), siteOrigin: appOrigin(), sections: rows, maps: await exportCampusMaps(tx) }
    }, { isolationLevel: 'RepeatableRead', timeout: 120000 }).catch(error => {
      if (error instanceof BadRequestException) throw error
      if (error instanceof Error && error.message.startsWith('找不到 ')) throw new BadRequestException(error.message)
      throw new BadRequestException('备份生成失败，请检查数据库和地图文件')
    })
    const result = await sealBackup(snapshot, password)
    await this.prisma.auditLog.create({ data: { userId: actor.id, actor: actor.email, action: 'platform.backup.export', resource: 'platform', success: true } })
    return result
  }

  async import(file: Buffer | undefined, password: unknown, actor: AuthUser, confirmation?: unknown) {
    operator(actor)
    const snapshot = this.validate(await openBackup(file, password))
    const applying = confirmation !== undefined
    try {
      return await this.prisma.$transaction(async tx => {
        if (applying) await tx.$queryRaw`SELECT pg_advisory_xact_lock(202611245651)::text`
        const { plan, report, version } = await this.plan(tx, snapshot, actor, file!)
        if (!applying) return { ...report, confirmation: version }
        if (typeof confirmation !== 'string' || confirmation !== version) throw new ConflictException('目标数据已变化，请重新预览后确认覆盖')
        for (const section of sections) {
          const { inserts, updates } = plan[section]
          const credential = section === 'providers' || section === 'keys' ? 'apiKey' : section === 'bases' ? 'passwordEncrypted' : ''
          if (credential) for (const row of [...inserts, ...updates]) if (row[credential]) row[credential] = this.crypto.encrypt(row[credential])
          await writeRows(tx, section, inserts, updates)
        }
        const maps = portableMapValue(snapshot.maps)
        await this.putSetting(tx, mapSetting, { campuses: maps.campuses } as Prisma.InputJsonValue)
        await tx.setting.deleteMany({ where: { key: { startsWith: mapImagePrefix, notIn: Object.keys(maps.images).map(id => mapImagePrefix + id) } } })
        for (const [id, image] of Object.entries(maps.images)) await this.putSetting(tx, mapImagePrefix + id, image)
        const revision = assignedId()
        await tx.setting.upsert({ where: { key: 'knowledge_revision' }, create: { key: 'knowledge_revision', group: 'campus', value: revision }, update: { value: revision } })
        await tx.auditLog.create({ data: { userId: actor.id, actor: actor.email, action: 'platform.backup.restore', resource: 'platform', detail: report, success: true } })
        return report
      }, { isolationLevel: 'Serializable', timeout: 150000, maxWait: 10000 })
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) throw error
      if ((error as { code?: string }).code === 'P2034') throw new ConflictException('当前有并行写入，请重新预览后重试')
      throw new BadRequestException('导入校验或写入失败。请检查备份版本及目标数据；本次写入已回滚。')
    }
  }

  private decrypt(encrypted: string | null) {
    if (encrypted === null || encrypted === '') return encrypted
    const plain = this.crypto.decrypt(encrypted)
    if (!plain) throw new BadRequestException('部分保存的凭据无法解密，请检查源服务器的加密主密钥')
    return plain
  }

  private validate(input: unknown): Package {
    if (!input || typeof input !== 'object') throw new BadRequestException('无效的备份内容')
    const { version, exportedAt, siteOrigin, sections: rows, maps } = input as Package
    if (version !== 1 || !rows || typeof exportedAt !== 'string' || !Number.isFinite(Date.parse(exportedAt))) throw new BadRequestException('当前版本无法读取此备份')
    const parsedMaps = mapSnapshotSchema.safeParse(maps)
    if (!parsedMaps.success) throw new BadRequestException('备份中的地图标记或原图无效')
    for (const section of sections) validateRows(section, rows[section])
    for (const row of rows.settings) {
      if (row.key === 'experience_mascot_image' && typeof row.value === 'string' && row.value.length <= 1398104 && /^[A-Za-z0-9+/]+={0,2}$/.test(row.value)) continue
      if (row.key === collector && collectorSchema.safeParse(row.value?.config).success) continue
      if (row.key.startsWith(shortcutSettingPrefix) && shortcutBindingsSchema.safeParse(row.value).success) continue
      const def = SETTING_MAP.get(row.key)
      const type = def?.type === 'text' ? 'string' : def?.type
      if (!def || (type !== 'json' && typeof row.value !== type) || (def.options?.length && !def.options.some(option => option.value === row.value))) {
        throw new BadRequestException(`备份中的系统设置无效：${row.key}`)
      }
    }
    return { version, exportedAt, siteOrigin: typeof siteOrigin === 'string' && /^https?:\/\/[^/?#]+$/.test(siteOrigin) ? siteOrigin : undefined, sections: rows, maps: parsedMaps.data }
  }

  private async plan(tx: Prisma.TransactionClient, snapshot: Package, actor: AuthUser, file: Buffer) {
    const idMap = new Map<Section, Map<string, string>>()
    const plan = {} as Record<Section, Planned>
    const totals = {} as Record<string, { added: number; overwritten: number }>
    const digest = createHash('sha256').update(file).update(actor.id)
    const currentOrigin = appOrigin()
    const remap = (section: Section, id: string | null, required = false) => {
      if (!id) return null
      const target = idMap.get(section)?.get(id)
      if (!target && required) throw new BadRequestException(`备份中的 ${section} 关联缺失`)
      return target || null
    }
    for (const section of sections) {
      const spec = table(section)
      const extra = section === 'entries' ? ['externalKey'] : section === 'bindings' ? ['sort', 'config'] : []
      const fields = new Set([...spec.primary, ...spec.identity, ...extra, ...(spec.fields.has('updatedAt') ? ['updatedAt'] : [])])
      const live = await spec.db(tx).findMany({ select: selectFields([...fields]) })
      if (section === 'keys') for (const row of live) row.apiKey = this.decrypt(row.apiKey)
      const byPrimary = new Map(live.map(row => [identityOf(row, spec.primary), row]))
      const byKey = new Map(live.map(row => [identityOf(row, spec.identity), row]))
      const byExternal = section === 'entries' ? new Map(live.filter(row => row.externalKey).map(row => [identityOf(row, ['baseId', 'externalKey']), row])) : null
      const mapped = new Map<string, string>(), touched = new Set<string>(), inserts: Row[] = [], updates: Row[] = []
      for (const source of snapshot.sections[section]) {
        const row = { ...source }
        if (section === 'keys' || section === 'models') row.providerId = remap('providers', row.providerId, true)
        if (section === 'agents') { row.modelId = remap('models', row.modelId); row.ownerId = actor.id }
        if (section === 'skills') row.createdById = actor.id
        if (section === 'bindings') { row.agentId = remap('agents', row.agentId, true); row.skillId = remap('skills', row.skillId, true) }
        if (section === 'bases') {
          row.agentId = remap('agents', row.agentId); row.automationModelId = remap('models', row.automationModelId)
          row.automationUserId = row.aiReviewEnabled || row.aiSummaryEnabled ? actor.id : null
        }
        if (section === 'entries') row.baseId = remap('bases', row.baseId, true)
        if ((section === 'entries' || section === 'guide') && snapshot.siteOrigin && row.url.startsWith(snapshot.siteOrigin + '/')) {
          row.url = currentOrigin + row.url.slice(snapshot.siteOrigin.length)
        }
        if (section === 'settings') {
          if (row.key.endsWith('_model_id')) row.value = remap('models', row.value) || ''
          if (row.key === collector) row.value = { config: row.value.config, operatorId: actor.id }
          if (row.key.startsWith(shortcutSettingPrefix)) {
            const baseId = remap('bases', row.key.slice(shortcutSettingPrefix.length))
            if (!baseId) continue
            row.key = shortcutSettingPrefix + baseId
          }
        }
        const primary = byPrimary.get(identityOf(row, spec.primary))
        const sameKey = byKey.get(identityOf(row, spec.identity))
        const sameExternal = row.externalKey && byExternal?.get(identityOf(row, ['baseId', 'externalKey']))
        const sameEntry = section === 'entries' && primary?.baseId === row.baseId ? primary : undefined
        const matching = [sameKey, sameExternal, sameEntry].filter(Boolean) as Row[]
        if (new Set(matching.map(found => identityOf(found, spec.primary))).size > 1) throw new ConflictException('目标库中有知识条目的问题与外部标识指向不同记录，请先解决冲突')
        const found = matching[0]
        digest.update(JSON.stringify([section, identityOf(row, spec.identity), found || null]))
        if (found) {
          const id = identityOf(found, spec.primary)
          if (touched.has(id)) throw new ConflictException('多个备份条目对应同一目标记录')
          touched.add(id)
          if (row.id) row.id = found.id
        } else if (row.id && primary) {
          const original = row.id
          for (let n = 0; ; n++) {
            row.id = createHash('sha256').update(JSON.stringify([section, original, n])).digest('hex').slice(0, 32)
            if (!byPrimary.has(identityOf(row, spec.primary))) break
          }
        }
        if (source.id) mapped.set(source.id, row.id)
        ;(found ? updates : inserts).push(row)
      }
      idMap.set(section, mapped)
      plan[section] = { inserts, updates }
      totals[section] = { added: inserts.length, overwritten: updates.length }
    }
    const oldMap = await tx.setting.findUnique({ where: { key: mapSetting } })
    const oldMaps = oldMap ? (oldMap.value as unknown as Pick<MapSnapshot, 'campuses'>).campuses : campusMaps.campuses
    digest.update(JSON.stringify([oldMap?.updatedAt, oldMaps.map(campus => campus.id)]))
    const overlaps = snapshot.maps.campuses.filter(campus => oldMaps.some(old => old.id === campus.id)).length
    totals.maps = { added: snapshot.maps.campuses.length - overlaps, overwritten: overlaps }
    const report = {
      exportedAt: snapshot.exportedAt, totals,
      maps: snapshot.maps.campuses.map(campus => campus.name),
      replacesMaps: oldMaps.filter(campus => !snapshot.maps.campuses.some(incoming => incoming.id === campus.id)).map(campus => campus.name),
      lectures: snapshot.sections.guide.filter(row => row.extra?.lecture).length,
      savedCredentials: snapshot.sections.keys.length + snapshot.sections.providers.filter(row => row.apiKey).length + snapshot.sections.bases.filter(row => row.passwordEncrypted).length,
    }
    return { plan, report, version: digest.digest('hex') }
  }

  private putSetting(tx: Prisma.TransactionClient, key: string, value: Prisma.InputJsonValue) {
    return tx.setting.upsert({ where: { key }, create: { key, group: 'campus-maps', value }, update: { value } })
  }
}
