import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
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
  @Post('generate') generate(
    @Req() req: Request & { user?: { sub: string } },
    @Param('requirementId') requirementId: string,
    @Body() body: { templateId?: string; knowledgeBaseId?: string },
  ) {
    return this.prds.generate(req.user!.sub, requirementId, body);
  }
  @Sse('generate-stream') stream(
    @Req() req: Request & { user?: { sub: string } },
    @Param('requirementId') requirementId: string,
    @Query('templateId') templateId?: string,
    @Query('knowledgeBaseId') knowledgeBaseId?: string,
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      void (async () => {
        try {
          for await (const event of this.prds.generateStream(req.user!.sub, requirementId, {
            templateId,
            knowledgeBaseId,
          })) {
            if (subscriber.closed) break;
            subscriber.next({ data: event });
          }
          if (!subscriber.closed) subscriber.complete();
        } catch (error) {
          if (!subscriber.closed) subscriber.error(error);
        }
      })();
    });
  }
}
