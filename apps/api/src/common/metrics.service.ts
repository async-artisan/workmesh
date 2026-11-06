import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private requests = 0;
  private failures = 0;
  private activeRequests = 0;
  private totalDurationMs = 0;
  private durations: number[] = [];
  private readonly statusCodes = new Map<number, number>();

  beginRequest(): void {
    this.activeRequests += 1;
  }

  record(durationMs: number, failed = false, statusCode?: number): void {
    this.requests += 1;
    this.totalDurationMs += durationMs;
    this.durations.push(durationMs);
    if (this.durations.length > 1000) this.durations.shift();
    if (failed) this.failures += 1;
    if (
      typeof statusCode === 'number' &&
      Number.isInteger(statusCode) &&
      statusCode >= 100 &&
      statusCode <= 599
    ) {
      this.statusCodes.set(statusCode, (this.statusCodes.get(statusCode) ?? 0) + 1);
    }
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }
  snapshot() {
    const sorted = [...this.durations].sort((a, b) => a - b);
    const percentile = (ratio: number) =>
      sorted.length ? Number(sorted[Math.ceil(sorted.length * ratio) - 1].toFixed(2)) : 0;
    return {
      requests: this.requests,
      failures: this.failures,
      activeRequests: this.activeRequests,
      statusCodes: Object.fromEntries(
        [...this.statusCodes.entries()]
          .sort(([left], [right]) => left - right)
          .map(([status, count]) => [String(status), count]),
      ),
      averageDurationMs: this.requests
        ? Number((this.totalDurationMs / this.requests).toFixed(2))
        : 0,
      p95DurationMs: percentile(0.95),
      p99DurationMs: percentile(0.99),
    };
  }
}
