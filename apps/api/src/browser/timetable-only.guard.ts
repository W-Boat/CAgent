import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common'
/** Generic command queues and server automation stay closed; collective timetables use the knowledge APIs. */
@Injectable()
export class TimetableOnlyGuard implements CanActivate {
  canActivate():boolean {throw new ForbiddenException('浏览器操控已停用；课程安排请查询集体课表知识库')}
}
