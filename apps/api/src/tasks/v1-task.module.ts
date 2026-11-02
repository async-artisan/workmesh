import { Module } from '@nestjs/common';
import { V1_IDEMPOTENCY_REPOSITORY } from '../common/v1-idempotency';
import { V1IdempotencyPrismaRepository } from '../common/v1-idempotency.prisma-repository';
import { V1_TASK_REPOSITORY } from './v1-task.repository';
import { V1TaskPrismaRepository } from './v1-task.prisma-repository';
import { V1TaskController, V1ArtifactSetController } from './v1-task.controller';
import { V1TaskService } from './v1-task.service';
import { V1_ARTIFACT_REPOSITORY } from './v1-artifact.repository';
import { V1ArtifactPrismaRepository } from './v1-artifact.prisma-repository';
import { V1ArtifactService } from './v1-artifact.service';
import { V1_CHANGE_REPOSITORY } from './v1-change.repository';
import { V1ChangePrismaRepository } from './v1-change.prisma-repository';
import { V1ChangeService } from './v1-change.service';
import { V1ChangeRecipientController } from './v1-change.controller';
import { V1_BOARD_REPOSITORY } from './v1-board.repository';
import { V1BoardPrismaRepository } from './v1-board.prisma-repository';
import { V1BoardService } from './v1-board.service';
import { V1BoardController } from './v1-board.controller';
import { V1_SNAPSHOT_REPOSITORY } from './v1-snapshot.repository';
import { V1SnapshotPrismaRepository } from './v1-snapshot.prisma-repository';
import { V1SnapshotService } from './v1-snapshot.service';
import { V1SnapshotController } from './v1-snapshot.controller';
import { V1_READY_REPOSITORY } from './v1-ready.repository';
import { V1ReadyPrismaRepository } from './v1-ready.prisma-repository';
import { V1ReadyService } from './v1-ready.service';
import { V1ReadyController } from './v1-ready.controller';
import { V1FlowMetricsController } from './v1-flow-metrics.controller';
import { V1FlowMetricsService } from './v1-flow-metrics.service';

@Module({
  controllers: [
    V1TaskController,
    V1ArtifactSetController,
    V1ChangeRecipientController,
    V1BoardController,
    V1SnapshotController,
    V1ReadyController,
    V1FlowMetricsController,
  ],
  providers: [
    { provide: V1_IDEMPOTENCY_REPOSITORY, useClass: V1IdempotencyPrismaRepository },
    { provide: V1_SNAPSHOT_REPOSITORY, useClass: V1SnapshotPrismaRepository },
    { provide: V1_TASK_REPOSITORY, useClass: V1TaskPrismaRepository },
    { provide: V1_ARTIFACT_REPOSITORY, useClass: V1ArtifactPrismaRepository },
    { provide: V1_CHANGE_REPOSITORY, useClass: V1ChangePrismaRepository },
    { provide: V1_BOARD_REPOSITORY, useClass: V1BoardPrismaRepository },
    { provide: V1_READY_REPOSITORY, useClass: V1ReadyPrismaRepository },
    V1TaskService,
    V1ReadyService,
    V1ArtifactService,
    V1ChangeService,
    V1BoardService,
    V1SnapshotService,
    V1FlowMetricsService,
  ],
  exports: [
    V1TaskService,
    V1ReadyService,
    V1ArtifactService,
    V1ChangeService,
    V1BoardService,
    V1SnapshotService,
    V1_IDEMPOTENCY_REPOSITORY,
  ],
})
export class V1TaskModule {}
