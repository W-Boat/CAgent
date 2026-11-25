import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { AuditService } from '../common/services/audit.service'
import type { AuthUser } from '../common/decorators/current-user.decorator'

const suffix = '@testing.cagent.invalid'
export const isTestEmail = (email: string) => email.trim().toLowerCase().endsWith(suffix)

@Injectable()
export class TestAccounts {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService,
    private readonly audit: AuditService, private readonly config: ConfigService) {}

  async check(user: { id: string; email: string }) {
    if (!isTestEmail(user.email)) return
    const [mode, lease] = await Promise.all([
      this.prisma.setting.findUnique({ where: { key: 'test_accounts_enabled' } }),
      this.settings.get<{ issuedAt: number; expiresAt: number; role: string }>('test_account:' + user.id),
    ])
    if (mode?.value !== true || !lease || lease.expiresAt <= Date.now() || lease.issuedAt < mode.updatedAt.getTime() ||
      (lease.role === 'super_admin' && !this.superReady()))
      throw new UnauthorizedException('测试账号已过期或测试模式已关闭')
  }

  async issue(actor: AuthUser, role: unknown, hours: unknown) {
    if (!actor.roles.includes('super_admin') || isTestEmail(actor.email))
      throw new ForbiddenException('仅正式超管可以签发测试账号')
    if (await this.settings.get('test_accounts_enabled') !== true)
      throw new ForbiddenException('请先保存并开启测试模式')
    if (role !== 'user' && role !== 'super_admin') throw new BadRequestException('请选择测试角色')
    if (role === 'super_admin' && !this.superReady())
      throw new ForbiddenException('签发测试超管需在专用测试部署设置 ALLOW_TEST_SUPER_ADMIN=true')
    if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 72)
      throw new BadRequestException('测试账号有效期为 1–72 小时')
    const targetRole = await this.prisma.role.findUnique({ where: { key: role } })
    if (!targetRole) throw new BadRequestException('测试角色未初始化')
    const email = `test-${randomBytes(10).toString('hex')}${suffix}`
    const password = randomBytes(24).toString('base64url')
    const passwordHash = await bcrypt.hash(password, 10)
    const issuedAt = Date.now()
    const expires = issuedAt + hours * 3600_000
    const expiresAt = new Date(expires).toISOString()
    const user = await this.prisma.$transaction(async tx => {
      const created = await tx.user.create({ data: { email, passwordHash, status: 'ACTIVE',
        name: role === 'super_admin' ? '测试超管' : '测试学生', roles: { create: { roleId: targetRole.id } } } })
      await tx.setting.create({ data: { key: 'test_account:' + created.id, group: 'test-accounts', value: { issuedAt, expiresAt: expires, role } } })
      return created
    })
    await this.audit.log({ userId: actor.id, action: 'auth.test_account.issue', resource: 'user',
      resourceId: user.id, detail: { role, expiresAt } })
    return { email, password, role, expiresAt }
  }

  private superReady() {
    return this.config.get<string>('ALLOW_TEST_SUPER_ADMIN') === 'true'
  }
}
