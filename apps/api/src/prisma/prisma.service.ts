import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../../node_modules/.prisma/workmesh-v1-client';
import { currentRequestId } from '../common/request-context.middleware';

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
    this.installRequestIdStamp();
  }

  /**
   * 给每条 `PrincipalStamp` 补上当前请求的 requestId。
   *
   * Prisma 5 使用 `$use` middleware；Prisma 6.14.0 移除了 Client middleware，
   * 改用 Client Extensions 的 `query` 扩展实现相同效果。
   * `$extends` 返回一个新的 extended client；使用 `Object.assign` 把扩展后的
   * client 属性合并回 `this`，保留 Nest 注入语义与现有调用方的 `PrismaService`
   * 类型兼容。交互式事务（`$transaction` callback）同样经过 query extension，
   * 与原 `$use` 行为一致。
   */
  private installRequestIdStamp(): void {
    const extended = this.$extends({
      query: {
        principalStamp: {
          create({ args, query }) {
            const requestId = currentRequestId();
            const data = args.data;
            // 只在请求范围内、且调用方没有显式指定时补：脚本与测试没有 requestId 上下文。
            if (requestId && data && typeof data === 'object' && !('requestId' in data)) {
              args.data = { ...data, requestId };
            }
            return query(args);
          },
        },
      },
    });
    Object.assign(this, extended);
  }

  async onModuleInit() {
    if (process.env.WORKMESH_V1_DATABASE_URL) await this.$connect();
  }

  async onModuleDestroy() {
    if (process.env.WORKMESH_V1_DATABASE_URL) await this.$disconnect();
  }
}
