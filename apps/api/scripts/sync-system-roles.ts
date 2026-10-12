/**
 * 同步系统权限与角色到数据库。
 *
 * ── 为什么需要它 ──
 *
 * 权限目录（PERMISSIONS）与系统角色（SYSTEM_ROLES）的权威定义在
 * src/common/constants/permissions.ts，prisma/seed.ts 会写进库。
 * 但完整 seed 还会重建演示数据，在**已有数据的库**上跑并不合适。
 * 这个脚本只做「权限 + 系统角色 + 可选绑定用户」，且幂等，可反复执行。
 *
 * 用途：
 *   # 只同步权限与全部系统角色
 *   npx ts-node --transpile-only scripts/sync-system-roles.ts
 *
 *   # 顺便把一个账号绑到某个角色（会移除它已有的其它系统角色）
 *   npx ts-node --transpile-only scripts/sync-system-roles.ts --bind=teacher@cagent.local:teacher
 *
 * ── 幂等与边界 ──
 *
 *   - 权限按 code upsert，只增不删（删权限会影响历史审计记录的可读性）；
 *   - 系统角色按 key upsert，权限**先清后建**，以代码为准 ——
 *     与 seed.ts 的做法一致，避免手工改过的授权让「代码说什么」失效；
 *   - 只动 isSystem 角色与用户身上的**系统**角色，
 *     自建角色和用户自建角色不受影响。
 */
import { PrismaClient } from "@prisma/client"
import { PERMISSIONS, SYSTEM_ROLES } from "../src/common/constants/permissions"

const prisma = new PrismaClient()

/** 角色列表显示顺序 */
const ROLE_SORT: Record<string, number> = {
  super_admin: 0,
  admin: 1,
  teacher: 5,
  user: 9
}

const ROLE_NAME: Record<string, string> = {
  super_admin: "超级管理员",
  admin: "管理员",
  teacher: "教师（小管理）",
  user: "普通用户"
}

const bindArg = process.argv.find((a) => a.startsWith("--bind="))

async function syncPermissions() {
  let created = 0
  for (const p of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({ where: { code: p.code } })
    if (existing) {
      if (existing.name !== p.name || existing.group !== p.group) {
        await prisma.permission.update({
          where: { code: p.code },
          data: { name: p.name, group: p.group }
        })
      }
    } else {
      await prisma.permission.create({ data: { code: p.code, name: p.name, group: p.group } })
      created++
    }
  }
  console.log(`权限目录：共 ${PERMISSIONS.length} 条，新建 ${created} 条`)
}

async function syncRoles() {
  /*
   * 权限全集。`*` 必须特判 —— 它不是 permission 表里的一条记录，
   * 而「全部权限」的通配写法。
   *
   * 我第一版漏了这个特判：清空 super_admin 的授权后按 code 匹配 `*`，
   * 一条也匹配不上，于是超管被清成了 0 条权限。后果不只是「少几个入口」——
   * isStudent 的判据是「有没有 dashboard:read」，超管权限被清空后
   * 会被判成学生、登录直接进学生端。这类错误在界面上看不出来，
   * 只有对比角色权限数才会发现，所以下面每条角色都打印实际条数。
   */
  const allPermissions = await prisma.permission.findMany()

  for (const def of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        name: def.name,
        description: def.description,
        isSystem: true,
        sort: ROLE_SORT[def.key] ?? 9
      },
      update: { name: def.name, description: def.description, isSystem: true }
    })

    const wanted =
      def.permissions[0] === "*"
        ? allPermissions
        : allPermissions.filter((p) => (def.permissions as readonly string[]).includes(p.code))

    if (def.permissions[0] !== "*") {
      const missing = def.permissions.filter((c) => !allPermissions.some((p) => p.code === c))
      if (missing.length) {
        console.warn(`  ⚠ [${def.key}] 以下权限码不在目录里，已跳过：${missing.join(", ")}`)
      }
    }

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } })
    await prisma.rolePermission.createMany({
      data: wanted.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true
    })
    console.log(
      `  [${role.key}] ${role.name}：${wanted.length} 条权限` +
        (def.permissions[0] === "*" ? "（通配 *，即全部）" : "")
    )
  }
}

async function bindUser() {
  if (!bindArg) return
  const spec = bindArg.slice("--bind=".length)
  const idx = spec.lastIndexOf(":")
  const email = spec.slice(0, idx)
  const roleKey = spec.slice(idx + 1)

  const role = await prisma.role.findUnique({ where: { key: roleKey } })
  if (!role) {
    console.warn(`\n⚠ 角色 ${roleKey} 不存在，跳过绑定`)
    return
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, roles: { select: { role: { select: { key: true, isSystem: true } } } } }
  })
  if (!user) {
    console.warn(`\n⚠ 用户 ${email} 不存在，跳过绑定`)
    return
  }

  const before = user.roles.map((r) => r.role.key)
  if (before.includes(roleKey)) {
    console.log(`\n用户 ${email}（${user.name}）已是 ${roleKey}，无需改绑`)
    return
  }

  const systemKeys = user.roles.filter((r) => r.role.isSystem).map((r) => r.role.key)
  if (systemKeys.length) {
    const ids = await prisma.role.findMany({
      where: { isSystem: true, key: { in: systemKeys } },
      select: { id: true }
    })
    await prisma.userRole.deleteMany({
      where: { userId: user.id, roleId: { in: ids.map((r) => r.id) } }
    })
  }
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {}
  })
  console.log(
    `\n用户 ${email}（${user.name}）角色：${before.join(",") || "无"} → ${roleKey}` +
      (systemKeys.length ? `（已移除系统角色 ${systemKeys.join(",")}）` : "")
  )
}

async function main() {
  console.log("=== 同步权限目录 ===")
  await syncPermissions()
  console.log("\n=== 同步系统角色 ===")
  await syncRoles()
  await bindUser()

  /*
   * 复核「能进后台」这条约定。
   * isStudent 只看 dashboard:read，任何被当作管理侧的角色都必须带着它，
   * 否则那个角色的用户会被重定向进学生端 —— 正是教师原先踩到的坑。
   */
  console.log("\n=== 复核：管理侧角色是否都带 dashboard:read ===")
  const roles = await prisma.role.findMany({
    select: {
      key: true,
      name: true,
      permissions: { select: { permission: { select: { code: true } } } }
    },
    orderBy: { sort: "asc" }
  })
  for (const r of roles) {
    const codes = r.permissions.map((x) => x.permission.code)
    const adminSide = codes.includes("*") || codes.includes("dashboard:read")
    const preview = codes.includes("*") || codes.includes("student:preview")
    console.log(
      `  [${r.key}] ${r.name}：权限 ${codes.length}｜管理侧=${adminSide}｜可预览学生端=${preview}`
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
