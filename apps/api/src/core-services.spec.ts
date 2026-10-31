import 'reflect-metadata';
import {
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ProjectMemberRole } from '@prisma/client';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from './auth/auth.guard';
import { AuditInterceptor } from './common/audit.interceptor';
import { AuditService } from './common/audit.service';
import { EncryptionUtil } from './common/encryption.util';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { MetricsInterceptor } from './common/metrics.interceptor';
import { MetricsService } from './common/metrics.service';
import { ResponseInterceptor } from './common/response.interceptor';
import { RedisCacheService } from './cache/redis-cache.service';
import { ProjectAccessService } from './projects/project-access.service';
import { ProjectsService } from './projects/projects.service';

describe('project access and encryption', () => {
  it('enforces project membership and owner permissions', async () => {
    const findMember = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ role: ProjectMemberRole.MEMBER })
      .mockResolvedValueOnce({ role: ProjectMemberRole.OWNER });
    const prisma = {
      projectMember: { findUnique: findMember },
      project: { update: vi.fn().mockResolvedValue({ id: 'p-1' }), delete: vi.fn() },
      user: { findUnique: vi.fn().mockResolvedValue({ organizationId: 'org-1' }) },
    };
    const service = new ProjectsService(prisma as never);
    await expect(service.update('u-1', 'p-1', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.update('u-1', 'p-1', { name: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await service.update('u-1', 'p-1', { name: 'x' });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { name: 'x' },
    });
  });

  it('creates projects for a user workspace and rejects users without one', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'p-1' });
    const user = vi
      .fn()
      .mockResolvedValueOnce({ organizationId: 'org-1' })
      .mockResolvedValueOnce(null);
    const service = new ProjectsService({
      user: { findUnique: user },
      project: { create, findMany: vi.fn() },
    } as never);
    await service.create('u-1', { name: 'Project', key: 'PROJ' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        createdById: 'u-1',
        members: { create: { userId: 'u-1', role: ProjectMemberRole.OWNER } },
      }),
    });
    await expect(service.create('u-1', { name: 'Project', key: 'PROJ' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('round-trips encrypted values and rejects tampering', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const encrypted = EncryptionUtil.encrypt('secret value', key);
    expect(EncryptionUtil.decrypt(encrypted, key)).toBe('secret value');
    const parts = encrypted.split('.');
    parts[2] = Buffer.from('tampered').toString('base64');
    expect(() => EncryptionUtil.decrypt(parts.join('.'), key)).toThrow();
  });

  it('falls back to the factory when Redis is not configured', async () => {
    const previous = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      const cache = new RedisCacheService();
      await cache.onModuleInit();
      await expect(cache.getOrSet('missing-redis', async () => 'value', 60)).resolves.toBe('value');
      await cache.onModuleDestroy();
    } finally {
      if (previous === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previous;
    }
  });

  it('reads and writes configured Redis cache entries', async () => {
    const previous = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:6380';
    try {
      const cache = new RedisCacheService();
      await cache.onModuleInit();
      const key = `reqflow:test:${Date.now()}`;
      let calls = 0;
      await expect(
        cache.getOrSet(
          key,
          async () => {
            calls += 1;
            return { cached: true };
          },
          60,
        ),
      ).resolves.toEqual({ cached: true });
      await expect(
        cache.getOrSet(
          key,
          async () => {
            calls += 1;
            return { cached: false };
          },
          60,
        ),
      ).resolves.toEqual({ cached: true });
      expect(calls).toBe(1);
      await cache.onModuleDestroy();
    } finally {
      if (previous === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previous;
    }
  });

  it('checks project, requirement, and knowledge base access', async () => {
    const member = vi.fn().mockResolvedValue({ role: ProjectMemberRole.MEMBER });
    const access = new ProjectAccessService({
      projectMember: { findUnique: member },
      requirement: { findUnique: vi.fn().mockResolvedValue({ projectId: 'p-1' }) },
      knowledgeBase: { findUnique: vi.fn().mockResolvedValue({ projectId: 'p-1' }) },
    } as never);
    await access.assertMember('u-1', 'p-1');
    await access.assertRequirementMember('u-1', 'r-1');
    await access.assertKnowledgeBaseMember('u-1', 'kb-1');
    expect(member).toHaveBeenCalledTimes(3);
  });

  it('rejects unauthenticated, wrong-type, and inactive tokens', async () => {
    const request = { headers: {} };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as never;
    const unauthorized = new AuthGuard({ verifyAsync: vi.fn() } as never, {} as never, {} as never);
    await expect(unauthorized.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);

    const wrongType = new AuthGuard(
      { verifyAsync: vi.fn().mockResolvedValue({ sub: 'u-1', type: 'refresh' }) } as never,
      { getOrThrow: vi.fn().mockReturnValue('secret') } as never,
      { user: { findUnique: vi.fn() } } as never,
    );
    await expect(
      wrongType.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization: 'Bearer token' } }),
        }),
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const inactive = new AuthGuard(
      { verifyAsync: vi.fn().mockResolvedValue({ sub: 'u-1', type: 'access' }) } as never,
      { getOrThrow: vi.fn().mockReturnValue('secret') } as never,
      { user: { findUnique: vi.fn().mockResolvedValue({ isActive: false }) } } as never,
    );
    await expect(
      inactive.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization: 'Bearer token' } }),
        }),
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches verified active users to requests', async () => {
    const payload = { sub: 'u-1', type: 'access' };
    const request = { headers: { authorization: 'Bearer token' } };
    const guard = new AuthGuard(
      { verifyAsync: vi.fn().mockResolvedValue(payload) } as never,
      { getOrThrow: vi.fn().mockReturnValue('secret') } as never,
      { user: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) } } as never,
    );
    await expect(
      guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never),
    ).resolves.toBe(true);
    expect(request).toHaveProperty('user', payload);
  });

  it('records audit events without breaking requests when storage fails', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const create = vi.fn().mockResolvedValue(undefined);
    const audit = new AuditService({ auditLog: { create } } as never);
    await audit.log({
      actorId: 'u-1',
      action: 'POST',
      target: '/projects',
      metadata: { id: 'p-1' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: 'u-1',
        action: 'POST',
        target: '/projects',
        targetId: undefined,
        metadata: { id: 'p-1' },
      },
    });
    const unavailable = new AuditService({
      auditLog: { create: vi.fn().mockRejectedValue(new Error('offline')) },
    } as never);
    await expect(unavailable.log({ action: 'PATCH', target: '/profile' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('wraps responses and records successful and failed request metrics', async () => {
    const context = {} as never;
    const response = new ResponseInterceptor();
    await expect(
      lastValueFrom(response.intercept(context, { handle: () => of({ id: 'r-1' }) })),
    ).resolves.toEqual({
      data: { id: 'r-1' },
    });

    const metrics = new MetricsService();
    const interceptor = new MetricsInterceptor(metrics);
    await expect(
      lastValueFrom(interceptor.intercept(context, { handle: () => of('ok') })),
    ).resolves.toBe('ok');
    await expect(
      lastValueFrom(
        interceptor.intercept(context, { handle: () => throwError(() => new Error('bad')) }),
      ),
    ).rejects.toThrow('bad');
    expect(metrics.snapshot()).toMatchObject({ requests: 2, failures: 1 });
  });

  it('audits only mutating requests after successful handlers', async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const interceptor = new AuditInterceptor({ log } as never);
    const getContext = {
      switchToHttp: () => ({ getRequest: () => ({ method: 'GET', path: '/projects' }) }),
    } as never;
    await expect(
      lastValueFrom(interceptor.intercept(getContext, { handle: () => of('list') })),
    ).resolves.toBe('list');
    expect(log).not.toHaveBeenCalled();
    const postContext = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', path: '/projects', user: { sub: 'u-1' } }),
      }),
    } as never;
    await lastValueFrom(interceptor.intercept(postContext, { handle: () => of('created') }));
    expect(log).toHaveBeenCalledWith({
      actorId: 'u-1',
      action: 'POST',
      target: '/projects',
    });
  });

  it('formats HTTP exceptions and hides unexpected failures', () => {
    const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const response = { status: vi.fn(), json: vi.fn() };
    response.status.mockReturnValue(response);
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', path: '/private' }),
        getResponse: () => response,
      }),
    } as never;
    const filter = new HttpExceptionFilter();
    filter.catch(new HttpException('not found', 404), host);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenLastCalledWith(
      expect.objectContaining({ statusCode: 404, message: 'not found', path: '/private' }),
    );
    filter.catch(new Error('sensitive detail'), host);
    expect(response.status).toHaveBeenLastCalledWith(500);
    expect(response.json).toHaveBeenLastCalledWith(
      expect.objectContaining({ statusCode: 500, message: 'Internal server error' }),
    );
    expect(logger).toHaveBeenCalledOnce();
    logger.mockRestore();
  });
});
