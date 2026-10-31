import { loadConfig, saveConfig, type ReqFlowConfig } from './config';

export class ReqFlowClient {
  constructor(private readonly config: ReqFlowConfig) {}

  private url(path: string) {
    return new URL(path.replace(/^\//, ''), `${this.config.apiUrl.replace(/\/$/, '')}/`).toString();
  }

  async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (this.config.accessToken) headers.set('authorization', `Bearer ${this.config.accessToken}`);
    const response = await fetch(this.url(path), {
      ...init,
      headers,
    });
    if (response.status === 401 && retry && this.config.refreshToken) {
      const refreshed = await this.refresh();
      if (refreshed) return this.request(path, init, false);
    }
    const payload = (await response.json().catch(() => undefined)) as {
      data?: T;
      message?: unknown;
    };
    if (!response.ok)
      throw new Error(
        typeof payload?.message === 'string'
          ? payload.message
          : `API request failed: ${response.status}`,
      );
    return (payload && 'data' in payload ? payload.data : payload) as T;
  }

  private async refresh() {
    const response = await fetch(this.url('/auth/refresh'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.config.refreshToken }),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as {
      data?: { accessToken: string; refreshToken: string };
    };
    const tokens = payload.data;
    if (!tokens?.accessToken || !tokens.refreshToken) return false;
    Object.assign(this.config, tokens);
    await saveConfig(tokens);
    return true;
  }
}

export async function configuredClient(api?: string) {
  const config = await loadConfig();
  if (api) config.apiUrl = api;
  return { config, client: new ReqFlowClient(config) };
}
