import { describe, expect, it } from 'vitest';
import {
  loadUserData,
  persistenceTestHooks,
  saveUserData,
} from '../../cloud/persistence.mjs';

describe('unit preference persistence', () => {
  it('retains the unit snapshot across unrelated in-memory patches and ignores arrays', async () => {
    const profileKey = `user:unit-persistence-${Date.now()}-${Math.random()}`;
    const preferences = { speedUnit: 'mph', distanceUnit: 'ft', updatedAt: 500 };

    await saveUserData(profileKey, { unitPreferences: preferences });
    await saveUserData(profileKey, { bikeProfiles: [{ deviceId: 1, name: 'Bike One' }] });
    await saveUserData(profileKey, { unitPreferences: [] });

    await expect(loadUserData(profileKey)).resolves.toMatchObject({
      bikeProfiles: [{ deviceId: 1, name: 'Bike One' }],
      unitPreferences: preferences,
    });
  });

  it('guards the PostgreSQL upsert with an atomic updatedAt comparison', () => {
    const sql = persistenceTestHooks.userDataUpsertStatement();

    expect(sql).toContain('unit_preferences = CASE');
    expect(sql).toContain("jsonb_typeof(($9::jsonb) -> 'updatedAt') = 'number'");
    expect(sql).toContain('>=');
    expect(sql).toContain('tracklab.user_data.unit_preferences');
    expect(sql).toContain('RETURNING track_mappings');
  });
});
