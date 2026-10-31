import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ProjectsModule } from '../projects/projects.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PrdController } from './prd.controller';
import { PrdService } from './prd.service';
import { PrdWorkflowController } from './prd-workflow.controller';
import { PrdWorkflowService } from './prd-workflow.service';

@Module({
  imports: [AiModule, ProjectsModule, KnowledgeModule],
  controllers: [PrdController, PrdWorkflowController],
  providers: [PrdService, PrdWorkflowService],
})
export class PrdModule {}
