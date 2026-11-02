import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { V1_ERROR_CODES, WorkmeshError, type Confirmation } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { V1PublicationService } from './v1-publication.service';
import type { DocumentKind } from './v1-publication-policy';

const DOCUMENT_KINDS = ['UNDERSTANDING', 'DECISION', 'PRD', 'KNOWLEDGE'] as const;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

class ConfirmationDto {
  @IsUUID() ticketId!: string;

  @IsString() @MaxLength(64) ticketSecret!: string;
}

class BindingDto {
  @IsOptional() @IsUUID() basisUnderstandingRevisionId?: string | null;

  @IsOptional() @IsObject() deliveryScope?: Record<string, unknown>;

  @IsOptional() @IsArray() acceptance?: unknown[];
}

class CreateDocumentDto extends BindingDto {
  @IsUUID() knowledgeBaseId!: string;

  @IsIn(DOCUMENT_KINDS) kind!: DocumentKind;

  @IsOptional() @IsUUID() requirementId?: string | null;

  @IsString() @MaxLength(200) title!: string;

  @IsString() @MaxLength(100) mimeType!: string;

  /** 原始正文 base64；服务端按解码后的原始字节计算摘要，不按字符串 trim 或截断。 */
  @IsString() @Matches(BASE64) bodyBase64!: string;
}

class ProposeRevisionDto extends BindingDto {
  @IsString() @MaxLength(200) title!: string;

  @IsString() @MaxLength(100) mimeType!: string;

  @IsString() @Matches(BASE64) bodyBase64!: string;
}

class RestoreDto {
  @IsUUID() sourceRevisionId!: string;

  @IsOptional() @IsString() @MaxLength(200) title?: string | null;
}

class WithdrawDto {
  @IsInt() @Min(1) expectedVersion!: number;

  @IsString() @MaxLength(1000) reason!: string;

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}

class ListDocumentsQueryDto {
  @IsOptional() @IsIn(DOCUMENT_KINDS) kind?: DocumentKind;

  @IsOptional() @IsString() @MaxLength(100) q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;

  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

function confirmationOf(dto: ConfirmationDto): Confirmation {
  return { ticketId: dto.ticketId, ticketSecret: dto.ticketSecret };
}

/**
 * v1 知识候选路由。没有直接发布入口；发布只经由 POST /review-requests/:id/decisions 的最后 ALL APPROVE。
 */
@UseGuards(V1AuthGuard)
@Controller('v1')
export class V1PublicationController {
  constructor(@Inject(V1PublicationService) private readonly publications: V1PublicationService) {}

  @Get('projects/:projectId/documents')
  list(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query() query: ListDocumentsQueryDto,
  ) {
    return this.publications.listDocuments(principalOf(request), projectId, {
      kind: query.kind,
      q: query.q,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
  }

  @Post('projects/:projectId/documents')
  create(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.publications.createDocument(principalOf(request), projectId, {
      projectId,
      knowledgeBaseId: dto.knowledgeBaseId,
      kind: dto.kind,
      requirementId: dto.requirementId ?? null,
      title: dto.title,
      mimeType: dto.mimeType,
      bodyBytes: new Uint8Array(Buffer.from(dto.bodyBase64, 'base64')),
      basisUnderstandingRevisionId: dto.basisUnderstandingRevisionId ?? null,
      deliveryScope: dto.deliveryScope,
      acceptance: dto.acceptance,
    });
  }

  @Get('documents/:documentId')
  getDocument(@Req() request: V1Request, @Param('documentId') documentId: string) {
    return this.publications.getDocument(principalOf(request), documentId);
  }

  @Get('documents/:documentId/revisions')
  listRevisions(@Req() request: V1Request, @Param('documentId') documentId: string) {
    return this.publications.listRevisions(principalOf(request), documentId);
  }

  @Get('documents/:documentId/revisions/:revisionId')
  getRevision(
    @Req() request: V1Request,
    @Param('documentId') documentId: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.publications.getRevision(principalOf(request), revisionId).then((revision) => {
      if (revision.documentId !== documentId)
        throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REVISION_NOT_FOUND', { revisionId }, 404);
      return revision;
    });
  }

  @Get('document-revisions/:revisionId/content')
  content(@Req() request: V1Request, @Param('revisionId') revisionId: string) {
    return this.publications
      .getRevisionContent(principalOf(request), revisionId)
      .then((revision) => ({
        revisionId: revision.id,
        mimeType: revision.mimeType,
        encoding: 'base64',
        bodyBase64: Buffer.from(revision.bodyBytes).toString('base64'),
        byteLength: revision.byteLength,
        sha256: revision.digest,
      }));
  }

  @Post('documents/:documentId/revisions')
  propose(
    @Req() request: V1Request,
    @Param('documentId') documentId: string,
    @Body() dto: ProposeRevisionDto,
  ) {
    return this.publications.proposeRevision(principalOf(request), documentId, {
      title: dto.title,
      mimeType: dto.mimeType,
      bodyBytes: new Uint8Array(Buffer.from(dto.bodyBase64, 'base64')),
      basisUnderstandingRevisionId: dto.basisUnderstandingRevisionId ?? null,
      deliveryScope: dto.deliveryScope,
      acceptance: dto.acceptance,
    });
  }

  @Post('documents/:documentId/restore')
  restore(
    @Req() request: V1Request,
    @Param('documentId') documentId: string,
    @Body() dto: RestoreDto,
  ) {
    return this.publications.restoreRevision(principalOf(request), documentId, {
      sourceRevisionId: dto.sourceRevisionId,
      title: dto.title ?? null,
    });
  }

  @Post('documents/:documentId/withdraw')
  withdraw(
    @Req() request: V1Request,
    @Param('documentId') documentId: string,
    @Body() dto: WithdrawDto,
  ) {
    const principal = principalOf(request);
    if (!principal.sessionId)
      throw new WorkmeshError(V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, 'HUMAN_SESSION_REQUIRED', undefined, 403);
    return this.publications.withdraw(principal, documentId, {
      expectedVersion: dto.expectedVersion,
      reason: dto.reason,
      confirmation: confirmationOf(dto.confirmation),
      webSessionId: principal.sessionId,
      userAuthVersion: principal.authVersion ?? 0,
      now: new Date(),
    });
  }
}
