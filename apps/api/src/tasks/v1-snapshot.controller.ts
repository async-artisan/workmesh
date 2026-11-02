import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { V1SnapshotService } from './v1-snapshot.service';

class CreateSnapshotDto {
  /** expectedVersion 指 Task.version；不接受 0 或缺失。 */
  @IsInt() @Min(1) expectedVersion!: number;

  @IsUUID() claimId!: string;

  @IsOptional() @IsArray() @IsUUID('4', { each: true }) candidateRevisionIds?: string[];
}

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1')
export class V1SnapshotController {
  constructor(@Inject(V1SnapshotService) private readonly snapshots: V1SnapshotService) {}

  /**
   * 创建上下文快照：当前认领 + 当前版本 + 全部必需输入可取得才落盘；
   * 同 Idempotency-Key 重放返回同一快照。
   */
  @Post('tasks/:taskId/context-snapshots')
  create(
    @Req() request: V1Request,
    @Param('taskId') taskId: string,
    @Body() dto: CreateSnapshotDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    return this.snapshots.create(
      principal,
      taskId,
      {
        expectedVersion: dto.expectedVersion,
        claimId: dto.claimId,
        candidateRevisionIds: dto.candidateRevisionIds,
      },
      {
        idempotencyKey: key,
        method: request.method,
        route: request.originalUrl ?? `/api/v1/tasks/${taskId}/context-snapshots`,
        body: {
          expectedVersion: dto.expectedVersion,
          claimId: dto.claimId,
          candidateRevisionIds: dto.candidateRevisionIds ?? [],
        },
        now: new Date(),
        operationId: crypto.randomUUID(),
        webSessionId: principal.sessionId ?? '',
        userAuthVersion: principal.authVersion ?? 0,
      },
    );
  }

  @Get('context-snapshots/:snapshotId')
  get(@Req() request: V1Request, @Param('snapshotId') snapshotId: string) {
    return this.snapshots.getSnapshot(principalOf(request), snapshotId);
  }

  @Get('context-snapshots/:snapshotId/resources/:refId')
  resource(
    @Req() request: V1Request,
    @Param('snapshotId') snapshotId: string,
    @Param('refId') refId: string,
  ) {
    return this.snapshots.getResource(principalOf(request), snapshotId, refId).then((body) => ({
      refId: body.refId,
      encoding: 'base64' as const,
      bodyBase64: Buffer.from(body.bodyBytes).toString('base64'),
      byteLength: body.byteLength,
      sha256: body.sha256,
    }));
  }
}
