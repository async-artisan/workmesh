import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CreateProjectDto, UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';
@UseGuards(AuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}
  @Get() list(@Req() req: Request & { user?: { sub: string } }) {
    return this.projects.list(req.user!.sub);
  }
  @Post() create(@Req() req: Request & { user?: { sub: string } }, @Body() dto: CreateProjectDto) {
    return this.projects.create(req.user!.sub, dto);
  }
  @Get(':id/members')
  members(@Req() req: Request & { user?: { sub: string } }, @Param('id') id: string) {
    return this.projects.members(req.user!.sub, id);
  }
  @Put(':id') update(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(req.user!.sub, id, dto);
  }
  @Delete(':id') remove(@Req() req: Request & { user?: { sub: string } }, @Param('id') id: string) {
    return this.projects.remove(req.user!.sub, id);
  }
}
