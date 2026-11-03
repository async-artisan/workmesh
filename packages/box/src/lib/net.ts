import { connect } from 'node:net';

export async function isPortOpen(
  port: number,
  host = '127.0.0.1',
  timeoutMs = 500,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export async function waitForPort(
  port: number,
  options: { host?: string; timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (await isPortOpen(port, options.host ?? '127.0.0.1', 800)) return true;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 500));
  }
  return isPortOpen(port, options.host ?? '127.0.0.1', 800);
}

export async function waitForHttp(
  url: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return true;
    } catch {
      // 连接被拒或尚未就绪，继续等。
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 700));
  }
  return false;
}
