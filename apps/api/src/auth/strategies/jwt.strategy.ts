import { Injectable, UnauthorizedException } from "@nestjs/common"
import { PassportStrategy } from "@nestjs/passport"
import { ExtractJwt, Strategy } from "passport-jwt"
import { ConfigService } from "@nestjs/config"
import { PrismaService } from "../../prisma/prisma.service"
import type { AuthUser } from "../../common/decorators/current-user.decorator"

export interface JwtPayload {
  sub: string
  email: string
  type: "access" | "refresh"
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>("JWT_SECRET") || "cagent-dev-secret"
    })
  }

  /** 每次请求都从库中取最新的角色与权限，保证授权变更立即生效 */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (payload.type !== "access") {
      throw new UnauthorizedException("令牌类型错误")
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } }
              }
            }
          }
        }
      }
    })

    if (!user) throw new UnauthorizedException("用户不存在")
    if (user.status === "DISABLED") throw new UnauthorizedException("账号已被禁用")

    const roles = user.roles.map((ur) => ur.role.key)
    const permissions = Array.from(
      new Set(
        user.roles.flatMap((ur) =>
          ur.role.permissions.map((rp) => rp.permission.code)
        )
      )
    )

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roles,
      permissions
    }
  }
}