import { Module } from '@nestjs/common';
import { V1_IDEMPOTENCY_REPOSITORY } from '../common/v1-idempotency';
import { V1IdempotencyPrismaRepository } from '../common/v1-idempotency.prisma-repository';
import { ProjectAccessService } from './project-access.service';
import { PROJECT_ROLE_REPOSITORY } from './project-role.repository';
import { ProjectRolePrismaRepository } from './project-role.prisma-repository';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { RequirementsController } from './requirements.controller';
import { RequirementsService } from './requirements.service';

@Module({
  controllers: [ProjectsController, RequirementsController],
  providers: [
    ProjectsService,
    RequirementsService,
    ProjectAccessService,
    { provide: PROJECT_ROLE_REPOSITORY, useClass: ProjectRolePrismaRepository },
    { provide: V1_IDEMPOTENCY_REPOSITORY, useClass: V1IdempotencyPrismaRepository },
  ],
  exports: [ProjectAccessService],
})
export class ProjectsModule {}
