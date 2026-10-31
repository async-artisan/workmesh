import {
  Body,
  Controller,
  Get,
  Headers,
  MessageEvent,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { AiService } from './ai.service';
import { AiRunsService } from './ai-runs.service';
import {
  AiRunQueryDto,
  ConfirmAiRunDto,
  CreateAiRunDto,
  CreateAiRunMessageDto,
} from './ai-runs.dto';

@UseGuards(AuthGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    @Optional() private readonly runs?: AiRunsService,
  ) {}

  @Post('runs') createRun(
    @Req() req: Request & { user?: { sub: string } },
    @Body() dto: CreateAiRunDto,
  ) {
    return this.runs!.create(req.user!.sub, dto.projectId);
  }

  @Get('runs') listRuns(
    @Req() req: Request & { user?: { sub: string } },
    @Query() query: AiRunQueryDto,
  ) {
    return this.runs!.list(req.user!.sub, query);
  }

  @Get('runs/:id') getRun(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
  ) {
    return this.runs!.get(req.user!.sub, id);
  }

  @Post('runs/:id/messages') addMessage(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() dto: CreateAiRunMessageDto,
  ) {
    return this.runs!.addMessage(req.user!.sub, id, dto.content);
  }

  @Post('runs/:id/pause') pause(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
  ) {
    return this.runs!.pause(req.user!.sub, id);
  }

  @Post('runs/:id/resume') resume(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
  ) {
    return this.runs!.resume(req.user!.sub, id);
  }

  @Post('runs/:id/cancel') cancel(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
  ) {
    return this.runs!.cancel(req.user!.sub, id);
  }

  @Post('runs/:id/confirm') confirm(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() dto: ConfirmAiRunDto,
  ) {
    return this.runs!.confirm(req.user!.sub, id, dto);
  }

  @Get('runs/:id/events') async events(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = /^\d+$/.test(lastEventId ?? '') ? Number(lastEventId) : 0;
    let sequence = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
    const writeEvent = (event: {
      sequence: number;
      role: string;
      eventType: string;
      content: string;
      createdAt: Date;
    }) => {
      const state = event.role === 'SYSTEM' ? parseState(event.content) : undefined;
      response.write(
        `id: ${event.sequence}\nevent: ${eventTypeName(event.eventType)}\ndata: ${JSON.stringify({
          sequence: event.sequence,
          role: event.role,
          content: event.content,
          createdAt: event.createdAt,
          ...(state ? { state } : {}),
        })}\n\n`,
      );
      sequence = event.sequence;
    };
    const initial = await this.runs!.events(req.user!.sub, id, sequence);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();
    for (const event of initial) writeEvent(event);

    let polling = false;
    let heartbeatAt = Date.now();
    const poll = async () => {
      if (polling || response.destroyed || response.writableEnded) return;
      polling = true;
      try {
        const events = await this.runs!.events(req.user!.sub, id, sequence);
        for (const event of events) writeEvent(event);
        if (events.length) heartbeatAt = Date.now();
      } catch {
        clearInterval(timer);
        response.end();
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => {
      if (Date.now() - heartbeatAt >= 15_000) {
        response.write(
          `id: ${sequence}\nevent: heartbeat\ndata: ${JSON.stringify({
            sequence,
            role: 'SYSTEM',
            content: '',
            createdAt: new Date(),
          })}\n\n`,
        );
        heartbeatAt = Date.now();
      }
      void poll();
    }, 1_000);
    response.on('close', () => clearInterval(timer));
  }

  @Sse('stream')
  stream(@Query('prompt') prompt = ''): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      void (async () => {
        try {
          for await (const content of this.ai.stream([{ role: 'user', content: prompt }]))
            subscriber.next({ data: { content, done: false } });
          subscriber.next({ data: { content: '', done: true } });
          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      })();
    });
  }
}

function eventTypeName(value: string) {
  const names: Record<string, string> = {
    RUN_STARTED: 'run.started',
    RUN_PROCESSING: 'run.processing',
    MESSAGE_CREATED: 'message.created',
    STEP_CHANGED: 'step.changed',
    DRAFT_UPDATED: 'draft.updated',
    RUN_WAITING_CONFIRMATION: 'run.waiting_confirmation',
    RUN_COMPLETED: 'run.completed',
    RUN_PAUSED: 'run.paused',
    RUN_RESUMED: 'run.resumed',
    RUN_CANCELLED: 'run.cancelled',
    RUN_FAILED: 'run.failed',
    HEARTBEAT: 'heartbeat',
  };
  return names[value] ?? 'message.created';
}

function parseState(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
