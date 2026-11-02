import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../../node_modules/.prisma/workmesh-v1-client';

/**
 * 正式应用唯一受管 Prisma client。
 * 连接串只来自显式配置，避免领域代码各自创建客户端或回退隐式数据源。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: {
          url:
            process.env.WORKMESH_V1_DATABASE_URL ??
            'postgresql://127.0.0.1:5432/workmesh?schema=workmesh_v1',
        },
      },
    });
  }

  async onModuleInit() {
    if (process.env.WORKMESH_V1_DATABASE_URL) await this.$connect();
  }

  async onModuleDestroy() {
    if (process.env.WORKMESH_V1_DATABASE_URL) await this.$disconnect();
  }
}
