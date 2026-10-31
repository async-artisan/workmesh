import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ReqFlowConfig {
  apiUrl: string;
  accessToken?: string;
  refreshToken?: string;
  projectId?: string;
}

export function configPath() {
  return process.env.REQFLOW_CONFIG_PATH ?? join(homedir(), '.reqflow', 'config.json');
}

export async function loadConfig(): Promise<ReqFlowConfig> {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8')) as ReqFlowConfig;
  } catch {
    return { apiUrl: 'http://127.0.0.1:3000/api' };
  }
}

export async function saveConfig(patch: Partial<ReqFlowConfig>) {
  const current = await loadConfig();
  const next = { ...current, ...patch };
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await chmod(configPath(), 0o600);
  return next;
}

export async function clearConfig() {
  await rm(configPath(), { force: true });
}
