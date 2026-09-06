export const betaInvitationDurationMs = 7 * 24 * 60 * 60 * 1000;
export const betaDefaultBikeSeats = 4;
export const betaDefaultDurationDays = 90;

export function betaInvitationPolicy(value = {}) {
  const bikeSeats = value.bikeSeats ?? betaDefaultBikeSeats;
  const durationDays = value.durationDays ?? betaDefaultDurationDays;
  if (!Number.isInteger(bikeSeats) || bikeSeats < 1 || bikeSeats > 4
    || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) return null;
  return { bikeSeats, durationDays };
}

export function publicBetaAccessStatus(grant, now = Date.now()) {
  if (!grant) return null;
  const startsAt = Number(grant.startsAt);
  const expiresAt = Number(grant.expiresAt);
  const bikeSeats = Number(grant.bikeSeats);
  const revokedAt = grant.revokedAt == null ? null : Number(grant.revokedAt);
  return {
    id: grant.id,
    active: revokedAt === null && Number.isFinite(startsAt) && startsAt <= now
      && Number.isFinite(expiresAt) && expiresAt > now
      && Number.isInteger(bikeSeats) && bikeSeats >= 1 && bikeSeats <= 4,
    bikeSeats,
    startsAt,
    claimedAt: startsAt,
    expiresAt,
    revokedAt,
  };
}
