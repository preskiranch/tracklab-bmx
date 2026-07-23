function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function riderAliases(name) {
  const normalized = String(name || '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return [];
  }
  return [...new Set([normalized, normalized.split(' ')[0]])]
    .filter((alias) => alias.length >= 2)
    .sort((left, right) => right.length - left.length);
}

function lineMentionsRider(line, rider) {
  return riderAliases(rider?.name).some((alias) => (
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegularExpression(alias)}(?=$|[^\\p{L}\\p{N}])`,
      'iu',
    ).test(String(line || ''))
  ));
}

export function commentaryRiderMentionCounts(riders, raceLines = []) {
  return new Map(riders.map((rider) => [
    rider.playerId,
    raceLines.reduce(
      (count, line) => count + (lineMentionsRider(line, rider) ? 1 : 0),
      0,
    ),
  ]));
}

export function selectCommentaryFocusRiders(event, raceLines = [], limit = 2) {
  const riders = [...(event?.riders || [])].sort((left, right) => left.rank - right.rank);
  if (riders.length === 0 || limit <= 0) {
    return [];
  }

  const mentionCounts = commentaryRiderMentionCounts(riders, raceLines);
  const startIndex = Math.max(0, Math.round(Number(event?.sequence) || 1) - 1) % riders.length;
  const orderByPlayerId = new Map(riders.map((rider, index) => [rider.playerId, index]));
  return riders
    .sort((left, right) => {
      const mentionDifference = (mentionCounts.get(left.playerId) || 0)
        - (mentionCounts.get(right.playerId) || 0);
      if (mentionDifference !== 0) {
        return mentionDifference;
      }
      const leftIndex = orderByPlayerId.get(left.playerId) || 0;
      const rightIndex = orderByPlayerId.get(right.playerId) || 0;
      const leftRotation = (leftIndex - startIndex + riders.length) % riders.length;
      const rightRotation = (rightIndex - startIndex + riders.length) % riders.length;
      return leftRotation - rightRotation;
    })
    .slice(0, Math.min(limit, riders.length));
}

function leaderFor(event) {
  return event.riders.find((rider) => rider.playerId === event.leaderPlayerId)
    || event.riders[0]
    || null;
}

function closeBattleRiders(event, raceLines = []) {
  const riders = [...(event?.riders || [])];
  const mentionCounts = commentaryRiderMentionCounts(riders, raceLines);
  const battle = [...(event?.closeBattles || [])].sort((left, right) => {
    const leftMentions = (mentionCounts.get(left.frontPlayerId) || 0)
      + (mentionCounts.get(left.behindPlayerId) || 0);
    const rightMentions = (mentionCounts.get(right.frontPlayerId) || 0)
      + (mentionCounts.get(right.behindPlayerId) || 0);
    return leftMentions - rightMentions
      || Number(right.position || 0) - Number(left.position || 0)
      || Number(left.gapMeters || 0) - Number(right.gapMeters || 0);
  })[0];
  if (!battle) {
    return [];
  }
  return [battle.frontPlayerId, battle.behindPlayerId]
    .map((playerId) => riders.find((rider) => rider.playerId === playerId))
    .filter(Boolean);
}

export function requiredCommentaryRiders(event, raceLines = []) {
  const focusRiders = selectCommentaryFocusRiders(event, raceLines, 2);
  const battleRiders = closeBattleRiders(event, raceLines);
  if (event.kind === 'race-start') {
    return [];
  }
  if (event.kind === 'finish') {
    return [leaderFor(event)].filter(Boolean);
  }
  if (event.kind === 'lead-change') {
    const newLeader = leaderFor(event);
    const previousLeader = event.riders.find(
      (rider) => rider.playerId === event.previousLeaderPlayerId,
    );
    return [...new Map(
      [newLeader, previousLeader, ...battleRiders]
        .filter(Boolean)
        .map((rider) => [rider.playerId, rider]),
    ).values()].slice(0, 4);
  }
  if (event.kind === 'position-change') {
    const passingRider = event.riders.find(
      (rider) => rider.playerId === event.passingPlayerId,
    );
    const passedRider = event.riders.find(
      (rider) => rider.playerId === event.passedPlayerId,
    );
    return [...new Map(
      [passingRider, passedRider, ...battleRiders]
        .filter(Boolean)
        .map((rider) => [rider.playerId, rider]),
    ).values()].slice(0, 4);
  }
  if (event.kind === 'pro-set' || event.kind === 'final-push') {
    const leader = leaderFor(event);
    return [...new Map(
      [leader, ...battleRiders, ...focusRiders]
        .filter(Boolean)
        .map((rider) => [rider.playerId, rider]),
    ).values()].slice(0, 3);
  }
  return battleRiders.length > 0 ? battleRiders : focusRiders;
}

export function commentaryUsesWryAside(event) {
  return !['race-start', 'finish'].includes(event?.kind)
    && Math.max(0, Math.round(Number(event?.sequence) || 0)) % 5 === 0;
}
