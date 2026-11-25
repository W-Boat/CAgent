import { readFile } from 'node:fs/promises'
import { resolve as pathResolve } from 'node:path'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { campusMaps } from './campus-map'

export const mapSetting = 'campus_map_backup_snapshot'
export const mapImagePrefix = 'campus_map_image:'
const imageType = z.enum(['image/png', 'image/jpeg', 'image/webp'])
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/i)
const text = z.string().max(2000)
const place = z.object({
  id, name: text, description: text, kind: text, x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(),
  aliases: z.array(text).max(100), shape: z.enum(['rect', 'poly', 'ellipse', 'polygon', 'circle']),
  points: z.string().max(4000).optional(), markerX: z.number().finite().optional(), markerY: z.number().finite().optional(),
})
const map = z.object({
  id, name: text, edition: text, northRotation: z.number().finite(), source: text, sourceFile: text,
  imageUrl: z.string().regex(/^\/maps\/[a-z0-9._-]+$|^\/api\/campus\/map-images\/[a-z0-9_-]+$/i),
  width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000),
  places: z.array(place).max(1000),
  roads: z.array(z.object({ name: text, x: z.number().finite(), y: z.number().finite(), rotate: z.number().finite() })).max(100),
})
export const mapSnapshotSchema = z.object({
  campuses: z.array(map).min(1).max(20),
  images: z.record(z.object({ contentType: imageType, data: z.string().max(12 * 1024 * 1024) })),
}).superRefine(({ campuses, images }, ctx) => {
  const ids = new Set(campuses.map(campus => campus.id))
  const valid = ids.size === campuses.length && Object.keys(images).every(key => ids.has(key)) && campuses.every(campus =>
    new Set(campus.places.map(item => item.id)).size === campus.places.length &&
    (Object.hasOwn(images, campus.id) || campus.id === 'example' && campus.imageUrl === '/maps/example.svg'))
  if (!valid) ctx.addIssue({ code: 'custom', message: '地图文件或建筑标记缺失' })
  for (const image of Object.values(images)) {
    const buffer = Buffer.from(image.data, 'base64')
    if (rasterType(buffer) !== image.contentType) ctx.addIssue({ code: 'custom', message: '地图原图格式错误' })
  }
})
export type MapSnapshot = z.infer<typeof mapSnapshotSchema>

function rasterType(bytes: Buffer): z.infer<typeof imageType> | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

export async function exportCampusMaps(tx: Prisma.TransactionClient): Promise<MapSnapshot> {
  const stored = await tx.setting.findUnique({ where: { key: mapSetting } })
  if (stored) {
    const files = await tx.setting.findMany({ where: { key: { startsWith: mapImagePrefix } } })
    const { campuses } = (stored.value as unknown as Pick<MapSnapshot, 'campuses'>)
    const filesByKey = new Map(files.map(file => [file.key.slice(mapImagePrefix.length), file.value]))
    return mapSnapshotSchema.parse({ campuses, images: Object.fromEntries(campuses.filter(campus => filesByKey.has(campus.id)).map(campus => [campus.id, filesByKey.get(campus.id)])) })
  }
  const roots = [process.env.CAGENT_MAP_ASSETS_DIR, pathResolve(__dirname, '../../../../web/dist/maps'),
    pathResolve(__dirname, '../../../web/dist/maps'), '../web/dist/maps', '../web/public/maps', 'apps/web/dist/maps', 'apps/web/public/maps']
  const images: MapSnapshot['images'] = {}
  for (const campus of campusMaps.campuses) {
    if (campus.id === 'example' && campus.imageUrl === '/maps/example.svg') continue
    const file = /^\/maps\/([a-z0-9._-]+)$/i.exec(campus.imageUrl)?.[1]
    if (!file || file.startsWith('.')) throw Error('地图原图路径无效')
    for (const root of roots) {
      if (!root) continue
      const content = await readFile(pathResolve(root, file)).catch(() => null)
      const contentType = content && rasterType(content)
      if (contentType && content.length <= 8 * 1024 * 1024) { images[campus.id] = { contentType, data: content.toString('base64') }; break }
    }
    if (!images[campus.id]) throw Error(`找不到 ${campus.name} 原图。请检查 CAGENT_MAP_ASSETS_DIR 指向的地图目录。`)
  }
  return mapSnapshotSchema.parse({ campuses: campusMaps.campuses, images })
}

export function portableMapValue(snapshot: MapSnapshot) {
  return { ...snapshot, campuses: snapshot.campuses.map(campus => ({ ...campus,
    imageUrl: snapshot.images[campus.id] ? `/api/campus/map-images/${campus.id}` : campus.imageUrl,
  })) }
}

export async function currentCampusMaps(db: Pick<Prisma.TransactionClient, 'setting'>) {
  const stored = await db.setting.findUnique({ where: { key: mapSetting }, select: { value: true } })
  return stored ? stored.value as unknown as Pick<MapSnapshot, 'campuses'> : campusMaps
}
