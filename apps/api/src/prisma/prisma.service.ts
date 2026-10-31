import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: { url: process.env.DATABASE_URL ?? 'postgresql://127.0.0.1:5432/reqflow' },
      },
    });
  }

  async onModuleInit() {
    if (process.env.DATABASE_URL) await this.$connect();
  }

  async onModuleDestroy() {
    if (process.env.DATABASE_URL) await this.$disconnect();
  }
}
