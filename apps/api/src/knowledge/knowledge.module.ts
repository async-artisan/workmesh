import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ProjectsModule } from '../projects/projects.module';
import { RedisCacheService } from '../cache/redis-cache.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
@Module({
  imports: [AiModule, ProjectsModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, RedisCacheService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
