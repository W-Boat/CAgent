import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"
import { AuditService } from "../common/services/audit.service"
import {
  ALL_PERMISSION_CODES,
  PERMISSIONS,
  PERMISSION_GROUPS
} from "../common/constants/permissions"
import { CreateRoleDto, UpdateRoleDto } from "./dto/role.dto"

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } }
      }
    })
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      sort: r.sort,
      createdAt: r.createdAt,
      userCount: r._count.users,
      permissions: r.permissions.map((p) => p.permission.code),
      permissionCount: r.permissions.length
    }))
  }

  async detail(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: { include: { permission: true } },
        users: {
          take: 20,
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                avatar: true,
                status: true
              }
            }
          }
        },
        _count: { select: { users: true } }
      }
    })
    if (!role) throw new NotFoundException("角色不存在")
    return {
      ...role,
      permissions: role.permissions.map((p) => p.permission.code),
      users: role.users.map((u) => u.user),
      userCount: role._count.users
    }
  }

  /** 权限目录 + 分组，供前端渲染权限勾选树 */
  permissionCatalog() {
    const groups = Object.entries(PERMISSION_GROUPS).map(([key, name]) => ({
      key,
      name,
      permissions: PERMISSIONS.filter((p) => p.group === key)
    }))
    return { groups, total: PERMISSIONS.length }
  }

  async create(dto: CreateRoleDto, operator?: { id: string; email: string }) {
    const key = dto.key.trim()
    const exists = await this.prisma.role.findUnique({ where: { key } })
    if (exists) throw new ConflictException("该角色标识已存在")

    const permissionIds = await this.resolvePermissionIds(dto.permissions)

    const role = await this.prisma.role.create({
      data: {
        key,
        name: dto.name,
        description: dto.description ?? null,
        sort: dto.sort ?? 0,
        isSystem: false,
        permissions: { create: permissionIds.map((id) => ({ permissionId: id })) }
      },
      include: { permissions: { include: { permission: true } } }
    })

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "role.create",
      resource: "role",
      resourceId: role.id,
      detail: { key, permissions: dto.permissions ?? [] }
    })

    return {
      ...role,
      permissions: role.permissions.map((p) => p.permission.code)
    }
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    operator?: { id: string; email: string }
  ) {
    const role = await this.prisma.role.findUnique({ where: { id } })
    if (!role) throw new NotFoundException("角色不存在")

    // 内置超级管理员的权限不可修改，防止把自己锁死
    if (role.key === "super_admin" && dto.permissions) {
      throw new BadRequestException("超级管理员权限不可修改")
    }

    if (dto.permissions) {
      const permissionIds = await this.resolvePermissionIds(dto.permissions)
      await this.prisma.rolePermission.deleteMany({ where: { roleId: id } })
      await this.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        skipDuplicates: true
      })
    }

    await this.prisma.role.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        sort: dto.sort
      }
    })

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "role.update",
      resource: "role",
      resourceId: id,
      detail: dto as unknown as Record<string, unknown>
    })

    return this.detail(id)
  }

  async remove(id: string, operator?: { id: string; email: string }) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } }
    })
    if (!role) throw new NotFoundException("角色不存在")
    if (role.isSystem) throw new BadRequestException("系统内置角色不可删除")
    if (role._count.users > 0) {
      throw new BadRequestException(
        `该角色下还有 ${role._count.users} 个用户，请先解绑`
      )
    }

    await this.prisma.role.delete({ where: { id } })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "role.delete",
      resource: "role",
      resourceId: id,
      detail: { key: role.key }
    })
    return { success: true }
  }

  /** 同步权限目录到数据库（seed / 升级时调用） */
  async syncPermissions() {
    const existing = await this.prisma.permission.findMany()
    const existingCodes = new Set(existing.map((p) => p.code))

    const missing = PERMISSIONS.filter((p) => !existingCodes.has(p.code))
    if (missing.length > 0) {
      await this.prisma.permission.createMany({
        data: missing.map((p) => ({
          code: p.code,
          name: p.name,
          group: p.group,
          description: p.description ?? null
        })),
        skipDuplicates: true
      })
    }

    // 清理已下线的权限码
    const stale = existing.filter((p) => !ALL_PERMISSION_CODES.includes(p.code))
    if (stale.length > 0) {
      await this.prisma.permission.deleteMany({
        where: { id: { in: stale.map((p) => p.id) } }
      })
    }

    return { added: missing.length, removed: stale.length }
  }

  private async resolvePermissionIds(codes?: string[]) {
    if (!codes || codes.length === 0) return []
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: codes } }
    })
    if (permissions.length !== codes.length) {
      const found = new Set(permissions.map((p) => p.code))
      const missing = codes.filter((c) => !found.has(c))
      throw new BadRequestException(`权限码不存在：${missing.join(", ")}`)
    }
    return permissions.map((p) => p.id)
  }
}