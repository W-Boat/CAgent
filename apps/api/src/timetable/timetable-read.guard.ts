import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common'
import { SettingsService } from '../settings/settings.service'
@Injectable()
export class TimetableReadGuard implements CanActivate {
  constructor(private readonly settings:SettingsService){}
  async canActivate(){if(await this.settings.get('timetable_enabled')===false)throw new ForbiddenException('课表读取服务暂未开放');return true}
}
