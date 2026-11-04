import { describe, expect, it } from 'vitest';
import { currentRequestId, runWithRequestId } from './request-context.middleware';

describe('request context', () => {
  it('exposes the requestId only inside its scope', () => {
    expect(currentRequestId()).toBeNull();
    runWithRequestId('11111111-1111-4111-8111-111111111111', () => {
      expect(currentRequestId()).toBe('11111111-1111-4111-8111-111111111111');
    });
    expect(currentRequestId()).toBeNull();
  });

  it('keeps the requestId across awaits so async repository code sees it', async () => {
    const seen = await runWithRequestId('22222222-2222-4222-8222-222222222222', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentRequestId();
    });
    expect(seen).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('restores the outer scope after a nested scope exits', () => {
    runWithRequestId('outer', () => {
      runWithRequestId('inner', () => {
        expect(currentRequestId()).toBe('inner');
      });
      expect(currentRequestId()).toBe('outer');
    });
  });
});
