import type { CiResultReportV1 } from './ci-result-report';

/** Provider-observed metadata is separate from assertions inside a downloaded report. */
export type VerificationJobFact = {
  id: string;
  runId: string;
  attempt: number;
  name: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: Array<{ name: string; number: number; status: string; conclusion: string | null }>;
};

export type VerificationReportFact = {
  artifactId: string;
  name: string;
  expired: boolean;
  archiveSha256: string | null;
  reportSha256: string | null;
  reportByteLength: number | null;
  /** A run artifact does not prove which attempt/job uploaded it. */
  association: 'RUN_ONLY' | 'UNKNOWN';
  report: CiResultReportV1 | null;
  issues: string[];
};

export type VerificationCollection = {
  schemaVersion: '1.0';
  provider: 'GITHUB_ACTIONS';
  origin: 'PROVIDER_OBSERVED';
  collectedAt: string;
  repositoryId: string;
  runId: string;
  attempt: number;
  event: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  workflowId: string;
  workflowPath: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  latestAttempt: number;
  identityStable: boolean;
  completeness: 'COMPLETE' | 'INCOMPLETE';
  jobs: VerificationJobFact[];
  reports: VerificationReportFact[];
  issues: string[];
};

export type VerificationDimension = {
  status: 'MATCHED' | 'MISMATCH' | 'UNKNOWN';
  reasons: string[];
};

/** Advisory diagnostics never participate in HUMAN approval or code review gates. */
export type VerificationApplicability = {
  authority: 'ADVISORY';
  origin: VerificationDimension;
  reportAssociation: VerificationDimension;
  currentness: VerificationDimension;
  definitionIndependence: VerificationDimension;
  outcome: 'REPORTED_PASS' | 'FAILED' | 'BLOCKED' | 'NOT_RUN' | 'UNKNOWN';
  reasons: string[];
};

export type VerificationEvidenceView = {
  id: string;
  projectId: string;
  projectRepositoryId: string;
  collectedAt: string;
  collection: VerificationCollection;
  payloadDigest: string;
};

export type VerificationBindingView = {
  id: string;
  evidenceId: string;
  artifactSetId: string;
  createdAt: string;
  diagnostics: VerificationApplicability;
};
