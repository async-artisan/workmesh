import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateCliAuthorizationDto } from './v1-auth.dto';
import { V1AuthController } from './v1-auth.controller';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('V1AuthController device verification link', () => {
  it('uses the configured public Web origin instead of the API origin', async () => {
    vi.stubEnv('WORKMESH_PUBLIC_ORIGIN', 'http://127.0.0.1:5173');
    const cli = {
      create: vi.fn(async () => ({
        authorizationId: 'authorization-1',
        verificationUri: '/cli/authorize',
      })),
    };
    const controller = new V1AuthController({} as never, cli as never, {} as never);
    const response = { status: vi.fn() } as unknown as Response;

    const result = await controller.createCliAuthorization(
      { ip: '127.0.0.1' } as Request,
      {} as CreateCliAuthorizationDto,
      response,
    );

    expect(response.status).toHaveBeenCalledWith(201);
    expect(cli.create).toHaveBeenCalledWith({ ip: '127.0.0.1' });
    expect(result).toMatchObject({
      authorizationId: 'authorization-1',
      verificationUri: 'http://127.0.0.1:5173/cli/authorize',
    });
  });
});
