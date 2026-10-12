import { createParamDecorator, ExecutionContext } from "@nestjs/common"

export interface AuthUser {
  id: string
  email: string
  name: string
  status: string
  roles: string[]
  permissions: string[]
}

/** 从请求上下文取出当前登录用户 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest()
    const user: AuthUser | undefined = request.user
    if (!user) return undefined
    return field ? user[field] : user
  }
)