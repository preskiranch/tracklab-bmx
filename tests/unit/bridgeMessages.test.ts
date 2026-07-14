import { describe, expect, it } from 'vitest';
import { parseBridgeMessage } from '../../src/lib/bridgeMessages';

describe('bridge message parsing', () => {
  it('accepts validated connector status and binary sample messages', () => {
    expect(parseBridgeMessage(JSON.stringify({
      type: 'bridge-status',
      mode: 'bluetooth',
      sourceState: 'running',
      message: 'Two bikes connected.',
    }))).toMatchObject({ type: 'bridge-status', mode: 'bluetooth' });

    const binaryPayload = new TextEncoder().encode(JSON.stringify({
      type: 'bike-sample',
      at: 100,
      deviceId: 58701,
    }));
    expect(parseBridgeMessage(binaryPayload)).toMatchObject({
      type: 'bike-sample',
      deviceId: 58701,
    });
  });

  it('ignores malformed, unknown, and invalid connector messages', () => {
    expect(parseBridgeMessage('{not-json')).toBeNull();
    expect(parseBridgeMessage('[]')).toBeNull();
    expect(parseBridgeMessage(JSON.stringify({ type: 'unknown' }))).toBeNull();
    expect(parseBridgeMessage(JSON.stringify({
      type: 'bridge-status',
      mode: 'malicious-mode',
      message: 'invalid',
    }))).toBeNull();
    expect(parseBridgeMessage(JSON.stringify({
      type: 'bike-control-result',
      action: 'invalid-action',
      ok: true,
      message: 'invalid',
    }))).toBeNull();
  });
});
