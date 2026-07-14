import { describe, expect, it, vi } from 'vitest';
import { KeyedCleanupRegistry } from '../../src/lib/keyedCleanupRegistry';

describe('keyed cleanup registry', () => {
  it('cleans only the selected device and runs each cleanup once', () => {
    const registry = new KeyedCleanupRegistry<string>();
    const first = vi.fn();
    const second = vi.fn();
    const other = vi.fn();
    registry.add('bike-1', first);
    registry.add('bike-1', second);
    registry.add('bike-2', other);

    registry.clear('bike-1');
    registry.clear('bike-1');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(registry.count('bike-1')).toBe(0);
    expect(registry.count('bike-2')).toBe(1);
  });

  it('continues cleanup when one listener throws', () => {
    const registry = new KeyedCleanupRegistry<string>();
    const survivingCleanup = vi.fn();
    registry.add('bike-1', () => {
      throw new Error('listener already removed');
    });
    registry.add('bike-1', survivingCleanup);

    expect(() => registry.clearAll()).not.toThrow();
    expect(survivingCleanup).toHaveBeenCalledTimes(1);
  });
});
