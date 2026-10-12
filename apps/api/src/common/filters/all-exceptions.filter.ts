import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from "@nestjs/common"
import type { Request, Response } from "express"

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exception")

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message = "服务器内部错误"
    let details: unknown = undefined

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const res = exception.getResponse()
      if (typeof res === "string") {
        message = res
      } else if (res && typeof res === "object") {
        const body = res as Record<string, any>
        const raw = body.message
        if (Array.isArray(raw)) {
          message = raw.join("; ")
        } else if (typeof raw === "string") {
          message = raw
        } else if (typeof body.error === "string") {
          message = body.error
        }
        details = body.details
      }
    } else if (exception instanceof Error) {
      message = exception.message
      details =
        process.env.NODE_ENV === "production" ? undefined : exception.stack
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}: ${message}`,
        exception instanceof Error ? exception.stack : undefined
      )
    }

    response.status(status).json({
      code: status,
      message,
      details,
      path: request.url,
      timestamp: new Date().toISOString()
    })
  }
}