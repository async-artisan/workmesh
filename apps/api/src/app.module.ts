import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { PrdModule } from './prd/prd.module';
import { RequirementsModule } from './requirements/requirements.module';
import { ProjectsModule } from './projects/projects.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { TraceModule } from './trace/trace.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { MetricsInterceptor } from './common/metrics.interceptor';
import { MetricsService } from './common/metrics.service';
import { AuditInterceptor } from './common/audit.interceptor';
import { AuditService } from './common/audit.service';
import { PrismaModule } from './prisma/prisma.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      envFilePath: ['.env', '../../.env'],
      validate: (env) => {
        for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
          if (
            typeof env[key] !== 'string' ||
            env[key].length < 32 ||
            env[key].startsWith('replace-with-')
          ) {
            throw new Error(`${key} must be a unique random secret with at least 32 characters`);
          }
        }
        return env;
      },
    }),
    PrismaModule,
    AuthModule,
    AiModule,
    ProjectsModule,
    RequirementsModule,
    KnowledgeModule,
    PrdModule,
    TraceModule,
    IntegrationsModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    AuditService,
  ],
})
export class AppModule {}
