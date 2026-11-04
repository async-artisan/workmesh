import { Controller, Get } from '@nestjs/common';
import { MetricsService } from './common/metrics.service';
import { ReadinessService } from './common/readiness.service';

@Controller()
export class AppController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly readiness: ReadinessService,
  ) {}

  /**
   * liveness：只回答「进程还活着吗」。故意不检查数据库——
   * 依赖检查见 `health/ready`，混在一起会让数据库抖动连带重启进程。
   */
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /**
   * readiness：数据库可达且迁移已应用；否则 503 `DEPENDENCY_UNAVAILABLE`。
   * `box doctor` / `box dev` 以本端点判定「能干活」，不再以 liveness 为准。
   */
  @Get('health/ready')
  ready() {
    return this.readiness.check();
  }

  @Get('metrics')
  metricsSnapshot() {
    return this.metrics.snapshot();
  }
}
