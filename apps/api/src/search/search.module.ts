import {Module,Controller,Post,Body,Get} from '@nestjs/common'
import {SettingsModule} from '../settings/settings.module'
import {SearchService} from './search.service'
import {RequirePermissions} from '../common/decorators/permissions.decorator'
@Controller('search')
class SearchController{
 constructor(private search:SearchService){}
 @Get('status') @RequirePermissions('setting:write') async status(){return {configured:await this.search.available()}}
 @Post('test') @RequirePermissions('setting:write') test(@Body() input:unknown){return this.search.search(input)}
}
@Module({imports:[SettingsModule],providers:[SearchService],controllers:[SearchController],exports:[SearchService]})
export class SearchModule{}
