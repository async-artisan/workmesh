import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PrdService } from './prd.service';

@UseGuards(AuthGuard)
@Controller('requirements/:requirementId/prds')
export class PrdController {
  constructor(private readonly prds: PrdService) {}
  @Get() list(
    @Req() req: Request & { user?: { sub: string } },
    @Param('requirementId') requirementId: string,
  ) {
    return this.prds.list(req.user!.sub, requirementId);
  }
  @Post() create(
    @Req() req: Request & { user?: { sub: string } },
    @Param('requirementId') requirementId: string,
    @Body() body: { title?: string; content: string; templateId?: string },
  ) {
    return this.prds.create(req.user!.sub, requirementId, body);
  }
}
