import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common'
import { RequirePermissions } from '../common/decorators/permissions.decorator'
import { StudentPortalService, type PortalSection } from './student-portal.service'
import { PublicNewsService } from './public-news.service'
import { StudentDirectoryService } from './student-directory.service'
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator'

function portalSection(section: string): PortalSection {
  if (section!=='information' && section!=='services' && section!=='applications') throw new NotFoundException()
  return section
}

@Controller('experience/portal')
export class StudentPortalController {
  constructor(private readonly portal: StudentPortalService, private readonly news: PublicNewsService,private readonly directory:StudentDirectoryService) {}

  @Get('academic-calendar') @RequirePermissions('campus:read')
  calendar(){return this.directory.list('academic-calendar')}

  @Get('directory') @RequirePermissions('campus:read')
  phones(){return this.directory.list('directory')}

  @Post('campus-directory/collect') @RequirePermissions('campus:admin')
  collectDirectory(@CurrentUser() user:AuthUser,@Body('campusNetwork') campusNetwork:unknown){return this.directory.collect(user,campusNetwork===true)}

  @Post('official-news/collect')
  @RequirePermissions('campus:admin')
  collect(@CurrentUser() user: AuthUser,@Body('campusNetwork') campusNetwork: unknown) {
    return this.news.collect(user,campusNetwork===true)
  }

  @Post('navigation/install')
  @RequirePermissions('campus:admin')
  install(@CurrentUser() user: AuthUser) {
    return this.portal.installNavigation(user)
  }

  @Get(':section')
  @RequirePermissions('campus:read')
  list(@Param('section') section: string) {
    return this.portal.list(portalSection(section))
  }

  @Get(':section/:id')
  @RequirePermissions('campus:read')
  detail(@Param('section') section: string, @Param('id') id: string) {
    return this.portal.detail(portalSection(section),id)
  }
}
