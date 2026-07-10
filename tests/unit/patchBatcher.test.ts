import { describe, expect, it } from 'vitest';
import { createPatchBatcher } from '../../src/lib/patchBatcher';

describe('partial update batching', () => {
  it('coalesces independent fields into one request', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const batcher = createPatchBatcher(async (patch: Record<string, unknown>) => {
      sent.push(patch);
      return { ok: true, patch };
    }, 60_000);

    const first = batcher.enqueue({ bikeProfiles: ['Bike One'] });
    const second = batcher.enqueue({ customRoutes: ['Route One'] });
    const third = batcher.enqueue({ bikeProfiles: ['Renamed Bike'] });
    await batcher.flush();

    expect(sent).toEqual([{
      bikeProfiles: ['Renamed Bike'],
      customRoutes: ['Route One'],
    }]);
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ]);
  });

  it('continues processing after a failed batch', async () => {
    let attempts = 0;
    const batcher = createPatchBatcher(async (patch: { value: number }) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('temporary failure');
      }
      return patch.value;
    }, 60_000);

    const failed = batcher.enqueue({ value: 1 });
    await batcher.flush();
    await expect(failed).rejects.toThrow('temporary failure');

    const recovered = batcher.enqueue({ value: 2 });
    await batcher.flush();
    await expect(recovered).resolves.toBe(2);
  });
});
