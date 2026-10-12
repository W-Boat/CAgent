import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common"
import { Prisma, UserStatus } from "@prisma/client"
import * as bcrypt from "bcryptjs"
import { PrismaService } from "../prisma/prisma.service"
import { AuditService } from "../common/services/audit.service"
import { QuotaService } from "../common/services/quota.service"
import {
  CreateUserDto,
  QueryUserDto,
  UpdateUserDto
} from "./dto/user.dto"

const USER_SELECT = {
  id: true,
  email: true,
  username: true,
  name: true,
  avatar: true,
  status: true,
  department: true,
  studentNo: true,
  phone: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  roles: { select: { role: { select: { key: true, name: true } } } },
  quota: {
    select: {
      enabled: true,
      dailyTokenLimit: true,
      monthlyTokenLimit: true,
      dailyRequestLimit: true,
      rpmLimit: true
    }
  }
} satisfies Prisma.UserSelect

function shape<T extends { roles: { role: { key: string; name: string } }[] }>(
  user: T
) {
  return { ...user, roles: user.roles.map((r) => r.role) }
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService
  ) {}

  async list(query: QueryUserDto) {
    const where: Prisma.UserWhereInput = {}

    if (query.keyword) {
      const kw = query.keyword.trim()
      where.OR = [
        { email: { contains: kw, mode: "insensitive" } },
        { name: { contains: kw, mode: "insensitive" } },
        { username: { contains: kw, mode: "insensitive" } },
        { studentNo: { contains: kw, mode: "insensitive" } },
        { phone: { contains: kw } }
      ]
    }
    if (query.status) where.status = query.status
    if (query.department) where.department = query.department
    if (query.role) {
      where.roles = { some: { role: { key: query.role } } }
    }

    const result = await this.prisma.paginate(
      this.prisma.user,
      {
        where,
        orderBy: { createdAt: "desc" },
        select: USER_SELECT
      },
      Number(query.page) || 1,
      Number(query.pageSize) || 20
    )

    return { ...result, items: result.items.map(shape) }
  }

  async detail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT
    })
    if (!user) throw new NotFoundException("用户不存在")

    const usage = await this.quota.check(id)
    const [conversations, messages] = await Promise.all([
      this.prisma.conversation.count({ where: { userId: id } }),
      this.prisma.message.count({ where: { userId: id } })
    ])

    return { ...shape(user), usage, stats: { conversations, messages } }
  }

  async create(dto: CreateUserDto, operator?: { id: string; email: string }) {
    const email = dto.email.toLowerCase().trim()

    const exists = await this.prisma.user.findUnique({ where: { email } })
    if (exists) throw new ConflictException("该邮箱已存在")

    if (dto.studentNo) {
      const dup = await this.prisma.user.findUnique({
        where: { studentNo: dto.studentNo }
      })
      if (dup) throw new ConflictException("该学号已存在")
    }

    const roles = await this.resolveRoles(dto.roles)

    const user = await this.prisma.user.create({
      data: {
        email,
        username: dto.username?.trim() || null,
        name: dto.name,
        passwordHash: await bcrypt.hash(dto.password, 10),
        department: dto.department ?? null,
        studentNo: dto.studentNo?.trim() || null,
        phone: dto.phone ?? null,
        status: dto.status ?? UserStatus.ACTIVE,
        roles: { create: roles.map((r) => ({ roleId: r.id })) }
      },
      select: USER_SELECT
    })

    await this.quota.getQuota(user.id)
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "user.create",
      resource: "user",
      resourceId: user.id,
      detail: { email, roles: roles.map((r) => r.key) }
    })

    return shape(user)
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    operator?: { id: string; email: string }
  ) {
    const existing = await this.prisma.user.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException("用户不存在")

    if (dto.username) {
      const dup = await this.prisma.user.findUnique({
        where: { username: dto.username }
      })
      if (dup && dup.id !== id) throw new ConflictException("该用户名已被占用")
    }
    if (dto.studentNo) {
      const dup = await this.prisma.user.findUnique({
        where: { studentNo: dto.studentNo }
      })
      if (dup && dup.id !== id) throw new ConflictException("该学号已存在")
    }

    // 不允许把自己降级或禁用，避免管理员把自己锁在门外
    if (operator && operator.id === id) {
      if (dto.status && dto.status !== UserStatus.ACTIVE) {
        throw new BadRequestException("不能禁用当前登录的账号")
      }
      if (dto.roles) {
        const next = await this.resolveRoles(dto.roles)
        const keepsAdmin = next.some((r) =>
          ["super_admin", "admin"].includes(r.key)
        )
        if (!keepsAdmin) {
          throw new BadRequestException("不能移除自己的管理员角色")
        }
      }
    }

    const data: Prisma.UserUpdateInput = {
      name: dto.name,
      username: dto.username === undefined ? undefined : dto.username || null,
      department: dto.department,
      studentNo: dto.studentNo === undefined ? undefined : dto.studentNo || null,
      phone: dto.phone,
      avatar: dto.avatar,
      status: dto.status
    }

    if (dto.roles) {
      const roles = await this.resolveRoles(dto.roles)
      await this.prisma.userRole.deleteMany({ where: { userId: id } })
      data.roles = { create: roles.map((r) => ({ roleId: r.id })) }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT
    })

    // 被禁用后立即吊销所有会话
    if (dto.status === UserStatus.DISABLED) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() }
      })
    }

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "user.update",
      resource: "user",
      resourceId: id,
      detail: dto as unknown as Prisma.InputJsonValue
    })

    return shape(user)
  }

  async remove(id: string, operator?: { id: string; email: string }) {
    if (operator?.id === id) {
      throw new BadRequestException("不能删除当前登录的账号")
    }
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException("用户不存在")
    if (user.email === process.env.SEED_ADMIN_EMAIL) {
      throw new BadRequestException("不能删除初始超级管理员")
    }

    await this.prisma.user.delete({ where: { id } })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "user.delete",
      resource: "user",
      resourceId: id,
      detail: { email: user.email }
    })
    return { success: true }
  }

  async setStatus(
    id: string,
    status: UserStatus,
    operator?: { id: string; email: string }
  ) {
    if (operator?.id === id && status !== UserStatus.ACTIVE) {
      throw new BadRequestException("不能禁用当前登录的账号")
    }
    await this.prisma.user.update({ where: { id }, data: { status } })

    if (status === UserStatus.DISABLED) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() }
      })
    }

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "user.set_status",
      resource: "user",
      resourceId: id,
      detail: { status }
    })
    return { success: true }
  }

  async resetPassword(
    id: string,
    password: string,
    operator?: { id: string; email: string }
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException("用户不存在")

    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 10) }
    })
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() }
    })

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "user.reset_password",
      resource: "user",
      resourceId: id
    })
    return { success: true }
  }

  /** 院系列表，用于筛选下拉 */
  async departments(): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { department: { not: null } },
      select: { department: true },
      distinct: ["department"]
    })
    return rows
      .map((r) => r.department)
      .filter((d): d is string => Boolean(d))
      .sort()
  }

  private async resolveRoles(keys?: string[]) {
    const wanted = keys && keys.length > 0 ? keys : ["user"]
    const roles = await this.prisma.role.findMany({
      where: { key: { in: wanted } }
    })
    if (roles.length !== wanted.length) {
      const found = new Set(roles.map((r) => r.key))
      const missing = wanted.filter((k) => !found.has(k))
      throw new BadRequestException(`角色不存在：${missing.join(", ")}`)
    }
    return roles
  }
}