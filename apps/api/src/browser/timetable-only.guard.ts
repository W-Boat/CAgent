import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common'
/** Generic command queues and server automation stay closed; timetable uses its own read-only API. */
@Injectable()
export class TimetableOnlyGuard implements CanActivate {
  canActivate():boolean {throw new ForbiddenException('浏览器目前仅开放个人课表读取，请使用 /timetable')}
}
