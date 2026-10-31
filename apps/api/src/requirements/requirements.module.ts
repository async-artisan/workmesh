import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RequirementsController } from './requirements.controller';
import { RequirementsService } from './requirements.service';
import { DependencyController } from './dependency.controller';
import { DependencyService } from './dependency.service';

@Module({
  imports: [ProjectsModule],
  controllers: [RequirementsController, DependencyController],
  providers: [RequirementsService, DependencyService],
  exports: [RequirementsService],
})
export class RequirementsModule {}
