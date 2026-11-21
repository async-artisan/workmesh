import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsString, IsUUID, Matches, Min } from 'class-validator';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { V1VerificationService } from './v1-verification.service';

export class VerificationSyncDto {
  @IsUUID() projectRepositoryId!: string;
  @IsString() @Matches(/^[1-9][0-9]{0,19}$/) runId!: string;
  @IsInt() @Min(1) attempt!: number;
  @IsInt() @Min(1) expectedProjectVersion!: number;
}
export class VerificationBindDto {
  @IsUUID() artifactSetId!: string;
  @IsInt() @Min(1) expectedTaskVersion!: number;
  @IsInt() @Min(1) expectedTaskGeneration!: number;
  @IsUUID() snapshotId!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) manifestDigest!: string;
}
function principalOf(request: V1Request) {
  if (!request.v1Principal) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}
function contextOf(request: V1Request, key: string, body: object) {
  return { idempotencyKey: requireIdempotencyKey(key), method: request.method, route: request.originalUrl.split('?')[0], body: body as Record<string, unknown> };
}
function cursorOf(value: string | undefined) {
  if (value && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))
    throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'VERIFICATION_CURSOR_INVALID', undefined, 400);
  return value;
}

@UseGuards(V1AuthGuard)
@Controller('v1/projects/:projectId')
export class V1VerificationController {
  constructor(private readonly service: V1VerificationService) {}

  @Get('verification-evidence')
  list(@Req() request: V1Request, @Param('projectId', ParseUUIDPipe) projectId: string, @Query('cursor') cursor?: string) {
    return this.service.list(principalOf(request), projectId, cursorOf(cursor));
  }

  @Get('artifact-sets/:artifactSetId/verification-evidence')
  forArtifactSet(@Req() request: V1Request, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('artifactSetId', ParseUUIDPipe) artifactSetId: string, @Query('cursor') cursor?: string) {
    return this.service.forArtifactSet(principalOf(request), projectId, artifactSetId, cursorOf(cursor));
  }

  @Post('verification-evidence/sync')
  sync(@Req() request: V1Request, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: VerificationSyncDto, @Headers('idempotency-key') key: string) {
    return this.service.sync(principalOf(request), projectId, dto, contextOf(request, key, dto));
  }

  @Post('verification-evidence/:evidenceId/bind')
  bind(@Req() request: V1Request, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('evidenceId', ParseUUIDPipe) evidenceId: string, @Body() dto: VerificationBindDto, @Headers('idempotency-key') key: string) {
    return this.service.bind(principalOf(request), projectId, evidenceId, dto, contextOf(request, key, dto));
  }
}
