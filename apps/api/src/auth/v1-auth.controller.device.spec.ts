import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { V1AuthController } from './v1-auth.controller';

function controllerWith(cli: { create: ReturnType<typeof vi.fn> }): V1AuthController {
  return new V1AuthController({} as never, cli as never, {} as never);
}

function requestWith(headers: Record<string, string>, ip = '203.0.113.9'): Request {
  return { ip, headers } as unknown as Request;
}

function responseStub(): Response {
  return { status: vi.fn() } as unknown as Response;
}

describe('V1AuthController CLI device metadata capture', () => {
  it('forwards the three CLI headers and the client ip to the service', async () => {
    const cli = { create: vi.fn(async () => ({ authorizationId: 'authorization-1' })) };
    const controller = controllerWith(cli);

    await controller.createCliAuthorization(
      requestWith({
        'x-workmesh-device': 'build-box',
        'x-workmesh-platform': 'win32 10.0.19045',
        'x-workmesh-client-version': '1.2.3',
      }),
      { clientName: 'workmesh-setup' } as never,
      responseStub(),
    );

    expect(cli.create).toHaveBeenCalledWith({
      clientName: 'workmesh-setup',
      ip: '203.0.113.9',
      deviceName: 'build-box',
      devicePlatform: 'win32 10.0.19045',
      clientVersion: '1.2.3',
    });
  });

  it('omits blank headers and truncates oversize ones so old clients keep the previous payload', async () => {
    const cli = { create: vi.fn(async () => ({ authorizationId: 'authorization-1' })) };
    const controller = controllerWith(cli);

    await controller.createCliAuthorization(
      requestWith({
        'x-workmesh-device': '   ',
        'x-workmesh-client-version': 'v'.repeat(40),
      }),
      { clientName: 'workmesh-setup' } as never,
      responseStub(),
    );

    expect(cli.create).toHaveBeenCalledWith({
      clientName: 'workmesh-setup',
      ip: '203.0.113.9',
      clientVersion: 'v'.repeat(30),
    });
  });
});
