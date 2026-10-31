import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { TraceService } from './trace.service';
class TraceDto {
  @IsString() kind!: string;
  @IsString() targetId!: string;
  @IsOptional() @IsString() prdId?: string;
  @IsOptional() @IsObject() metadata?: object;
}
@UseGuards(AuthGuard)
@Controller('traces')
export class TraceController {
  constructor(private readonly traces: TraceService) {}
  @Get('requirement/:id') list(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
  ) {
    return this.traces.list(req.user!.sub, id);
  }
  @Post('requirement/:id') create(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() dto: TraceDto,
  ) {
    return this.traces.create(req.user!.sub, id, dto.kind, dto.targetId, dto.prdId, dto.metadata);
  }
  @Get('project/:id/graph') graph(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
  ) {
    return this.traces.graph(req.user!.sub, id);
  }
}
