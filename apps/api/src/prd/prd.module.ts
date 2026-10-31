import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { PrdController } from './prd.controller';
import { PrdService } from './prd.service';
import { PrdWorkflowController } from './prd-workflow.controller';
import { PrdWorkflowService } from './prd-workflow.service';

@Module({
  imports: [ProjectsModule],
  controllers: [PrdController, PrdWorkflowController],
  providers: [PrdService, PrdWorkflowService],
})
export class PrdModule {}
