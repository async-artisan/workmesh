import { describe, expect, it } from 'vitest';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('tracks in-flight requests and low-cardinality status counts', () => {
    const metrics = new MetricsService();

    metrics.beginRequest();
    expect(metrics.snapshot()).toMatchObject({ activeRequests: 1, requests: 0 });

    metrics.record(12.345, false, 200);
    metrics.beginRequest();
    metrics.record(40, true, 503);

    expect(metrics.snapshot()).toMatchObject({
      requests: 2,
      failures: 1,
      activeRequests: 0,
      statusCodes: { '200': 1, '503': 1 },
      averageDurationMs: 26.17,
    });
  });

  it('keeps direct record calls backwards compatible', () => {
    const metrics = new MetricsService();
    metrics.record(4);
    expect(metrics.snapshot()).toMatchObject({ requests: 1, activeRequests: 0 });
  });
});
