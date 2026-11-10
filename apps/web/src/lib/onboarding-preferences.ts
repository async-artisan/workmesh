import { validateOnboardingParameters } from './onboarding-command';

const STORAGE_KEY = 'workmesh.onboarding.preferences.v1';
export type OnboardingPreferences = { shell: string; host: string };

/** Only terminal/client preferences persist. Codes, roles, API URLs and local paths never do. */
export function readOnboardingPreferences(): OnboardingPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return {
      shell: value.shell === 'git-bash' || value.shell === 'powershell' ? value.shell : '',
      host: value.host === 'codex' || value.host === 'claude-code' ? value.host : '',
    };
  } catch {
    return { shell: '', host: '' };
  }
}

export function saveOnboardingPreferences(value: OnboardingPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ shell: value.shell, host: value.host }));
  } catch {
    /* Browser storage is optional; onboarding must remain usable. */
  }
}

export function configuredPublicApi(): { value: string; error: string | null } {
  const configured: unknown = import.meta.env.VITE_WORKMESH_PUBLIC_API_URL;
  if (typeof configured !== 'string' || !configured.trim()) return { value: '', error: null };
  const value = configured.trim();
  const error = validateOnboardingParameters({
    shell: 'powershell',
    host: 'codex',
    role: 'backend',
    root: 'C:\\workspace',
    api: value,
  });
  return error
    ? {
        value: '',
        error: `部署提供的公共 API 地址无效：${error} 请联系部署管理员修正，或填写管理员确认的地址。`,
      }
    : { value, error: null };
}
