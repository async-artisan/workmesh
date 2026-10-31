import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsEnum, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { RoleType, TaskStatus } from '@prisma/client';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { TasksService } from './tasks.service';

class CreateTaskDto {
  @IsString() @Length(1, 200) title!: string;
  @IsEnum(RoleType) role!: RoleType;
  @IsOptional() @IsArray() @IsString({ each: true }) acceptance?: string[];
  @IsOptional() @IsIn(['HUMAN', 'AGENT']) assigneeType?: string;
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) blockedBy?: string[];
}

class UpdateTaskStatusDto {
  @IsEnum(TaskStatus) status!: TaskStatus;
  @IsOptional() @IsIn(['HUMAN', 'AGENT']) actorType?: string;
}

@UseGuards(AuthGuard)
@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Get('requirements/:requirementId/tasks') list(
    @Req() req: Request & { user?: { sub: string } },
    @Param('requirementId') requirementId: string,
  ) {
    return this.tasks.list(req.user!.sub, requirementId);
  }
  @Post('requirements/:requirementId/tasks') create(
    @Req() req: Request & { user?: { sub: string } },
    @Param('requirementId') requirementId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(req.user!.sub, requirementId, dto);
  }
  // 各角色 agent 开工第一个动作：我该干什么
  @Get('tasks/ready') ready(
    @Req() req: Request & { user?: { sub: string } },
    @Query('role') role: RoleType,
    @Query('projectId') projectId?: string,
  ) {
    return this.tasks.ready(req.user!.sub, role, projectId);
  }
  @Patch('tasks/:id/status') status(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.tasks.updateStatus(req.user!.sub, id, dto.status, {
      type: dto.actorType ?? 'HUMAN',
    });
  }
  // 装配上下文包：编号 → 产品源 + 工件 + 任务 + 规则
  @Get('context/:code') context(
    @Req() req: Request & { user?: { sub: string } },
    @Param('code') code: string,
  ) {
    return this.tasks.context(req.user!.sub, code);
  }
}
