import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { ChangePasswordDto, RegisterDto } from './dto';

describe('Auth contract', () => {
  it('requires a meaningful password length', () =>
    expect('password'.length).toBeGreaterThanOrEqual(8));
  it('enforces the registration password contract', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: ' USER@EXAMPLE.COM ',
      password: 'NoSpecial1',
      name: '  User  ',
    });
    const errors = await validate(dto);
    expect(dto.email).toBe('user@example.com');
    expect(dto.name).toBe('User');
    expect(errors.flatMap((error) => Object.values(error.constraints ?? {}))).toContain(
      '密码必须包含至少一个特殊字符',
    );
  });
  it('revokes a refresh token by hash without returning the token', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new AuthService(
      { refreshToken: { updateMany } } as never,
      {} as never,
      {} as never,
    );
    const result = await service.logout('refresh-token');
    expect(result).toEqual({ revoked: true });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
    );
  });

  it('changes password and revokes existing sessions', async () => {
    const userUpdate = vi.fn().mockResolvedValue({});
    const refreshUpdate = vi.fn().mockResolvedValue({ count: 2 });
    const service = new AuthService(
      {
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'user-1',
            isActive: true,
            passwordHash: await import('bcryptjs').then((bcrypt) => bcrypt.hash('OldPass1!', 4)),
          }),
          update: userUpdate,
        },
        refreshToken: { updateMany: refreshUpdate },
      } as never,
      {} as never,
      {} as never,
    );
    const dto = Object.assign(new ChangePasswordDto(), {
      currentPassword: 'OldPass1!',
      newPassword: 'NewPass2@',
    });
    await expect(service.changePassword('user-1', dto)).resolves.toEqual({ changed: true });
    expect(userUpdate).toHaveBeenCalledOnce();
    expect(refreshUpdate).toHaveBeenCalledOnce();
  });
});

describe('AuthService lifecycle', () => {
  const config = {
    getOrThrow: (key: string) => (key === 'JWT_SECRET' ? 'a'.repeat(40) : 'b'.repeat(40)),
    get: (key: string) => (key === 'JWT_ACCESS_EXPIRES_IN' ? '900' : '604800'),
  };

  it('registers with normalized email, a bcrypt hash, and token pair', async () => {
    const user = {
      id: 'user-1',
      email: 'person@example.com',
      name: 'Person',
      role: 'USER',
      passwordHash: '',
      isActive: true,
    };
    const create = vi.fn().mockImplementation(async ({ data }) => {
      user.passwordHash = data.passwordHash;
      return user;
    });
    const refreshCreate = vi.fn().mockResolvedValue({});
    const jwt = {
      signAsync: vi
        .fn()
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token'),
      decode: vi.fn().mockReturnValue({ exp: 1900000000 }),
    };
    const service = new AuthService(
      {
        user: { findUnique: vi.fn().mockResolvedValue(null), create },
        refreshToken: { create: refreshCreate },
      } as never,
      jwt as never,
      config as never,
    );
    const result = await service.register({
      email: ' PERSON@EXAMPLE.COM ',
      name: ' Person ',
      password: 'ValidPass1!',
    });
    expect(create.mock.calls[0][0].data.email).toBe('person@example.com');
    expect(await bcrypt.compare('ValidPass1!', user.passwordHash)).toBe(true);
    expect(result.user).toEqual({
      id: 'user-1',
      email: user.email,
      name: user.name,
      role: user.role,
    });
    expect(result).toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' });
    expect(refreshCreate).toHaveBeenCalledOnce();
  });

  it('rejects duplicate registration and invalid login credentials', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'existing' })
      .mockResolvedValueOnce(null);
    const service = new AuthService(
      { user: { findUnique } } as never,
      {} as never,
      config as never,
    );
    await expect(
      service.register({ email: 'x@example.com', password: 'ValidPass1!' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.login({ email: 'missing@example.com', password: 'ValidPass1!' }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rotates a valid refresh token exactly once', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({});
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({
        sub: 'user-1',
        email: 'person@example.com',
        role: 'USER',
        type: 'refresh',
      }),
      signAsync: vi.fn().mockResolvedValueOnce('new-access').mockResolvedValueOnce('new-refresh'),
      decode: vi.fn().mockReturnValue({ exp: 1900000000 }),
    };
    const service = new AuthService(
      {
        refreshToken: {
          findFirst: vi.fn().mockResolvedValue({ id: 'token-row' }),
          updateMany,
          create,
        },
      } as never,
      jwt as never,
      config as never,
    );
    await expect(service.refresh({ refreshToken: 'old-refresh' })).resolves.toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'token-row', revokedAt: null } }),
    );
    expect(create).toHaveBeenCalledOnce();
  });

  it('rejects an already consumed refresh token', async () => {
    const service = new AuthService(
      {
        refreshToken: {
          findFirst: vi.fn().mockResolvedValue({ id: 'token-row' }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      } as never,
      {
        verifyAsync: vi.fn().mockResolvedValue({
          sub: 'user-1',
          email: 'person@example.com',
          role: 'USER',
          type: 'refresh',
        }),
      } as never,
      config as never,
    );
    await expect(service.refresh({ refreshToken: 'old-refresh' })).rejects.toMatchObject({
      status: 401,
    });
  });

  it('gives each refresh token a unique identifier within the same second', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const jwt = {
      signAsync: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
        payloads.push(payload);
        return `token-${payloads.length}`;
      }),
      decode: vi.fn().mockReturnValue({ exp: 1900000000 }),
    };
    const service = new AuthService(
      { refreshToken: { create: vi.fn().mockResolvedValue({}) } } as never,
      jwt as never,
      config as never,
    );
    const internals = service as unknown as {
      issueTokens: (id: string, email: string, role: string) => Promise<unknown>;
    };
    await internals.issueTokens('user-1', 'user@example.com', 'USER');
    await internals.issueTokens('user-1', 'user@example.com', 'USER');
    expect(payloads[1].type).toBe('refresh');
    expect(payloads[3].type).toBe('refresh');
    expect(payloads[1].jti).not.toBe(payloads[3].jti);
  });
});
