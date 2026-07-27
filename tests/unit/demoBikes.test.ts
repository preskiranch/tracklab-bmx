import { describe, expect, it } from 'vitest';
import { createDemoPlayers } from '../../src/hooks/useDemoBikes';

describe('demo rider identities', () => {
  it('uses saved real names while preserving defaults for unnamed riders', () => {
    const players = createDemoPlayers(
      4,
      {
        1: 'Maya Torres',
        3: 'Jordan Lee',
      },
      {
        1: 'data:image/jpeg;base64,QUJDRA==',
      },
    );

    expect(players.map((player) => player.name)).toEqual([
      'Maya Torres',
      'Demo Rider 2',
      'Jordan Lee',
      'Demo Rider 4',
    ]);
    expect(players.map((player) => player.deviceId)).toEqual([91001, 91002, 91003, 91004]);
    expect(players[0].photoUrl).toBe('data:image/jpeg;base64,QUJDRA==');
    expect(players[1].photoUrl).toBeUndefined();
  });
});
