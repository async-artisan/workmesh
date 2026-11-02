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
import { V1_ERROR_CODES, WorkmeshError, type Confirmation } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { V1RolePackageService } from './v1-role-package.service';

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

class ConfirmationDto {
  @IsUUID() ticketId!: string;

  @IsString() @MaxLength(64) ticketSecret!: string;
}

class ResourceUploadDto {
  @IsString() @MaxLength(48) @Matches(/^[a-z][a-z0-9-]{0,47}$/) resourceId!: string;

  @IsString() @Matches(BASE64) bodyBase64!: string;
}

class RegisterRolePackageDto {
  @IsInt() @Min(1) expectedVersion!: number;

  @IsObject() manifest!: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResourceUploadDto)
  resources!: ResourceUploadDto[];

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}

class ListRolePackagesQueryDto {
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

/**
 * v1 角色包路由：只返回内置与本项目私有版本；登记只接受 HUMAN 管理者、精确版本与单次票据。
 */
@UseGuards(V1AuthGuard)
@Controller('v1/projects/:projectId/role-packages')
export class V1RolePackageController {
  constructor(@Inject(V1RolePackageService) private readonly packages: V1RolePackageService) {}

  @Get()
  list(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query() query: ListRolePackagesQueryDto,
  ) {
    return this.packages.list(principalOf(request), projectId, {
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
  }

  @Post()
  register(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: RegisterRolePackageDto,
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
    return this.packages.register(
      principal,
      projectId,
      {
        expectedVersion: dto.expectedVersion,
        manifest: dto.manifest,
        resources: dto.resources.map((resource) => ({
          resourceId: resource.resourceId,
          bodyBytes: new Uint8Array(Buffer.from(resource.bodyBase64, 'base64')),
        })),
        confirmation: confirmationOf(dto.confirmation),
      },
      {
        idempotencyKey: requireIdempotencyKey(idempotencyKey),
        method: request.method,
        route: request.originalUrl ?? `/api/v1/projects/${projectId}/role-packages`,
        body: {
          expectedVersion: dto.expectedVersion,
          manifest: dto.manifest,
          resources: dto.resources.map((resource) => ({
            resourceId: resource.resourceId,
            bodyBase64: resource.bodyBase64,
          })),
        },
        operationId: crypto.randomUUID(),
        now: new Date(),
        webSessionId: principal.sessionId,
        userAuthVersion: principal.authVersion ?? 0,
      },
    );
  }

  @Get(':packageId/versions/:version')
  version(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('packageId') packageId: string,
    @Param('version') version: string,
  ) {
    return this.packages.getVersion(principalOf(request), projectId, packageId, version);
  }

  @Get(':packageId/versions/:version/resources/:resourceId')
  resource(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('packageId') packageId: string,
    @Param('version') version: string,
    @Param('resourceId') resourceId: string,
  ) {
    return this.packages
      .getResource(principalOf(request), projectId, packageId, version, resourceId)
      .then((resource) => ({
        resourceId: resource.resourceId,
        path: resource.path,
        mediaType: resource.mediaType,
        encoding: 'base64',
        bodyBase64: Buffer.from(resource.bodyBytes).toString('base64'),
        byteLength: resource.byteLength,
        sha256: resource.sha256,
      }));
  }
}
