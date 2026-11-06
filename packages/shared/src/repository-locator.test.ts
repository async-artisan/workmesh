import { describe, expect, it } from 'vitest';
import {
  RepositoryLocatorError,
  canonicalizeRepositoryLocator,
  tryCanonicalizeRepositoryLocator,
} from './repository-locator';

describe('canonicalizeRepositoryLocator', () => {
  it('规范化 HTTPS：host 小写、去凭据与默认端口，保留路径大小写和 .git 后缀', () => {
    expect(canonicalizeRepositoryLocator('https://GitHub.COM:443/Acme/WorkMesh.git')).toEqual({
      canonicalLocator: 'https://github.com/Acme/WorkMesh.git',
      source: 'HTTPS',
      host: 'github.com',
      path: '/Acme/WorkMesh.git',
      owner: 'Acme',
      name: 'WorkMesh',
    });
    expect(
      canonicalizeRepositoryLocator('https://user:secret@GitHub.com/Acme/WorkMesh.git')
        .canonicalLocator,
    ).toBe('https://github.com/Acme/WorkMesh.git');
  });

  it('规范化 SSH 与 scp 形式，保留用户名、host alias、非默认端口和路径大小写', () => {
    expect(canonicalizeRepositoryLocator('ssh://Git@GitHub.COM:22/Acme/Repo.git')).toEqual({
      canonicalLocator: 'ssh://Git@github.com/Acme/Repo.git',
      source: 'SSH',
      host: 'github.com',
      path: '/Acme/Repo.git',
      owner: 'Acme',
      name: 'Repo',
    });
    expect(canonicalizeRepositoryLocator('git@git.example.com:team/Repo.git')).toMatchObject({
      canonicalLocator: 'ssh://git@git.example.com/team/Repo.git',
      source: 'SSH',
      host: 'git.example.com',
      path: '/team/Repo.git',
    });
    expect(canonicalizeRepositoryLocator('ssh://git@git.example.com:2222/team/repo')).toMatchObject(
      {
        canonicalLocator: 'ssh://git@git.example.com:2222/team/repo',
      },
    );
    expect(
      canonicalizeRepositoryLocator('ssh://git:secret@host.example/team/repo').canonicalLocator,
    ).toBe('ssh://git@host.example/team/repo');
  });

  it('HTTPS 与 SSH 形式不互相等价', () => {
    const https = canonicalizeRepositoryLocator('https://github.com/acme/repo.git');
    const ssh = canonicalizeRepositoryLocator('ssh://git@github.com/acme/repo.git');
    expect(https.canonicalLocator).not.toBe(ssh.canonicalLocator);
  });

  it('相同输入的重复规范化结果稳定', () => {
    const once = canonicalizeRepositoryLocator('https://GitHub.com/acme/repo');
    const twice = canonicalizeRepositoryLocator(once.canonicalLocator);
    expect(twice).toEqual(once);
  });

  it('拒绝不受支持/不安全的 locator', () => {
    for (const input of [
      '',
      '   ',
      'github.com/acme/repo',
      'http://github.com/acme/repo',
      'ftp://github.com/acme/repo',
      'file:///tmp/repo',
      'https://github.com',
      'https://github.com/',
      'https://github.com/acme/repo?ref=main',
      'https://github.com/acme/repo#readme',
      'https://github.com/acme/../secrets',
      'https://github.com/acme/rep o',
      'git@github.com:',
      'ssh://git@github.com:99999/acme/repo',
    ])
      expect(() => canonicalizeRepositoryLocator(input), input).toThrow(RepositoryLocatorError);
    expect(tryCanonicalizeRepositoryLocator(42)).toBeNull();
    expect(tryCanonicalizeRepositoryLocator('https://github.com/acme/repo')).not.toBeNull();
  });

  it('展示字段只做推导，路径首段作为 owner 兜底为 host', () => {
    expect(canonicalizeRepositoryLocator('https://git.example.com/single.git')).toMatchObject({
      owner: 'git.example.com',
      name: 'single',
    });
  });
});
