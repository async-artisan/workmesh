import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { V1ReviewModule } from './reviews/v1-review.module';
import { V1TaskModule } from './tasks/v1-task.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { V1WorkbenchModule } from './workbench/v1-workbench.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { V1OperationReceiptModule } from './common/v1-operation-receipt.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { StrictJsonInterceptor } from './common/strict-json.interceptor';
import { MetricsInterceptor } from './common/metrics.interceptor';
import { MetricsService } from './common/metrics.service';
import { ReadinessService } from './common/readiness.service';
import { RetentionService } from './common/retention.service';
import { PrismaModule } from './prisma/prisma.module';
import { RequestContextMiddleware } from './common/request-context.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    AuthModule,
    ProjectsModule,
    KnowledgeModule,
    V1ReviewModule,
    V1TaskModule,
    V1WorkbenchModule,
    WorkflowsModule,
    IntegrationsModule,
    V1OperationReceiptModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: StrictJsonInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    MetricsService,
    ReadinessService,
    RetentionService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
