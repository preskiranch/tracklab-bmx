import { describe, expect, it, vi } from 'vitest';
import {
  appleBillingServerIsReady,
  reconcileAppleBillingStatus,
} from '../../src/lib/appleBilling';

describe('Apple billing server readiness', () => {
  it('requires the server to explicitly enable and configure the Apple provider', async () => {
    const readyFetch = vi.fn(async () => new Response(JSON.stringify({
      provider: 'apple-app-store',
      enabled: true,
      configured: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof globalThis.fetch;
    const disabledFetch = vi.fn(async () => new Response(JSON.stringify({
      provider: 'apple-app-store',
      enabled: true,
      configured: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof globalThis.fetch;

    await expect(appleBillingServerIsReady(readyFetch)).resolves.toBe(true);
    await expect(appleBillingServerIsReady(disabledFetch)).resolves.toBe(false);
    expect(readyFetch).toHaveBeenCalledWith('/api/billing/config', expect.objectContaining({
      credentials: 'same-origin',
    }));
  });

  it('fails closed for network and malformed configuration responses', async () => {
    const networkFailure = vi.fn(async () => {
      throw new Error('offline');
    }) as typeof globalThis.fetch;
    const malformed = vi.fn(async () => new Response('{}', { status: 200 })) as typeof globalThis.fetch;

    await expect(appleBillingServerIsReady(networkFailure)).resolves.toBe(false);
    await expect(appleBillingServerIsReady(malformed)).resolves.toBe(false);
  });

  it('reconciles lifecycle status through the authenticated endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 })) as typeof globalThis.fetch;

    await reconcileAppleBillingStatus(fetchMock);

    expect(fetchMock).toHaveBeenCalledWith('/api/billing/apple/status', expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
    }));
  });
});
