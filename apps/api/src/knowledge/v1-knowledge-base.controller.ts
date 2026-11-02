import { Body, Controller, Get, Headers, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError, type Confirmation } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { KNOWLEDGE_GRANT_PERMISSIONS, KNOWLEDGE_VISIBILITIES } from './v1-knowledge-base-policy';
import { V1KnowledgeBaseService } from './v1-knowledge-base.service';

const KNOWLEDGE_BASE_KEY = /^[a-z0-9-]+$/;

class ConfirmationDto {
  @IsUUID() ticketId!: string;

  @IsString() @MaxLength(64) ticketSecret!: string;
}

class CreateKnowledgeBaseDto {
  @IsString() @MinLength(1) @MaxLength(48) @Matches(KNOWLEDGE_BASE_KEY) key!: string;

  @IsString() @MinLength(1) @MaxLength(120) name!: string;

  @IsIn(KNOWLEDGE_VISIBILITIES) visibility!: 'PROJECT' | 'RESTRICTED';
}

class ListKnowledgeBasesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;

  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}

class ReplaceGrantDto {
  @IsIn(['USER', 'ROLE']) subjectKind!: 'USER' | 'ROLE';

  @IsOptional() @IsUUID() subjectUserId?: string | null;

  @IsOptional() @IsUUID() subjectRoleId?: string | null;

  @IsArray() @ArrayMinSize(1) @IsIn(KNOWLEDGE_GRANT_PERMISSIONS, { each: true }) permissions!: string[];
}

class ReplaceAccessDto {
  @IsInt() @Min(1) expectedVersion!: number;

  @IsInt() @Min(1) expectedAuthzVersion!: number;

  @IsIn(KNOWLEDGE_VISIBILITIES) visibility!: 'PROJECT' | 'RESTRICTED';

  @IsUUID() publicationApproverUserId!: string;

  @IsOptional() @IsUUID() publicationApproverRoleId?: string | null;

  @IsArray() @ValidateNested({ each: true }) @Type(() => ReplaceGrantDto) grants!: ReplaceGrantDto[];

  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}

class SearchKnowledgeBaseQueryDto {
  @IsString() @MinLength(1) @MaxLength(500) q!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;

  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
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
    operationId: randomUUID(),
  };
}

function confirmationOf(dto: ConfirmationDto): Confirmation {
  return { ticketId: dto.ticketId, ticketSecret: dto.ticketSecret };
}

@UseGuards(V1AuthGuard)
@Controller('v1')
export class V1KnowledgeBaseController {
  constructor(@Inject(V1KnowledgeBaseService) private readonly knowledgeBases: V1KnowledgeBaseService) {}

  @Post('projects/:projectId/knowledge-bases')
  create(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: CreateKnowledgeBaseDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    return this.knowledgeBases.createKnowledgeBase(
      principal,
      projectId,
      { key: dto.key, name: dto.name, visibility: dto.visibility },
      actionContext(request, key, { key: dto.key, name: dto.name, visibility: dto.visibility }),
    );
  }

  @Get('projects/:projectId/knowledge-bases')
  list(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query() query: ListKnowledgeBasesQueryDto,
  ) {
    return this.knowledgeBases.listKnowledgeBases(principalOf(request), projectId, {
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
  }

  @Get('knowledge-bases/:knowledgeBaseId/access')
  getAccess(@Req() request: V1Request, @Param('knowledgeBaseId') knowledgeBaseId: string) {
    return this.knowledgeBases.getAccess(principalOf(request), knowledgeBaseId);
  }

  /** ACL 替换必须带一次性票据；requestDigest 覆盖除 confirmation 外的全部语义字段。 */
  @Put('knowledge-bases/:knowledgeBaseId/access')
  replaceAccess(
    @Req() request: V1Request,
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Body() dto: ReplaceAccessDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    if (!principal.sessionId)
      throw new WorkmeshError(V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, 'HUMAN_SESSION_REQUIRED', undefined, 403);
    const grants = dto.grants.map((grant) => ({
      subjectKind: grant.subjectKind,
      subjectUserId: grant.subjectUserId ?? null,
      subjectRoleId: grant.subjectRoleId ?? null,
      permissions: grant.permissions,
    }));
    return this.knowledgeBases.replaceAccess(
      principal,
      knowledgeBaseId,
      {
        expectedVersion: dto.expectedVersion,
        expectedAuthzVersion: dto.expectedAuthzVersion,
        visibility: dto.visibility,
        publicationApproverUserId: dto.publicationApproverUserId,
        publicationApproverRoleId: dto.publicationApproverRoleId ?? null,
        grants,
        reason: dto.reason,
        confirmation: confirmationOf(dto.confirmation),
      },
      {
        ...actionContext(request, key, {
          expectedVersion: dto.expectedVersion,
          expectedAuthzVersion: dto.expectedAuthzVersion,
          visibility: dto.visibility,
          publicationApproverUserId: dto.publicationApproverUserId,
          publicationApproverRoleId: dto.publicationApproverRoleId ?? null,
          grants,
          reason: dto.reason,
        }),
        webSessionId: principal.sessionId,
        userAuthVersion: principal.authVersion ?? 0,
      },
    );
  }

  @Get('knowledge-bases/:knowledgeBaseId/search')
  search(
    @Req() request: V1Request,
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Query() query: SearchKnowledgeBaseQueryDto,
  ) {
    return this.knowledgeBases.search(principalOf(request), knowledgeBaseId, {
      q: query.q,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
  }
}
