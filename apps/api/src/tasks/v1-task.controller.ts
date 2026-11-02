import { Body, Controller, Get, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { V1TaskService } from './v1-task.service';
import { V1ArtifactService } from './v1-artifact.service';
import { type V1ArtifactKind, type V1ArtifactStorage } from './v1-artifact.repository';

class ClaimDto {}

class ReleaseDto {
  @IsUUID() claimId!: string;

  @IsOptional() @IsString() @MaxLength(1000) releaseReason?: string | null;
}

class WorkStatusDto {
  @IsUUID() claimId!: string;

  @IsIn(['ACTIVE', 'BLOCKED', 'PAUSED', 'CANCELLED']) workStatus!: string;
}

class DeliverCheckDto {
  @IsString() @MaxLength(100) code!: string;

  @IsBoolean() passed!: boolean;

  @IsOptional() @IsString() @MaxLength(500) message?: string;
}

class DeliverArtifactDto {
  @IsIn(['PRD', 'DESIGN', 'IMPL', 'CASES', 'RELEASE']) kind!: V1ArtifactKind;

  @Matches(/^1\.0$/) schemaVersion!: string;

  @IsIn(['HOSTED', 'GIT_REF']) storage!: V1ArtifactStorage;

  @IsString() @MaxLength(100) mediaType!: string;

  @Matches(/^[0-9a-f]{64}$/) sha256!: string;

  @IsInt() @Min(0) byteLength!: number;

  @IsOptional() @IsString() bodyBase64?: string | null;

  @IsOptional() @IsUUID() projectRepositoryId?: string | null;

  @IsOptional() @Matches(/^[0-9a-f]{40}$/) commitSha?: string | null;

  @IsOptional() @IsString() @MaxLength(500) repoPath?: string | null;

  @IsOptional() @IsString() @MaxLength(2000) summary?: string | null;

  @IsArray() @ValidateNested({ each: true }) @Type(() => DeliverCheckDto) checks!: DeliverCheckDto[];
}

class DeliverDto {
  @IsInt() @Min(1) expectedVersion!: number;

  @IsUUID() claimId!: string;

  @IsUUID() snapshotId!: string;

  @IsUUID() workflowDefinitionRevisionId!: string;

  @IsString() @MaxLength(120) localRunId!: string;

  @IsArray() @IsUUID('4', { each: true }) candidateRevisionIds!: string[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => DeliverArtifactDto) items!: DeliverArtifactDto[];
}

function principalOf(request: V1Request) {
  if (!request.v1Principal) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

function actionContext(request: V1Request, idempotencyKey: string, body: Record<string, unknown>) {
  return {
    idempotencyKey,
    method: request.method,
    route: request.originalUrl ?? request.url,
    body,
    requestId: request.requestId ?? '',
    now: new Date(),
    operationId: crypto.randomUUID(),
  };
}

@UseGuards(V1AuthGuard)
@Controller('v1/tasks')
export class V1TaskController {
  constructor(
    @Inject(V1TaskService) private readonly tasks: V1TaskService,
    @Inject(V1ArtifactService) private readonly artifacts: V1ArtifactService,
  ) {}

  @Get(':taskId')
  get(@Req() request: V1Request, @Param('taskId') taskId: string) {
    return this.tasks.getTask(principalOf(request), taskId);
  }

  /**
   * 认领：HUMAN 或具备 task:claim 的 AGENT 显式取得任务独占权；同 Idempotency-Key 重放得同一结果。
   * 双认领单胜：并发第二次在事务内复核到未释放认领而拒绝。
   */
  @Post(':taskId/claims')
  claim(@Req() request: V1Request, @Param('taskId') taskId: string, @Body() _body: ClaimDto, @Headers('idempotency-key') idempotencyKey: string) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    return this.tasks.claim(principal, taskId, actionContext(request, key, {}));
  }

  @Post(':taskId/release')
  release(
    @Req() request: V1Request,
    @Param('taskId') taskId: string,
    @Body() dto: ReleaseDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    return this.tasks.release(
      principal,
      taskId,
      dto.claimId,
      actionContext(request, key, { claimId: dto.claimId, releaseReason: dto.releaseReason ?? null }),
      dto.releaseReason ?? null,
    );
  }

  @Post(':taskId/work-status')
  setWorkStatus(
    @Req() request: V1Request,
    @Param('taskId') taskId: string,
    @Body() dto: WorkStatusDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    return this.tasks.setWorkStatus(
      principal,
      taskId,
      dto.claimId,
      dto.workStatus,
      actionContext(request, key, { claimId: dto.claimId, workStatus: dto.workStatus }),
    );
  }

  /**
   * 交付工件集：必须引用既有上下文快照，并在有效认领下绑定任务版本与代次；
   * 同 Idempotency-Key 重放得同一结果，不产生重复 ArtifactSet。
   */
  @Post(':taskId/artifact-sets')
  deliver(
    @Req() request: V1Request,
    @Param('taskId') taskId: string,
    @Body() dto: DeliverDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    const body = {
      expectedVersion: dto.expectedVersion,
      claimId: dto.claimId,
      snapshotId: dto.snapshotId,
      workflowDefinitionRevisionId: dto.workflowDefinitionRevisionId,
      localRunId: dto.localRunId,
      candidateRevisionIds: dto.candidateRevisionIds,
      items: dto.items,
    };
    return this.artifacts.deliver(
      principal,
      taskId,
      {
        ...body,
        items: dto.items.map((item) => ({
          ...item,
          bodyBase64: item.bodyBase64 ?? null,
          projectRepositoryId: item.projectRepositoryId ?? null,
          commitSha: item.commitSha ?? null,
          repoPath: item.repoPath ?? null,
          summary: item.summary ?? null,
        })),
      },
      {
        ...actionContext(request, key, body),
        webSessionId: principal.sessionId ?? '',
        userAuthVersion: principal.authVersion ?? 0,
      },
    );
  }
}

@UseGuards(V1AuthGuard)
@Controller('v1/artifact-sets')
export class V1ArtifactSetController {
  constructor(@Inject(V1ArtifactService) private readonly artifacts: V1ArtifactService) {}

  @Get(':id')
  get(@Req() request: V1Request, @Param('id') id: string) {
    return this.artifacts.getArtifactSet(principalOf(request), id);
  }
}
