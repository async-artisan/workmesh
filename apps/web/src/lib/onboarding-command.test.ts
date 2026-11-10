import { describe, expect, it } from 'vitest';
import {
  buildOnboardingCommand,
  validateOnboardingParameters,
  type OnboardingCommandInput,
} from './onboarding-command';

const input: OnboardingCommandInput = {
  shell: 'git-bash',
  host: 'codex',
  code: 'wm-join-once',
  role: 'frontend',
  root: 'G:\\Business Projects\\app',
  api: 'https://workmesh.example.com/api/v1',
};

describe('buildOnboardingCommand', () => {
  it('可在签发接入码之前校验参数，不要求接入码或发起网络请求', () => {
    const { code: _code, ...parameters } = input;
    expect(validateOnboardingParameters(parameters)).toBeNull();
    expect(validateOnboardingParameters({ ...parameters, api: '' })).toMatch(/API/);
    expect(buildOnboardingCommand({ ...input, code: '' }).command).toBeNull();
  });
  it('生成独立于 cwd 的 Git Bash 单行预览，支持空格和 Windows 目录', () => {
    const result = buildOnboardingCommand(input);
    expect(result.error).toBeNull();
    expect(result.command).toBe(
      "workmesh workspace init --join 'wm-join-once' --root '/g/Business Projects/app' --api 'https://workmesh.example.com/api/v1' --role 'frontend' --host 'codex'",
    );
    expect(result.command).not.toContain('--apply');
    expect(result.command).not.toContain('--yes');
    expect(result.command).not.toMatch(/[\r\n]/);
  });

  it('切换到 PowerShell 时转换 Git Bash 的盘符目录，并引用所有参数', () => {
    const result = buildOnboardingCommand({
      ...input,
      shell: 'powershell',
      root: '/g/Business Projects/app',
      host: 'claude-code',
    });
    expect(result.command).toContain("--root 'G:\\Business Projects/app'");
    expect(result.command).toContain("--host 'claude-code'");
  });

  it('Git Bash 参数中的单引号、美元符、反引号和分号都保持字面量', () => {
    const result = buildOnboardingCommand({
      ...input,
      root: "/g/it's $(touch injected); `echo bad`",
      code: "join'; echo injected; '",
    });
    expect(result.command).toContain("--root '/g/it'\"'\"'s $(touch injected); `echo bad`'");
    expect(result.command).toContain("--join 'join'\"'\"'; echo injected; '\"'\"''");
  });

  it('PowerShell 使用字面量引号，转义 ASCII 和弯引号，禁止插值', () => {
    const result = buildOnboardingCommand({
      ...input,
      shell: 'powershell',
      root: "G:\\it's $($env:USERNAME); `echo bad`\\‘app’",
    });
    expect(result.command).toContain("--root 'G:\\it''s $($env:USERNAME); `echo bad`\\‘‘app’’'");
  });

  it.each(['shell', 'host', 'role', 'root', 'api', 'code'] as const)(
    '缺少 %s 时不生成可复制命令',
    (field) => {
      expect(buildOnboardingCommand({ ...input, [field]: '' }).command).toBeNull();
    },
  );

  it.each([
    { root: 'relative/project' },
    { root: '/g/app\nworkmesh delete' },
    { code: 'join\r\nmalicious' },
    { host: 'codex; echo bad' },
    { role: 'frontend; echo bad' },
    { api: '/api/v1' },
    { api: 'https://workmesh.example.com' },
    { api: 'https://user:password@workmesh.example.com/api/v1' },
    { api: 'https://workmesh.example.com/api/v1?token=secret' },
    { api: 'http://workmesh.example.com/api/v1' },
    { api: 'https://workmesh.example.com/team//api/v1' },
    { api: 'https://workmesh.example.com/team../api/v1' },
    { api: 'https://workmesh.example.com/team/../api/v1' },
    { api: 'https://workmesh.example.com/team/%2e%2e/api/v1' },
    { api: 'https://workmesh.example.com/team\\api/v1' },
    { api: 'https://workmesh.example.com/team/%61/api/v1' },
    { api: 'https://workmesh.example.com/team name/api/v1' },
    { api: 'https://workmesh.example.com/api/v1//' },
  ])('拒绝无效或跨行输入 %o', (override) => {
    expect(buildOnboardingCommand({ ...input, ...override }).command).toBeNull();
  });

  it('允许管理员明确填写本机 API 和带反向代理前缀的 HTTPS API', () => {
    expect(
      buildOnboardingCommand({ ...input, api: 'http://127.0.0.1:3000/api/v1/' }).command,
    ).toContain("--api 'http://127.0.0.1:3000/api/v1'");
    expect(
      buildOnboardingCommand({ ...input, api: 'https://workmesh.example.com/platform/api/v1' })
        .error,
    ).toBeNull();
  });
});
