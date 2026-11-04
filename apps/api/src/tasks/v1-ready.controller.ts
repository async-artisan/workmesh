import { Controller, Get, Inject, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { etagOf, ifNoneMatchMatches } from '../common/conditional-request';
import { V1ReadyService } from './v1-ready.service';

class ReadyQueryDto {
  @IsOptional() @IsString() @MaxLength(64) roleId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;

  @IsOptional() @IsString() @MaxLength(2000) cursor?: string;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

/**
 * 就绪任务列表：Agent 固定本凭据角色，人类按当前责任范围与管理者可见性过滤。
 *
 * 支持条件请求（RFC 7232）：Agent 常按固定间隔轮询本端点，带 `If-None-Match`
 * 命中时回 304 且不传正文，轮询的传输与解析成本随之消失。
 */
@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class V1ReadyController {
  constructor(@Inject(V1ReadyService) private readonly ready: V1ReadyService) {}

  @Get(':projectId/tasks/ready')
  async list(
    @Req() request: V1Request,
    @Res({ passthrough: true }) response: Response,
    @Param('projectId') projectId: string,
    @Query() query: ReadyQueryDto,
  ) {
    const page = await this.ready.ready(principalOf(request), projectId, {
      roleId: query.roleId ?? null,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });

    // 验证器只由载荷派生。绝不能对 {data, meta} 信封求值：meta.requestId 每次都变，
    // 那样 ETag 永远不会命中，304 就成了死代码。
    const etag = etagOf(page);
    response.setHeader('ETag', etag);
    // private：同一 URL 对不同 Agent/不同人结果不同，不能被共享缓存复用。
    // no-cache：允许本地缓存，但每次仍须回源校验——这正是 304 成立的前提。
    response.setHeader('Cache-Control', 'private, no-cache');

    const ifNoneMatch = request.headers['if-none-match'];
    const candidates = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(', ') : ifNoneMatch;
    if (ifNoneMatchMatches(candidates, etag)) {
      response.status(304);
      // 304 不得携带正文；Express 在 send 时会按状态码清掉载荷。
      return undefined;
    }
    return page;
  }
}
