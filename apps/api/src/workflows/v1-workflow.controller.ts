import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  V1_ERROR_CODES,
  WorkmeshError,
  type Confirmation,
  type WorkflowPackageLock,
} from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { V1WorkflowService } from './v1-workflow.service';

class ConfirmationDto {
  @IsUUID() ticketId!: string;

  @IsString() @MaxLength(64) ticketSecret!: string;
}

class PackageLockDto {
  @IsString() @MaxLength(100) roleKey!: string;

  @IsString() @MaxLength(200) packageId!: string;

  @IsString() @MaxLength(100) version!: string;

  @IsString() @MaxLength(64) packageDigest!: string;
}

class ValidateDto {
  @IsObject() definition!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageLockDto)
  packageLocks?: PackageLockDto[];
}

class PublishDto extends ValidateDto {
  @IsInt() @Min(1) expectedVersion!: number;

  @IsInt() @Min(0) expectedCurrentRevision!: number;

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}

class StepBindingDto {
  @IsString() @MaxLength(100) stepKey!: string;

  @IsUUID() roleId!: string;

  @IsUUID() responsibleUserId!: string;

  @IsOptional() @IsArray() @IsUUID('4', { each: true }) repositoryIds?: string[];

  /** 本步骤覆盖的验收 key；未覆盖任何验收的 PRD 条目会在服务端被拒。 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @Matches(/^[A-Za-z0-9._-]{1,64}$/, { each: true })
  acceptanceKeys?: string[];
}

class RoleSlotBindingDto {
  @IsString() @MaxLength(100) slotKey!: string;

  @IsUUID() roleId!: string;

  @IsUUID() userId!: string;
}

class CreateInstanceDto {
  @IsUUID() definitionRevisionId!: string;

  @IsInt() @Min(1) expectedRequirementVersion!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StepBindingDto)
  stepBindings!: StepBindingDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleSlotBindingDto)
  roleSlotBindings!: RoleSlotBindingDto[];
}

class ListDefinitionsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;

  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

function confirmationOf(dto: ConfirmationDto): Confirmation {
  return { ticketId: dto.ticketId, ticketSecret: dto.ticketSecret };
}

function packageLocksOf(dtos: PackageLockDto[] | undefined): WorkflowPackageLock[] {
  return (dtos ?? []).map((lock) => ({
    roleKey: lock.roleKey,
    packageId: lock.packageId,
    version: lock.version,
    packageDigest: lock.packageDigest,
  }));
}

/**
 * v1 流程配置与实例路由。发布只接受人工确认票据；校验接口绝不落库。
 */
@UseGuards(V1AuthGuard)
@Controller('v1')
export class V1WorkflowController {
  constructor(@Inject(V1WorkflowService) private readonly workflows: V1WorkflowService) {}

  @Get('projects/:projectId/workflow-definitions')
  list(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query() query: ListDefinitionsQueryDto,
  ) {
    return this.workflows.listDefinitions(principalOf(request), projectId, {
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
  }

  @Get('projects/:projectId/workflow-templates')
  templates(@Req() request: V1Request, @Param('projectId') projectId: string) {
    return this.workflows.templates(principalOf(request), projectId);
  }

  @Post('projects/:projectId/workflow-definitions/validate')
  validate(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: ValidateDto,
  ) {
    return this.workflows.validate(principalOf(request), projectId, {
      definition: dto.definition,
      packageLocks: packageLocksOf(dto.packageLocks),
    });
  }

  @Post('projects/:projectId/workflow-definitions/:workflowKey/publish')
  publish(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('workflowKey') workflowKey: string,
    @Body() dto: PublishDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    if (!principal.sessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
    return this.workflows.publish(
      principal,
      projectId,
      workflowKey,
      {
        expectedVersion: dto.expectedVersion,
        expectedCurrentRevision: dto.expectedCurrentRevision,
        definition: dto.definition,
        packageLocks: packageLocksOf(dto.packageLocks),
        confirmation: confirmationOf(dto.confirmation),
      },
      {
        idempotencyKey: requireIdempotencyKey(idempotencyKey),
        method: request.method,
        route:
          request.originalUrl ??
          `/api/v1/projects/${projectId}/workflow-definitions/${workflowKey}/publish`,
        body: {
          expectedVersion: dto.expectedVersion,
          expectedCurrentRevision: dto.expectedCurrentRevision,
          definition: dto.definition,
          packageLocks: dto.packageLocks ?? [],
        },
        operationId: crypto.randomUUID(),
        now: new Date(),
        webSessionId: principal.sessionId,
        userAuthVersion: principal.authVersion ?? 0,
      },
    );
  }

  @Get('workflow-definition-revisions/:revisionId')
  revision(@Req() request: V1Request, @Param('revisionId') revisionId: string) {
    return this.workflows.getRevision(principalOf(request), revisionId);
  }

  @Post('requirements/:requirementId/workflow-instances')
  createInstance(
    @Req() request: V1Request,
    @Param('requirementId') requirementId: string,
    @Body() dto: CreateInstanceDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    if (!principal.sessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
    return this.workflows.createInstance(
      principal,
      requirementId,
      {
        definitionRevisionId: dto.definitionRevisionId,
        expectedRequirementVersion: dto.expectedRequirementVersion,
        stepBindings: dto.stepBindings.map((binding) => ({
          stepKey: binding.stepKey,
          roleId: binding.roleId,
          responsibleUserId: binding.responsibleUserId,
          repositoryIds: binding.repositoryIds ?? [],
          acceptanceKeys: binding.acceptanceKeys ?? [],
        })),
        roleSlotBindings: dto.roleSlotBindings.map((binding) => ({
          slotKey: binding.slotKey,
          roleId: binding.roleId,
          userId: binding.userId,
        })),
      },
      {
        idempotencyKey: requireIdempotencyKey(idempotencyKey),
        method: request.method,
        route: request.originalUrl ?? `/api/v1/requirements/${requirementId}/workflow-instances`,
        body: {
          definitionRevisionId: dto.definitionRevisionId,
          expectedRequirementVersion: dto.expectedRequirementVersion,
          stepBindings: dto.stepBindings,
          roleSlotBindings: dto.roleSlotBindings,
        },
        operationId: crypto.randomUUID(),
        now: new Date(),
        webSessionId: principal.sessionId,
        userAuthVersion: principal.authVersion ?? 0,
      },
    );
  }

  @Get('workflow-instances/:instanceId')
  instance(@Req() request: V1Request, @Param('instanceId') instanceId: string) {
    return this.workflows.getInstance(principalOf(request), instanceId);
  }
}
