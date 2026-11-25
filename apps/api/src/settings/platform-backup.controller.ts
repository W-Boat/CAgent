import { BadRequestException, Body, Controller, ExecutionContext, ForbiddenException, Header, Post, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator'
import { backupUploadLimit } from './platform-backup-format'
import { PlatformBackupService } from './platform-backup.service'

const uploadOptions = { limits: { fileSize: backupUploadLimit, files: 1, fields: 2, fieldSize: 2048 } }
type Upload = { buffer: Buffer }
class BackupAdminGuard {
  canActivate(context: ExecutionContext) {
    if (!context.switchToHttp().getRequest<{ user?: AuthUser }>().user?.roles?.includes('super_admin')) {
      throw new ForbiddenException('仅超级管理员可管理平台备份')
    }
    return true
  }
}

@Controller('settings/backup')
@UseGuards(BackupAdminGuard)
export class PlatformBackupController {
  constructor(private readonly backup: PlatformBackupService) {}

  @Post('export')
  @Header('Cache-Control', 'no-store')
  async export(@Body('password') password: unknown, @CurrentUser() actor: AuthUser) {
    const file = await this.backup.export(password, actor)
    const date = new Date().toISOString().slice(0, 10)
    return new StreamableFile(file, { type: 'application/octet-stream', disposition: `attachment; filename="CAgent-${date}.cagent-backup"` })
  }

  @Post('preview')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  preview(@UploadedFile() file: Upload | undefined, @Body('password') password: unknown, @CurrentUser() actor: AuthUser) {
    return this.backup.import(file?.buffer, password, actor)
  }

  @Post('import')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  restore(@UploadedFile() file: Upload | undefined, @Body('password') password: unknown, @Body('confirmation') confirmation: unknown, @CurrentUser() actor: AuthUser) {
    if (typeof confirmation !== 'string' || !/^[a-f0-9]{64}$/.test(confirmation)) throw new BadRequestException('请先预览备份，再确认覆盖')
    return this.backup.import(file?.buffer, password, actor, confirmation)
  }
}
