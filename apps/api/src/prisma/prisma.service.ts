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
   * 原先 stamp 从不写 requestId：审计记录与日志里的 requestId 对不上，用户把响应里的
   * requestId 报过来时，数据库里查不到任何关联行。各仓储层有 9 处 stamp 创建点，
   * 逐个补参数必然遗漏新的写入点，因此在一个地方统一注入。
   *
   * 事务内的操作同样经过本中间件（交互式事务取自同一个 client），所以不必额外处理。
   */
  private installRequestIdStamp(): void {
    this.$use(async (params, next) => {
      if (params.model === 'PrincipalStamp' && params.action === 'create') {
        const requestId = currentRequestId();
        const data = params.args?.data;
        // 只在请求范围内、且调用方没有显式指定时补：脚本与测试没有 requestId 上下文。
        if (requestId && data && typeof data === 'object' && !('requestId' in data))
          params.args.data = { ...data, requestId };
      }
      return next(params);
    });
  }

  async onModuleInit() {
    if (process.env.WORKMESH_V1_DATABASE_URL) await this.$connect();
  }

  async onModuleDestroy() {
    if (process.env.WORKMESH_V1_DATABASE_URL) await this.$disconnect();
  }
}
