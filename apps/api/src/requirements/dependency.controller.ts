import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { DependencyService } from './dependency.service';
class DependencyDto {
  @IsUUID() toId!: string;
  @IsOptional() @IsString() type?: string;
}
@UseGuards(AuthGuard)
@Controller('requirements/:requirementId/dependencies')
export class DependencyController {
  constructor(private readonly dependencies: DependencyService) {}
  @Get() list(
    @Req() req: Request & { user?: { sub: string } },
    @Param('requirementId') id: string,
  ) {
    return this.dependencies.list(req.user!.sub, id);
  }
  @Post() create(
    @Req() req: Request & { user?: { sub: string } },
    @Param('requirementId') id: string,
    @Body() dto: DependencyDto,
  ) {
    return this.dependencies.create(req.user!.sub, id, dto.toId, dto.type);
  }
  @Delete(':id') remove(@Req() req: Request & { user?: { sub: string } }, @Param('id') id: string) {
    return this.dependencies.remove(req.user!.sub, id);
  }
}
