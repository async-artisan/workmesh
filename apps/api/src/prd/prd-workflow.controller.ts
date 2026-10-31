import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ApprovalStatus, DecisionStatus, SpecStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PrdWorkflowService } from './prd-workflow.service';

class UpdateSpecContentDto {
  @IsOptional() @IsString() @Length(1, 200) title?: string;
  @IsOptional() @IsString() @MaxLength(100_000) content?: string;
}

class UpdateDecisionContentDto {
  @IsOptional() @IsString() @Length(1, 200) title?: string;
  @IsOptional() @IsString() @MaxLength(100_000) context?: string;
  @IsOptional() @IsString() @MaxLength(100_000) decision?: string;
  @IsOptional() @IsString() @MaxLength(100_000) consequences?: string;
}

@UseGuards(AuthGuard)
@Controller()
export class PrdWorkflowController {
  constructor(private readonly workflow: PrdWorkflowService) {}
  @Get('projects/:projectId/prd-templates') templates(
    @Req() req: Request & { user?: { sub: string } },
    @Param('projectId') projectId: string,
  ) {
    return this.workflow.templates(req.user!.sub, projectId);
  }
  @Post('projects/:projectId/prd-templates') createTemplate(
    @Req() req: Request & { user?: { sub: string } },
    @Param('projectId') projectId: string,
    @Body()
    body: {
      name: string;
      content: string;
      description?: string;
      variables?: unknown[];
      isDefault?: boolean;
    },
  ) {
    return this.workflow.createTemplate(req.user!.sub, projectId, body);
  }
  @Get('prds/:prdId/approvals')
  approvals(@Req() req: Request & { user?: { sub: string } }, @Param('prdId') prdId: string) {
    return this.workflow.approvals(req.user!.sub, prdId);
  }
  @Post('prds/:prdId/approvals') submit(
    @Req() req: Request & { user?: { sub: string } },
    @Param('prdId') prdId: string,
    @Body() body: { approverId: string; comment?: string },
  ) {
    return this.workflow.submitApproval(req.user!.sub, prdId, body.approverId, body.comment);
  }
  @Patch('prd-approvals/:id') decide(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() body: { status: ApprovalStatus; comment?: string },
  ) {
    return this.workflow.decideApproval(req.user!.sub, id, body.status, body.comment);
  }
  @Post('prds/:prdId/versions') revise(
    @Req() req: Request & { user?: { sub: string } },
    @Param('prdId') prdId: string,
    @Body() body: { content: string },
  ) {
    return this.workflow.revise(req.user!.sub, prdId, body.content);
  }
  @Get('prds/:prdId/versions') versions(
    @Req() req: Request & { user?: { sub: string } },
    @Param('prdId') prdId: string,
  ) {
    return this.workflow.versions(req.user!.sub, prdId);
  }
  @Post('prds/:prdId/versions/restore') restore(
    @Req() req: Request & { user?: { sub: string } },
    @Param('prdId') prdId: string,
    @Query('version', ParseIntPipe) version: number,
  ) {
    return this.workflow.restoreVersion(req.user!.sub, prdId, version);
  }
  @Get('prds/:prdId/export') async export(
    @Req() req: Request & { user?: { sub: string } },
    @Param('prdId') prdId: string,
    @Query('format') format: string | undefined,
    @Res() response: Response,
  ) {
    if (format === 'html') {
      const file = await this.workflow.exportHtml(req.user!.sub, prdId);
      response.type('text/html').attachment(file.filename).send(file.content);
      return;
    }
    const file = await this.workflow.exportMarkdown(req.user!.sub, prdId);
    response.type('text/markdown').attachment(file.filename).send(file.content);
  }
  @Get('projects/:projectId/specs') specs(
    @Req() req: Request & { user?: { sub: string } },
    @Param('projectId') projectId: string,
  ) {
    return this.workflow.specs(req.user!.sub, projectId);
  }
  @Post('projects/:projectId/specs') createSpec(
    @Req() req: Request & { user?: { sub: string } },
    @Param('projectId') projectId: string,
    @Body() body: { title: string; content: string; prdId?: string },
  ) {
    return this.workflow.createSpec(req.user!.sub, projectId, body.title, body.content, body.prdId);
  }
  @Patch('specs/:id') setSpecStatus(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() body: { status: SpecStatus },
  ) {
    return this.workflow.setSpecStatus(req.user!.sub, id, body.status);
  }
  @Patch('specs/:id/content') updateSpecContent(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() body: UpdateSpecContentDto,
  ) {
    if (!body.title && body.content === undefined)
      throw new BadRequestException('没有可更新的技术规格内容');
    return this.workflow.updateSpec(req.user!.sub, id, body);
  }
  @Get('projects/:projectId/decisions') decisions(
    @Req() req: Request & { user?: { sub: string } },
    @Param('projectId') projectId: string,
  ) {
    return this.workflow.decisions(req.user!.sub, projectId);
  }
  @Post('projects/:projectId/decisions') createDecision(
    @Req() req: Request & { user?: { sub: string } },
    @Param('projectId') projectId: string,
    @Body() body: { title: string; context: string; decision: string; consequences?: string },
  ) {
    return this.workflow.createDecision(
      req.user!.sub,
      projectId,
      body.title,
      body.context,
      body.decision,
      body.consequences,
    );
  }
  @Patch('decisions/:id') setDecisionStatus(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() body: { status: DecisionStatus },
  ) {
    return this.workflow.setDecisionStatus(req.user!.sub, id, body.status);
  }
  @Patch('decisions/:id/content') updateDecisionContent(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() body: UpdateDecisionContentDto,
  ) {
    if (
      !body.title &&
      body.context === undefined &&
      body.decision === undefined &&
      body.consequences === undefined
    )
      throw new BadRequestException('没有可更新的技术决策内容');
    return this.workflow.updateDecision(req.user!.sub, id, body);
  }
}
