import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from "@nestjs/common"
import { Observable, map } from "rxjs"
import {stripRetiredCapabilities} from '../retired-capabilities'

export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

/**
 * 统一成功响应结构：{ code, message, data }
 * 已经带有 code 字段的响应（如流式接口自行写回）不再包装。
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T> | T>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Observable<ApiResponse<T> | T> {
    return next.handle().pipe(
      map((data) => {
        const path=context.switchToHttp().getRequest().path||''
        if(/\/(agents|skills|dashboard|learning|conversations|audit-logs)(\/|$)/.test(path))data=stripRetiredCapabilities(data)
        if (
          data &&
          typeof data === "object" &&
          "code" in data &&
          "message" in data &&
          Object.keys(data as object).length <= 3
        ) {
          return data
        }
        return { code: 0, message: "ok", data: data as T }
      })
    )
  }
}
