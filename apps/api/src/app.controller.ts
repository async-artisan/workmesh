import { Controller, Get } from '@nestjs/common';
import { MetricsService } from './common/metrics.service';

@Controller()
export class AppController {
  constructor(private readonly metrics: MetricsService) {}
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('metrics')
  metricsSnapshot() {
    return this.metrics.snapshot();
  }
}
