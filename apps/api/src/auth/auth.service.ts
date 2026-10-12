import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException
} from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { ConfigService } from "@nestjs/config"
import * as bcrypt from "bcryptjs"
import { PrismaService } from "../prisma/prisma.service"
import { CryptoService } from "../common/services/crypto.service"
import { AuditService } from "../common/services/audit.service"
import { QuotaService } from "../common/services/quota.service"
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  UpdateProfileDto
} from "./dto/auth.dto"
import type { AuthUser } from "../common/decorators/current-user.decorator"

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService
  ) {}

  private async loadAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: { include: { permissions: { include: { permission: true } } } }
          }
        }
      }
    })
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roles: user.roles.map((r) => r.role.key),
      permissions: Array.from(
        new Set(
          user.roles.flatMap((r) =>
            r.role.permissions.map((p) => p.permission.code)
          )
        )
      )
    }
  }

  private signAccessToken(userId: string, email: string) {
    const ttl = Number(this.config.get("JWT_ACCESS_TTL") || 900)
    return this.jwt.sign(
      { sub: userId, email, type: "access" },
      { expiresIn: ttl }
    )
  }

  private async issueRefreshToken(
    userId: string,
    ip?: string,
    userAgent?: string
  ) {
    const ttl = Number(this.config.get("JWT_REFRESH_TTL") || 604800)
    const raw = this.crypto.randomToken(32)
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.crypto.sha256(raw),
        expiresAt: new Date(Date.now() + ttl * 1000),
        ip: ip ?? null,
        userAgent: userAgent ?? null
      }
    })
    return raw
  }

  private async buildSession(
    userId: string,
    email: string,
    ip?: string,
    userAgent?: string
  ) {
    const [accessToken, refreshToken, user] = await Promise.all([
      this.signAccessToken(userId, email),
      this.issueRefreshToken(userId, ip, userAgent),
      this.loadAuthUser(userId)
    ])
    return { accessToken, refreshToken, user }
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() }
    })

    // 统一的失败提示，避免暴露账号是否存在
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      await this.audit.log({
        actor: dto.email,
        action: "auth.login",
        resource: "user",
        resourceId: user?.id,
        ip,
        userAgent,
        success: false,
        detail: { reason: "bad_credentials" }
      })
      throw new UnauthorizedException("邮箱或密码错误")
    }

    if (user.status === "DISABLED") {
      throw new UnauthorizedException("账号已被禁用，请联系管理员")
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), status: user.status === "PENDING" ? "ACTIVE" : user.status }
    })

    await this.quota.getQuota(user.id) // 确保配额记录存在

    const session = await this.buildSession(user.id, user.email, ip, userAgent)

    await this.audit.log({
      userId: user.id,
      actor: user.email,
      action: "auth.login",
      resource: "user",
      resourceId: user.id,
      ip,
      userAgent,
      success: true
    })

    return session
  }

  async register(dto: RegisterDto, ip?: string, userAgent?: string) {
    const email = dto.email.toLowerCase().trim()

    const exists = await this.prisma.user.findUnique({ where: { email } })
    if (exists) throw new ConflictException("该邮箱已被注册")

    if (dto.studentNo) {
      const dup = await this.prisma.user.findUnique({
        where: { studentNo: dto.studentNo }
      })
      if (dup) throw new ConflictException("该学号已被注册")
    }

    // 注册开关由系统设置控制
    const setting = await this.prisma.setting.findUnique({
      where: { key: "allow_registration" }
    })
    const allowRegistration = setting ? setting.value === true : true
    if (!allowRegistration) {
      throw new BadRequestException("当前未开放注册，请联系管理员开通账号")
    }

    const defaultRole = await this.prisma.role.findUnique({
      where: { key: "user" }
    })

    const user = await this.prisma.user.create({
      data: {
        email,
        username: dto.username?.trim() || null,
        name: dto.name,
        passwordHash: await bcrypt.hash(dto.password, 10),
        department: dto.department ?? null,
        studentNo: dto.studentNo?.trim() || null,
        roles: defaultRole
          ? { create: [{ roleId: defaultRole.id }] }
          : undefined
      }
    })

    await this.quota.getQuota(user.id)

    await this.audit.log({
      userId: user.id,
      actor: user.email,
      action: "auth.register",
      resource: "user",
      resourceId: user.id,
      ip,
      userAgent,
      success: true
    })

    return this.buildSession(user.id, user.email, ip, userAgent)
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string) {
    const hash = this.crypto.sha256(refreshToken)
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true }
    })

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException("登录状态已失效，请重新登录")
    }
    if (record.user.status === "DISABLED") {
      throw new UnauthorizedException("账号已被禁用")
    }

    // 轮换：旧 refresh token 立即失效
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() }
    })

    return this.buildSession(record.user.id, record.user.email, ip, userAgent)
  }

  async logout(refreshToken: string, userId: string) {
    const hash = this.crypto.sha256(refreshToken)
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash, userId },
      data: { revokedAt: new Date() }
    })
    return { success: true }
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    })
    return { success: true }
  }

  async me(userId: string): Promise<AuthUser> {
    return this.loadAuthUser(userId)
  }

  /** 返回当前用户的完整资料 + 配额信息 */
  async profile(userId: string) {
    const [user, quota] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
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
          roles: { include: { role: true } }
        }
      }),
      this.quota.check(userId)
    ])
    return {
      ...user,
      roles: user.roles.map((r) => ({
        key: r.role.key,
        name: r.role.name
      })),
      quota
    }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        department: dto.department,
        phone: dto.phone,
        avatar: dto.avatar
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        department: true,
        phone: true
      }
    })
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId }
    })
    const ok = await bcrypt.compare(dto.oldPassword, user.passwordHash)
    if (!ok) throw new BadRequestException("原密码不正确")

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) }
    })

    // 改密后强制所有设备重新登录
    await this.logoutAll(userId)

    await this.audit.log({
      userId,
      actor: user.email,
      action: "auth.change_password",
      resource: "user",
      resourceId: userId
    })

    return { success: true }
  }
}