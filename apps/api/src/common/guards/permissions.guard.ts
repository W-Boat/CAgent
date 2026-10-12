import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable
} from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator"
import type { AuthUser } from "../decorators/current-user.decorator"

/**
 * 权限守卫：
 *  - super_admin 拥有 "*" 通配权限
 *  - 声明了多个权限码时满足任意一个即可
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    )
    if (!required || required.length === 0) return true

    const request = context.switchToHttp().getRequest()
    const user: AuthUser | undefined = request.user
    if (!user) throw new ForbiddenException("请先登录")

    const granted = new Set(user.permissions)
    if (granted.has("*")) return true

    const ok = required.some((code) => granted.has(code))
    if (!ok) {
      throw new ForbiddenException(
        `缺少所需权限：${required.join(" 或 ")}`
      )
    }
    return true
  }
}