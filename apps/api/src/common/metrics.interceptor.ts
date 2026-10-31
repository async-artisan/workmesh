import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { catchError, finalize, Observable, throwError } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    let failed = false;
    return next.handle().pipe(
      catchError((error) => {
        failed = true;
        return throwError(() => error);
      }),
      finalize(() => this.metrics.record(Date.now() - started, failed)),
    );
  }
}
