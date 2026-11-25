import { BadRequestException, Body, Controller, Get, Header, NotFoundException, Post, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator'
import { Public } from '../common/decorators/public.decorator'
import { RequirePermissions } from '../common/decorators/permissions.decorator'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { VoiceService } from './voice.service'
import { TestAccounts } from './test-accounts'

type Upload = { buffer: Buffer }
const mascotKey = 'experience_mascot_image'
function imageType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg'
  if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return ''
}

@Controller('experience')
export class ExperienceController {
  constructor(private readonly voice: VoiceService,
    private readonly tests: TestAccounts, private readonly settings: SettingsService, private readonly prisma: PrismaService) {}

  @Post('voice/asr')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 8 * 1024 * 1024, fields: 0 } }))
  transcribe(@CurrentUser() user: AuthUser, @UploadedFile() file?: Upload) {
    return this.voice.transcribe(user.id, file?.buffer)
  }

  @Post('voice/tts')
  @Header('Cache-Control', 'no-store')
  async speak(@CurrentUser() user: AuthUser, @Body('text') text: unknown) {
    return new StreamableFile(await this.voice.speak(user.id, text), { type: 'audio/wav' })
  }

  @Post('test-accounts')
  @RequirePermissions('setting:write')
  @Header('Cache-Control', 'no-store')
  issue(@CurrentUser() user: AuthUser, @Body('role') role: unknown, @Body('hours') hours: unknown) {
    return this.tests.issue(user, role, hours)
  }

  @Post('mascot')
  @RequirePermissions('setting:write')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 1024 * 1024, fields: 0 } }))
  async uploadMascot(@UploadedFile() file?: Upload) {
    if (!file?.buffer || !imageType(file.buffer)) throw new BadRequestException('请选择 PNG、JPG、GIF 或 WebP 图片')
    const value = file.buffer.toString('base64')
    await this.prisma.setting.upsert({ where: { key: mascotKey }, create: { key: mascotKey, group: 'mascot', value }, update: { value } })
    return { saved: true }
  }

  @Public()
  @Get('mascot')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  async mascot() {
    const value = await this.settings.get<string>(mascotKey)
    const bytes = Buffer.from(value || '', 'base64')
    const type = imageType(bytes)
    if (!type) throw new NotFoundException()
    return new StreamableFile(bytes, { type })
  }
}
