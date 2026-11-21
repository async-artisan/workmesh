import {
  parseCiResultReport,
  parseJsonStrict,
  type VerificationCollection,
  type VerificationJobFact,
  type VerificationReportFact,
} from '@workmesh/shared';
import {
  ActionsArchiveError,
  ACTIONS_ARCHIVE_MAX_BYTES,
  readActionsReportArchive,
} from './v1-actions-archive';

export const ACTIONS_API_VERSION = '2026-03-10';
export const ACTIONS_REPORT_ARTIFACT_NAME = 'workmesh-ci-results';
const API = 'https://api.github.com';
const JSON_MAX_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const COLLECTION_TIMEOUT_MS = 60_000;
const JOB_STATUSES = new Set(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending']);
const RUN_STATUSES = new Set([...JOB_STATUSES, 'action_required']);
const CONCLUSIONS = new Set(['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure']);

export class ActionsAdapterError extends Error {
  constructor(readonly reason: string) { super(reason); }
}

export type ActionsCollectInput = {
  owner: string;
  name: string;
  repositoryId: string;
  runId: string;
  attempt: number;
  token: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;
type Run = {
  repositoryId: string; runId: string; attempt: number; headSha: string; event: string;
  status: string; conclusion: string | null; workflowId: string; workflowPath: string;
  createdAt: string; updatedAt: string;
};
type Artifact = {
  id: string; name: string; expired: boolean; size: number; digest: string | null;
  runId: string | null; repositoryId: string | null; headSha: string | null;
};

const object = (value: unknown): value is JsonRecord => !!value && typeof value === 'object' && !Array.isArray(value);
function invalid(reason = 'PROVIDER_PAYLOAD_INVALID'): never { throw new ActionsAdapterError(reason); }
function record(value: unknown): JsonRecord { return object(value) ? value : invalid(); }
function text(value: unknown, max = 1024): string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value) ? value : invalid();
}
function providerId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value)) return value;
  return invalid();
}
function positive(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : invalid();
}
function timestamp(value: unknown): string {
  const result = text(value, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) return invalid();
  return result;
}
function sha(value: unknown): string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : invalid();
}
function conclusion(value: unknown): string | null { return value === null ? null : text(value, 80); }
function issueOf(error: unknown): string {
  return error instanceof ActionsAdapterError || error instanceof ActionsArchiveError ? error.reason : 'PROVIDER_READ_FAILED';
}
function runOf(value: unknown, input: ActionsCollectInput, exact: boolean): Run {
  const run = record(value);
  const normalized = {
    repositoryId: providerId(record(run.repository).id), runId: providerId(run.id),
    attempt: positive(run.run_attempt), headSha: sha(run.head_sha), event: text(run.event, 80),
    status: text(run.status, 80), conclusion: conclusion(run.conclusion),
    workflowId: providerId(run.workflow_id), workflowPath: text(run.path),
    createdAt: timestamp(run.created_at), updatedAt: timestamp(run.updated_at),
  };
  if (normalized.repositoryId !== input.repositoryId || normalized.runId !== input.runId)
    return invalid('RUN_IDENTITY_MISMATCH');
  if (exact && normalized.attempt !== input.attempt) return invalid('ATTEMPT_IDENTITY_MISMATCH');
  return normalized;
}
function artifactOf(value: unknown): Artifact {
  const item = record(value);
  if (typeof item.expired !== 'boolean' || !Number.isSafeInteger(item.size_in_bytes) || (item.size_in_bytes as number) < 0)
    return invalid();
  const run = object(item.workflow_run) ? item.workflow_run : null;
  return {
    id: providerId(item.id), name: text(item.name, 255), expired: item.expired,
    size: item.size_in_bytes as number,
    digest: item.digest === undefined || item.digest === null ? null : text(item.digest, 100),
    runId: run?.id === undefined ? null : providerId(run.id),
    repositoryId: run?.repository_id === undefined ? null : providerId(run.repository_id),
    headSha: run?.head_sha === undefined ? null : sha(run.head_sha),
  };
}
function jobOf(value: unknown, run: Run): VerificationJobFact {
  const job = record(value);
  const result: VerificationJobFact = {
    id: providerId(job.id), runId: providerId(job.run_id), attempt: positive(job.run_attempt),
    name: text(job.name, 255), headSha: sha(job.head_sha), status: text(job.status, 80),
    conclusion: conclusion(job.conclusion),
    startedAt: job.started_at === null ? null : timestamp(job.started_at),
    completedAt: job.completed_at === null ? null : timestamp(job.completed_at),
    steps: [],
  };
  if (result.runId !== run.runId || result.attempt !== run.attempt || result.headSha !== run.headSha)
    return invalid('JOB_ATTEMPT_IDENTITY_MISMATCH');
  if (!Array.isArray(job.steps) || job.steps.length > 500) return invalid('JOB_STEPS_INCOMPLETE');
  const steps = new Set<number>();
  result.steps = job.steps.map((value) => {
    const step = record(value);
    const number = positive(step.number);
    if (steps.has(number)) return invalid('JOB_STEPS_DUPLICATED');
    steps.add(number);
    return { number, name: text(step.name, 255), status: text(step.status, 80), conclusion: conclusion(step.conclusion) };
  });
  return result;
}
function knownOutcome(status: string, value: string | null, statuses: Set<string>): boolean {
  return statuses.has(status) && (value === null || CONCLUSIONS.has(value));
}
function validateInput(input: ActionsCollectInput): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(input.owner) ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(input.name) || ['.', '..'].includes(input.name) ||
    !/^[1-9][0-9]{0,19}$/.test(input.repositoryId) || !/^[1-9][0-9]{0,19}$/.test(input.runId) ||
    !Number.isSafeInteger(input.attempt) || input.attempt < 1 ||
    typeof input.token !== 'string' || !input.token.trim() || /[\r\n]/.test(input.token))
    invalid('COLLECTION_INPUT_INVALID');
}
function downloadUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return invalid('DOWNLOAD_DESTINATION_NOT_ALLOWED'); }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
    !(host === 'results-receiver.actions.githubusercontent.com' ||
      /^[a-z0-9-]+\.blob\.core\.windows\.net$/.test(host)))
    return invalid('DOWNLOAD_DESTINATION_NOT_ALLOWED');
  return url.href;
}

/** Only bounded GETs to GitHub; input tokens never enter returned facts or diagnostics. */
export class GithubActionsAdapter {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxPages: number;
  private readonly maxDownloads: number;

  constructor(options: { fetchImpl?: FetchLike; timeoutMs?: number; maxPages?: number; maxDownloads?: number } = {}) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = Math.min(REQUEST_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? REQUEST_TIMEOUT_MS));
    this.maxPages = Math.min(5, Math.max(1, Math.floor(options.maxPages ?? 5)));
    this.maxDownloads = Math.min(4, Math.max(1, Math.floor(options.maxDownloads ?? 4)));
  }

  async collect(input: ActionsCollectInput): Promise<VerificationCollection> {
    validateInput(input);
    const deadline = Date.now() + COLLECTION_TIMEOUT_MS;
    const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}`;
    const runPath = `${path}/actions/runs/${input.runId}`;
    const attemptPath = `${runPath}/attempts/${input.attempt}`;
    const json = (resource: string) => this.json(resource, input.token, deadline);
    const repository = record((await json(path)).body);
    if (providerId(repository.id) !== input.repositoryId) invalid('REPOSITORY_IDENTITY_MISMATCH');
    const latest = runOf((await json(runPath)).body, input, false);
    if (latest.attempt < input.attempt) invalid('ATTEMPT_NOT_AVAILABLE');
    const first = runOf((await json(attemptPath)).body, input, true);
    if (latest.headSha !== first.headSha || latest.event !== first.event ||
      latest.workflowId !== first.workflowId || latest.workflowPath !== first.workflowPath)
      invalid('RUN_ATTEMPT_METADATA_MISMATCH');
    const issues: string[] = [];
    const jobs: VerificationJobFact[] = [];
    const reports: VerificationReportFact[] = [];
    if (!knownOutcome(first.status, first.conclusion, RUN_STATUSES)) issues.push('RUN_OUTCOME_UNKNOWN');
    const jobPage = await this.pages(`${attemptPath}/jobs`, 'jobs', input.token, deadline);
    issues.push(...jobPage.issues);
    const jobIds = new Set<string>();
    for (const value of jobPage.items) {
      try {
        const job = jobOf(value, first);
        if (jobIds.has(job.id)) invalid('JOBS_DUPLICATED');
        jobIds.add(job.id);
        jobs.push(job);
        if (!knownOutcome(job.status, job.conclusion, JOB_STATUSES) ||
          job.steps.some((step) => !knownOutcome(step.status, step.conclusion, JOB_STATUSES)))
          issues.push('JOB_OUTCOME_UNKNOWN');
      } catch (error) { issues.push(issueOf(error)); }
    }
    if (!jobs.length) issues.push('JOBS_NOT_OBSERVED');
    const artifactPage = await this.pages(`${runPath}/artifacts`, 'artifacts', input.token, deadline, { name: ACTIONS_REPORT_ARTIFACT_NAME });
    issues.push(...artifactPage.issues);
    const artifactIds = new Set<string>();
    let candidates = 0;
    for (const value of artifactPage.items) {
      let artifact: Artifact;
      try { artifact = artifactOf(value); } catch (error) { issues.push(issueOf(error)); continue; }
      if (artifact.name !== ACTIONS_REPORT_ARTIFACT_NAME) continue;
      if (artifactIds.has(artifact.id)) { issues.push('ARTIFACTS_DUPLICATED'); continue; }
      artifactIds.add(artifact.id);
      candidates++;
      if (candidates > this.maxDownloads) { issues.push('REPORT_DOWNLOAD_LIMIT'); break; }
      reports.push(await this.report(artifact, first, path, input, deadline));
    }
    if (!reports.length) issues.push('REPORT_NOT_FOUND');
    if (candidates > 1) issues.push('REPORT_ARTIFACTS_MULTIPLE');
    if (reports.some((report) => !report.report)) issues.push('REPORT_CONTENT_UNAVAILABLE');
    let identityStable = false;
    let latestAttempt = latest.attempt;
    try {
      const second = runOf((await json(attemptPath)).body, input, true);
      const latestAfter = runOf((await json(runPath)).body, input, false);
      latestAttempt = latestAfter.attempt;
      identityStable = JSON.stringify(first) === JSON.stringify(second) &&
        JSON.stringify(latest) === JSON.stringify(latestAfter);
      if (!identityStable) issues.push('RUN_CHANGED_DURING_COLLECTION');
    } catch (error) { issues.push(issueOf(error), 'RUN_IDENTITY_RECHECK_FAILED'); }
    const uniqueIssues = [...new Set(issues)];
    return {
      schemaVersion: '1.0', provider: 'GITHUB_ACTIONS', origin: 'PROVIDER_OBSERVED',
      collectedAt: new Date().toISOString(), repositoryId: first.repositoryId, runId: first.runId,
      attempt: first.attempt, event: first.event, headSha: first.headSha, status: first.status,
      conclusion: first.conclusion, workflowId: first.workflowId, workflowPath: first.workflowPath,
      htmlUrl: `https://github.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/actions/runs/${input.runId}/attempts/${input.attempt}`,
      createdAt: first.createdAt, updatedAt: first.updatedAt, latestAttempt, identityStable,
      completeness: uniqueIssues.length ? 'INCOMPLETE' : 'COMPLETE', jobs, reports, issues: uniqueIssues,
    };
  }

  private async pages(path: string, field: 'jobs' | 'artifacts', token: string, deadline: number,
    query: Record<string, string> = {}): Promise<{ items: unknown[]; issues: string[] }> {
    const items: unknown[] = [];
    let expected: number | undefined;
    for (let page = 1; page <= this.maxPages; page++) {
      const search = new URLSearchParams({ ...query, per_page: '100', page: String(page) });
      try {
        const response = await this.json(`${path}?${search}`, token, deadline);
        const body = record(response.body);
        if (!Number.isSafeInteger(body.total_count) || (body.total_count as number) < 0 ||
          !Array.isArray(body[field]) || body[field].length > 100) invalid('PAGINATION_PAYLOAD_INVALID');
        const count = body.total_count as number;
        if (expected !== undefined && expected !== count) invalid('COLLECTION_CHANGED_DURING_PAGINATION');
        expected = count;
        const entries = body[field] as unknown[];
        items.push(...entries);
        const next = /<([^>]+)>\s*;\s*rel="next"/.exec(response.link ?? '');
        if (next) {
          const target = new URL(next[1]);
          if (target.origin !== API || target.pathname !== path || target.username || target.password ||
            target.hash || target.searchParams.get('page') !== String(page + 1) ||
            target.searchParams.get('per_page') !== '100' ||
            [...target.searchParams.keys()].some((key) => !['page', 'per_page', ...Object.keys(query)].includes(key)) ||
            Object.entries(query).some(([key, value]) => target.searchParams.get(key) !== value))
            invalid('PAGINATION_DESTINATION_NOT_ALLOWED');
        }
        if (items.length > count || (!next && items.length !== count && entries.length < 100))
          invalid('PAGINATION_INCOMPLETE');
        if (items.length === count && !next) return { items, issues: [] };
        if (!entries.length) invalid('PAGINATION_INCOMPLETE');
      } catch (error) { return { items, issues: [issueOf(error)] }; }
    }
    return { items, issues: ['PAGINATION_LIMIT'] };
  }

  private async report(artifact: Artifact, run: Run, path: string, input: ActionsCollectInput,
    deadline: number): Promise<VerificationReportFact> {
    const associated = artifact.runId === run.runId && artifact.repositoryId === run.repositoryId && artifact.headSha === run.headSha;
    const result: VerificationReportFact = {
      artifactId: artifact.id, name: artifact.name, expired: artifact.expired, archiveSha256: null,
      reportSha256: null, reportByteLength: null, association: associated ? 'RUN_ONLY' : 'UNKNOWN',
      report: null, issues: ['ARTIFACT_ATTEMPT_JOB_UNPROVEN'],
    };
    if (!associated) { result.issues.push('ARTIFACT_RUN_IDENTITY_UNPROVEN'); return result; }
    if (artifact.expired) { result.issues.push('ARTIFACT_EXPIRED'); return result; }
    if (artifact.size > ACTIONS_ARCHIVE_MAX_BYTES) { result.issues.push('ARCHIVE_SIZE_LIMIT'); return result; }
    try {
      const detail = artifactOf((await this.json(`${path}/actions/artifacts/${artifact.id}`, input.token, deadline)).body);
      if (JSON.stringify(detail) !== JSON.stringify(artifact)) invalid('ARTIFACT_CHANGED_DURING_COLLECTION');
      const bytes = await this.archive(`${path}/actions/artifacts/${artifact.id}/zip`, input.token, deadline);
      const archive = await readActionsReportArchive(bytes, { timeoutMs: Math.min(5_000, Math.max(1, deadline - Date.now())) });
      result.archiveSha256 = archive.archiveSha256;
      result.reportSha256 = archive.reportSha256;
      result.reportByteLength = archive.bytes.byteLength;
      if (artifact.digest !== null && artifact.digest !== `sha256:${archive.archiveSha256}`)
        invalid('ARTIFACT_DIGEST_MISMATCH');
      const parsed = parseCiResultReport(archive.bytes);
      if (!parsed.ok) { result.issues.push(...parsed.issues.map((issue) => issue.code)); return result; }
      result.report = parsed.report;
      const declared = parsed.report.run;
      if (declared.repositoryId !== run.repositoryId || declared.runId !== run.runId ||
        declared.runAttempt !== run.attempt || declared.headSha !== run.headSha || declared.event !== run.event)
        result.issues.push('REPORT_DECLARATION_MISMATCH');
      // Even perfectly matching report fields do not prove which attempt/job uploaded a run artifact.
    } catch (error) { result.issues.push(issueOf(error)); }
    return result;
  }

  private async archive(path: string, token: string, deadline: number): Promise<Uint8Array> {
    let url = `${API}${path}`;
    for (let hop = 0; hop < 3; hop++) {
      const response = await this.request(url, hop === 0 ? token : null, deadline, ACTIONS_ARCHIVE_MAX_BYTES, true);
      if (response.status === 200) return response.bytes;
      if (![302, 303, 307, 308].includes(response.status) || !response.location)
        invalid(`ARTIFACT_HTTP_${response.status}`);
      url = downloadUrl(response.location);
    }
    return invalid('DOWNLOAD_REDIRECT_LIMIT');
  }

  private async json(path: string, token: string, deadline: number) {
    const response = await this.request(`${API}${path}`, token, deadline, JSON_MAX_BYTES, false);
    if (response.status !== 200) invalid(`API_HTTP_${response.status}`);
    if (!/^application\/(?:[a-z0-9.+-]+\+)?json\b/i.test(response.contentType)) invalid('API_CONTENT_TYPE_INVALID');
    try { return { body: parseJsonStrict(response.bytes), link: response.link }; }
    catch { return invalid('API_JSON_INVALID'); }
  }

  private async request(url: string, token: string | null, deadline: number, maxBytes: number, archive: boolean) {
    if (Date.now() >= deadline) invalid('COLLECTION_TIMEOUT');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, deadline - Date.now()));
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let responseBody: ReadableStream<Uint8Array> | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => {
        void reader?.cancel().catch(() => undefined);
        reject(new ActionsAdapterError('REQUEST_TIMEOUT'));
      }, { once: true });
    });
    try {
      return await Promise.race([(async () => {
        const response = await this.fetchImpl(url, {
          method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: {
            accept: archive ? 'application/octet-stream' : 'application/vnd.github+json',
            'user-agent': 'WorkMesh-Actions-Evidence',
            ...(token ? { authorization: `Bearer ${token}`, 'x-github-api-version': ACTIONS_API_VERSION } : {}),
          },
        });
        responseBody = response.body;
        if (controller.signal.aborted) {
          await response.body?.cancel(); invalid('REQUEST_TIMEOUT');
        }
        // A custom transport must not silently follow redirects or substitute a different resource.
        if (response.redirected || (response.url && response.url !== url)) invalid('TRANSPORT_REDIRECTED');
        const headers = {
          status: response.status, location: response.headers.get('location'),
          link: response.headers.get('link'), contentType: response.headers.get('content-type') ?? '',
        };
        if (response.status !== 200) {
          await response.body?.cancel();
          return { ...headers, bytes: new Uint8Array() };
        }
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
          await response.body?.cancel(); invalid('RESPONSE_SIZE_LIMIT');
        }
        if (!response.body) invalid('RESPONSE_BODY_MISSING');
        reader = response.body.getReader();
        let size = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes) { await reader.cancel(); invalid('RESPONSE_SIZE_LIMIT'); }
          chunks.push(chunk.value);
        }
        return { ...headers, bytes: Buffer.concat(chunks, size) };
      })(), aborted]);
    } catch (error) {
      if (error instanceof ActionsAdapterError) throw error;
      invalid(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'PROVIDER_READ_FAILED');
    } finally {
      clearTimeout(timer);
      if (reader) {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      } else if (responseBody && !responseBody.locked) {
        void responseBody.cancel().catch(() => undefined);
      }
    }
  }
}
