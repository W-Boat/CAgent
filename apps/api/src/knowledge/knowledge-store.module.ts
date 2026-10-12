import { Module } from '@nestjs/common'
import { KnowledgeStoreService } from './knowledge-store.service'
@Module({providers:[KnowledgeStoreService],exports:[KnowledgeStoreService]})
export class KnowledgeStoreModule {}
