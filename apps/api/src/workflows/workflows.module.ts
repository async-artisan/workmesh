import { Module } from '@nestjs/common';
import { V1_IDEMPOTENCY_REPOSITORY } from '../common/v1-idempotency';
import { V1IdempotencyPrismaRepository } from '../common/v1-idempotency.prisma-repository';
import { V1_WORKFLOW_REPOSITORY } from './v1-workflow.repository';
import { V1WorkflowPrismaRepository } from './v1-workflow.prisma-repository';
import { V1WorkflowController } from './v1-workflow.controller';
import { V1WorkflowService } from './v1-workflow.service';
import { V1RolePackageController } from './v1-role-package.controller';
import { V1RolePackageService } from './v1-role-package.service';
import { V1RolePackagePrismaRepository } from './v1-role-package.prisma-repository';
import { V1BuiltinRolePackageSeeder } from './v1-role-package-builtin.seeder';
import { V1_ROLE_PACKAGE_REPOSITORY } from './v1-role-package.repository';

@Module({
  controllers: [V1WorkflowController, V1RolePackageController],
  providers: [
    { provide: V1_IDEMPOTENCY_REPOSITORY, useClass: V1IdempotencyPrismaRepository },
    { provide: V1_WORKFLOW_REPOSITORY, useClass: V1WorkflowPrismaRepository },
    { provide: V1_ROLE_PACKAGE_REPOSITORY, useClass: V1RolePackagePrismaRepository },
    V1WorkflowService,
    V1RolePackageService,
    V1BuiltinRolePackageSeeder,
  ],
  exports: [
    V1WorkflowService,
    V1RolePackageService,
    V1_WORKFLOW_REPOSITORY,
    V1_ROLE_PACKAGE_REPOSITORY,
    V1_IDEMPOTENCY_REPOSITORY,
  ],
})
export class WorkflowsModule {}
