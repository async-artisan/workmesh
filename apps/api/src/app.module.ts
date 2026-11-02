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
import { IntegrationsModule } from './integrations/integrations.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { V1OperationReceiptModule } from './common/v1-operation-receipt.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { StrictJsonInterceptor } from './common/strict-json.interceptor';
import { MetricsInterceptor } from './common/metrics.interceptor';
import { MetricsService } from './common/metrics.service';
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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
