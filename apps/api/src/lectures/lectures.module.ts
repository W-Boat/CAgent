import {Module} from '@nestjs/common'
import {KnowledgeStoreModule} from '../knowledge/knowledge-store.module'
import {LecturesService} from './lectures.service'
import {LecturesController} from './lectures.controller'
@Module({imports:[KnowledgeStoreModule],providers:[LecturesService],controllers:[LecturesController],exports:[LecturesService]})
export class LecturesModule {}
