import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { TraceController } from './trace.controller';
import { TraceService } from './trace.service';
@Module({ imports: [ProjectsModule], controllers: [TraceController], providers: [TraceService] })
export class TraceModule {}
