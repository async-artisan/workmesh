# 代码托管适配器接口

> 源码位置：`apps/api/src/integrations/v1-code-host-adapter.ts`
> 当前实现：GitHub（`GithubCodeHostAdapter`）

WorkMesh 通过 `CodeHostAdapter` 接口与代码托管平台交互。领域层只消费归一化结果，不接触 GitHub 专用字段，因此新适配器只需实现这个接口即可支持 GitLab、Gitee、Bitbucket 等其他托管平台。

## 核心接口

```typescript
export interface CodeHostAdapter {
  readonly provider: CodeHostProvider; // 'GITHUB' | 'GITLAB' 等
  capabilities(): CodeHostCapabilities;
  verifyWebhook(input: GithubWebhookSignatureInput): boolean;
  getRepository(locator: RepositoryLocator): Promise<RepositoryIdentity>;
  listChangeRequests(
    repositories: RepositoryLocator[],
    input?: ListChangeRequestsInput,
  ): Promise<PageResult<NormalizedPullRequest>>;
  getChangeRequest(locator: ChangeRequestLocator): Promise<NormalizedChangeRequest>;
  listReviews(locator: ChangeRequestLocator): Promise<NormalizedReview[]>;
  loadCodeEvidence(
    locator: ChangeRequestLocator,
    options?: LoadCodeEvidenceOptions,
  ): Promise<LoadedCodeEvidence>;
}
```

## 类型定义

### 能力声明

```typescript
export type CodeHostCapabilities = {
  webhook: boolean; // 是否支持 webhook 签名验证
  fetchChangeRequest: boolean; // 是否支持按编号拉取 PR/MR
  commitBoundReviews: boolean; // 评审是否绑定到 commit（false 时代码证据有限制）
  immutableBlob: boolean; // commit SHA 是否不可变（GitHub: true）
};
```

### 仓库定位

```typescript
export type RepositoryLocator = {
  provider: CodeHostProvider; // 托管平台标识
  owner: string; // 组织或用户名
  name: string; // 仓库名
};

export type RepositoryIdentity = {
  provider: CodeHostProvider;
  externalRepositoryId: string; // 平台数值 ID（稳定，改名后不变）
  stableKey: string; // 供内部映射用的稳定键
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
};
```

### 变更请求（PR/MR）

`NormalizedPullRequest`（来自 `v1-github-payload.ts`）包含的字段是平台无关的：

| 字段                | 说明                             |
| ------------------- | -------------------------------- |
| `externalId`        | 平台内唯一 ID（字符串化）        |
| `numberLabel`       | 展示用编号（如 `#123`）          |
| `title`             | PR/MR 标题                       |
| `state`             | `OPEN` / `CLOSED` / `MERGED`     |
| `headSha`           | 提交 SHA（代码证据绑定点）       |
| `merged`            | 是否已合并                       |
| `author`            | 提交者信息                       |
| `repository`        | 所属仓库的 `RepositoryIdentity`  |
| `providerUpdatedAt` | 平台最后更新时间（用于并发检测） |

### 代码证据结果

```typescript
export type LoadedCodeEvidence = {
  repository: RepositoryIdentity;
  changeRequest: NormalizedChangeRequest; // PR + 完整 reviews
  evidence: RepositoryEvidenceInput; // 供领域层记录的归一化证据
  decision: 'PASS' | 'FAIL' | 'UNKNOWN'; // 代码证据评定
  reasons: string[];
};
```

`decision: 'UNKNOWN'` 表示在拉取过程中检测到 PR 状态变化（`UPSTREAM_CHANGED`），需要重新评估。

## 实现一个新适配器

### 1. 添加 provider 类型

在 `v1-code-host-adapter.ts` 中扩展 `CodeHostProvider`：

```typescript
export type CodeHostProvider = 'GITHUB' | 'GITLAB'; // 新增 'GITLAB'
```

**注意**：`CodeHostProvider` 是存储在数据库中的字符串。已存入的值不可改变，API 侧在写入前通过枚举校验。

### 2. 实现 `CodeHostAdapter` 接口

创建 `apps/api/src/integrations/v1-gitlab-code-host-adapter.ts`：

```typescript
export class GitlabCodeHostAdapter implements CodeHostAdapter {
  readonly provider: CodeHostProvider = 'GITLAB';

  capabilities(): CodeHostCapabilities {
    return {
      webhook: true,
      fetchChangeRequest: true,
      commitBoundReviews: true, // GitLab MR reviews 绑定 head commit
      immutableBlob: true,
    };
  }

  verifyWebhook(input: GithubWebhookSignatureInput): boolean {
    // GitLab 使用 X-Gitlab-Token header（固定 secret 比较）
    // 注意：input 类型名沿用 Github 前缀，但内容可重用
    return timingSafeEqual(Buffer.from(input.signatureHeader ?? ''), Buffer.from(input.secret));
  }

  async getRepository(locator: RepositoryLocator): Promise<RepositoryIdentity> {
    // 调用 GitLab API: GET /projects/:id
    // 返回 RepositoryIdentity，externalRepositoryId 用数值项目 ID
  }

  // ... 实现其余方法
}
```

### 3. 注册到注入工厂

在 `apps/api/src/integrations/integrations.module.ts` 中，代码托管适配器通过工厂函数选择。按平台标识映射到对应实现即可。

### 4. 必须实现的归一化契约

| 要求                        | 说明                                                      |
| --------------------------- | --------------------------------------------------------- |
| `externalRepositoryId` 稳定 | 必须使用平台的数值 ID，改名/转移后不变                    |
| `headSha` 完整              | 完整 40 位 hex SHA，不能用短格式                          |
| `providerUpdatedAt` 时间戳  | ISO 8601，用于并发检测（`loadCodeEvidence` 两次读取比对） |
| `reviews` 完整分页          | 必须拉取所有 review 页，截断会导致代码证据不完整          |
| 错误映射到 `WorkmeshError`  | 使用 `V1_ERROR_CODES` 中的标准码，不抛平台专有异常        |

### 5. 单元测试要求

参考 `apps/api/src/integrations/v1-code-host-adapter.spec.ts`：

- 注入 `fetchImpl` mock（`GithubFetch` 类型），不访问真实网络
- 覆盖：分页截断（`PAGINATION_LIMIT_EXCEEDED`）、身份验证失败（403）、重试逻辑（502/503）
- `loadCodeEvidence` 必须有「两次读取结果不一致」触发 `UPSTREAM_CHANGED` 的测试用例
- Webhook 验证：有签名、无签名、签名格式错误各一个用例

## 注意事项

- 所有 HTTP 调用走注入的 `fetchImpl`，不直接使用全局 `fetch`
- 凭据（token）不写入错误、日志或 `details`（领域层日志会透传 `WorkmeshError.details`）
- 白名单主机（`GITHUB_ALLOWED_HOSTS`）对应的设计：每个适配器实现自己的主机白名单，防止 SSRF
- `loadCodeEvidence` 的两次读取中间不能缓存：目的是检测 CI 在评审进行中的并发修改

## 当前限制（已知）

- `CodeHostProvider` 是数据库枚举，新增值需要数据库迁移（新增 `CHECK` 约束或移除枚举约束）
- Webhook 路由只在单个端点（`/github/webhooks`）注册，增加新平台需要对应路由或通用路由
- `verifyWebhook` 的 `input` 类型名沿用了 `GithubWebhookSignatureInput`（命名未抽象化），新适配器实现时转换即可，不影响接口语义
