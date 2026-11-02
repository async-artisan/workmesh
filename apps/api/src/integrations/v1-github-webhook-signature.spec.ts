import { describe, expect, it } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import fixture from './fixtures/github-evidence.fixture.json';
import {
  assertGithubWebhookSignature,
  signGithubWebhookBody,
  verifyGithubWebhookSignature,
} from './v1-code-host-adapter';

const SECRET = 'fixture-webhook-secret';
const RAW_BODY = Buffer.from(JSON.stringify(fixture.webhookReviewPayload), 'utf8');

describe('github webhook signature', () => {
  it('accepts a valid X-Hub-Signature-256 digest', () => {
    const signatureHeader = signGithubWebhookBody(RAW_BODY, SECRET);
    expect(signatureHeader).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyGithubWebhookSignature({ secret: SECRET, rawBody: RAW_BODY, signatureHeader })).toBe(true);
  });

  it('rejects missing, malformed, wrong-algorithm and tampered signatures', () => {
    const signatureHeader = signGithubWebhookBody(RAW_BODY, SECRET);
    expect(verifyGithubWebhookSignature({ secret: SECRET, rawBody: RAW_BODY, signatureHeader: undefined })).toBe(false);
    expect(verifyGithubWebhookSignature({ secret: SECRET, rawBody: RAW_BODY, signatureHeader: '' })).toBe(false);
    expect(verifyGithubWebhookSignature({ secret: SECRET, rawBody: RAW_BODY, signatureHeader: 'sha1=deadbeef' })).toBe(false);
    expect(verifyGithubWebhookSignature({ secret: SECRET, rawBody: RAW_BODY, signatureHeader: 'sha256=xyz' })).toBe(false);
    expect(verifyGithubWebhookSignature({ secret: SECRET, rawBody: RAW_BODY, signatureHeader: signatureHeader.slice(0, -2) })).toBe(false);
    const tampered = Buffer.from(`${RAW_BODY.toString('utf8')}tampered`, 'utf8');
    expect(verifyGithubWebhookSignature({ secret: SECRET, rawBody: tampered, signatureHeader })).toBe(false);
    expect(verifyGithubWebhookSignature({ secret: 'other-secret', rawBody: RAW_BODY, signatureHeader })).toBe(false);
  });

  it('throws FORBIDDEN for a rejected signature', () => {
    expect(() =>
      assertGithubWebhookSignature({ secret: SECRET, rawBody: RAW_BODY, signatureHeader: 'sha256=' + '0'.repeat(64) }),
    ).toThrowError(expect.objectContaining({ code: V1_ERROR_CODES.FORBIDDEN, status: 403 }));
    expect(() =>
      assertGithubWebhookSignature({ secret: SECRET, rawBody: RAW_BODY, signatureHeader: undefined }),
    ).toThrowError(WorkmeshError);
  });
});
