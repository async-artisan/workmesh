import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

describe('MetricsInterceptor', () => {
  it('records the response status and closes the active request slot', async () => {
    const metrics = new MetricsService();
    const response = { statusCode: 201 };
    const context = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as never;
    const interceptor = new MetricsInterceptor(metrics);

    await lastValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) }));

    expect(metrics.snapshot()).toMatchObject({
      requests: 1,
      activeRequests: 0,
      statusCodes: { '201': 1 },
    });
  });

  it('records an exception status before the HTTP exception filter runs', async () => {
    const metrics = new MetricsService();
    const context = {
      switchToHttp: () => ({ getResponse: () => ({ statusCode: 200 }) }),
    } as never;
    const interceptor = new MetricsInterceptor(metrics);

    await expect(
      lastValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => ({ status: 503 })),
        }),
      ),
    ).rejects.toMatchObject({ status: 503 });

    expect(metrics.snapshot()).toMatchObject({
      failures: 1,
      activeRequests: 0,
      statusCodes: { '503': 1 },
    });
  });
});
