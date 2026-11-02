import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { V1AuthService } from './auth/v1-auth.service';
import { V1AuthorizationService } from './auth/v1-authorization';
import { V1BoardService } from './tasks/v1-board.service';
import { V1ChangeService } from './tasks/v1-change.service';
import { V1GithubEvidenceService } from './integrations/v1-github-evidence.service';

/**
 * 完整 AppModule 装配 smoke：只做 DI 编译，不 initialize、不连数据库。
 * 覆盖历史上曾失败的 controller 构造注入、repository token 误用与集成模块缺 provider。
 */
describe('AppModule DI smoke', () => {
  const originalDatabaseUrl = process.env.WORKMESH_V1_DATABASE_URL;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    // 显式清空连接串，确保 compile 阶段即使触发 onModuleInit 也不会连接数据库。
    delete process.env.WORKMESH_V1_DATABASE_URL;
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
    if (originalDatabaseUrl === undefined) delete process.env.WORKMESH_V1_DATABASE_URL;
    else process.env.WORKMESH_V1_DATABASE_URL = originalDatabaseUrl;
  });

  it('核心服务全部可解析', () => {
    expect(moduleRef.get(V1AuthService)).toBeInstanceOf(V1AuthService);
    expect(moduleRef.get(V1AuthorizationService)).toBeInstanceOf(V1AuthorizationService);
    expect(moduleRef.get(V1BoardService)).toBeInstanceOf(V1BoardService);
    expect(moduleRef.get(V1ChangeService)).toBeInstanceOf(V1ChangeService);
    expect(moduleRef.get(V1GithubEvidenceService)).toBeInstanceOf(V1GithubEvidenceService);
  });
});
