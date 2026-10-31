import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ProjectsModule } from '../projects/projects.module';
import { RequirementsModule } from '../requirements/requirements.module';
import { AiRunsService } from './ai-runs.service';

@Module({
  imports: [ProjectsModule, RequirementsModule],
  controllers: [AiController],
  providers: [AiService, AiRunsService],
  exports: [AiService, AiRunsService],
})
export class AiModule {}
