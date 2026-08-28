import { describe, expect, it, vi } from 'vitest';
import { claimAppleTransaction } from '../../src/lib/appleBilling';
import type { NativeStoreKitTransaction } from '../../src/lib/nativeInAppPurchases';

function transaction(overrides: Partial<NativeStoreKitTransaction> = {}): NativeStoreKitTransaction {
  return {
    transactionId: '1000000000000001',
    originalTransactionId: '1000000000000000',
    productId: 'com.preskilranch.tracklabbmx.wattbike.2.monthly',
    bikeSeats: 2,
    signedTransaction: 'header.payload.signature',
    appAccountToken: '00000000-0000-4000-8000-000000000001',
    purchaseDate: 1_788_000_000_000,
    expirationDate: 1_790_678_400_000,
    revocationDate: null,
    needsFinish: true,
    ...overrides,
  };
}

describe('Apple transaction claim coordinator', () => {
  it('durably acknowledges the signed transaction before finishing it in StoreKit', async () => {
    const order: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      order.push('server');
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        signedTransaction: 'header.payload.signature',
      });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const finish = vi.fn(async () => {
      order.push('storekit');
    });

    await claimAppleTransaction(transaction(), { fetch: fetchMock, finish });

    expect(fetchMock).toHaveBeenCalledWith('/api/billing/apple/transactions', expect.any(Object));
    expect(finish).toHaveBeenCalledWith('1000000000000001');
    expect(order).toEqual(['server', 'storekit']);
  });

  it('leaves the StoreKit transaction unfinished when server verification fails', async () => {
    const finish = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: 'This transaction does not belong to the signed-in account.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )) as typeof globalThis.fetch;

    await expect(claimAppleTransaction(transaction(), { fetch: fetchMock, finish }))
      .rejects.toThrow('does not belong');
    expect(finish).not.toHaveBeenCalled();
  });

  it('does not finish an entitlement StoreKit already reports as finished', async () => {
    const finish = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 })) as typeof globalThis.fetch;

    await claimAppleTransaction(transaction({ needsFinish: false }), { fetch: fetchMock, finish });

    expect(finish).not.toHaveBeenCalled();
  });

  it('marks only an explicit Restore Purchases claim as eligible for deleted-lineage recovery', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof globalThis.fetch;

    await claimAppleTransaction(
      transaction({ needsFinish: false }),
      { fetch: fetchMock, finish: vi.fn(async () => undefined) },
      { restore: true },
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      signedTransaction: 'header.payload.signature',
      restore: true,
    });
  });
});
