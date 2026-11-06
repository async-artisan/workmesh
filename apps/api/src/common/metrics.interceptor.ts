import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { catchError, finalize, Observable, throwError } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    let failed = false;
    let statusCode: number | undefined;
    this.metrics.beginRequest();
    const response =
      typeof context.switchToHttp === 'function' ? context.switchToHttp().getResponse() : undefined;
    return next.handle().pipe(
      catchError((error) => {
        failed = true;
        const candidate = error as { status?: unknown; getStatus?: () => unknown };
        const fromException =
          typeof candidate.getStatus === 'function' ? candidate.getStatus() : candidate.status;
        if (typeof fromException === 'number' && Number.isInteger(fromException)) {
          statusCode = fromException;
        } else {
          statusCode = 500;
        }
        return throwError(() => error);
      }),
      finalize(() =>
        this.metrics.record(
          Date.now() - started,
          failed,
          statusCode ??
            (typeof response?.statusCode === 'number' ? response.statusCode : undefined) ??
            200,
        ),
      ),
    );
  }
}
