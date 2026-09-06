export const familyInvitationDurationMs = 7 * 24 * 60 * 60 * 1000;
export const familyMaximumChildren = 25;

export function familyChildName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/gu, ' ');
  return name.length >= 1 && name.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(name) ? name : null;
}

export function validFamilyToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

export function publicFamilyChild(value, photoUrl) {
  return {
    id: value.id,
    kind: value.kind,
    name: value.name,
    ...(photoUrl ? { photoUrl } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    permissions: { activity: true, health: false },
  };
}

export function publicFamilyInvitation(value) {
  return {
    id: value.id,
    expiresAt: value.expiresAt,
    claimedAt: value.claimedAt ?? null,
    revokedAt: value.revokedAt ?? null,
  };
}

export function familyTrainingTotals(sessions) {
  return {
    sessions: sessions.length,
    bmxRaces: sessions.filter((item) => item.activityType === 'bmx-race').length,
    straightSprints: sessions.filter((item) => item.activityType === 'straight-sprint').length,
    exploreRides: sessions.filter((item) => item.activityType === 'explore').length,
    getPulledTests: sessions.filter((item) => item.activityType === 'get-pulled').length,
    monitorSprints: sessions.filter((item) => item.activityType === 'monitor-sprint').length,
    distanceMeters: sessions.reduce((sum, item) => sum + (Number(item.distanceMeters) || 0), 0),
    durationMs: sessions.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0),
  };
}
