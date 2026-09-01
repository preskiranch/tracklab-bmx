import type { ClubLiveSession } from './clubLive';

const sharedActivityTypes = new Set<ClubLiveSession['activityType']>([
  'bmx-race',
  'straight-sprint',
  'explore',
]);

export type ClubLivePresentationSource<Media> = Readonly<{
  id: string;
  session: ClubLiveSession;
  media: Media | null;
  mediaLive: boolean;
  /** Direct video outranks the low-rate JPEG safety feed during failover. */
  mediaTransport?: 'direct' | 'fallback';
}>;

export type ClubLivePresentation<Media> = Readonly<{
  id: string;
  kind: 'shared' | 'individual';
  activityType: ClubLiveSession['activityType'];
  sources: readonly ClubLivePresentationSource<Media>[];
  canonicalSource: ClubLivePresentationSource<Media>;
}>;

export type ClubLiveCanonicalSelections = Readonly<Record<string, string>>;

function sourceSortKey<Media>(source: ClubLivePresentationSource<Media>) {
  return source.session.deviceId
    ?? `${source.session.studioRiderId}:${source.session.sessionId ?? source.session.id}`;
}

function compareSources<Media>(
  left: ClubLivePresentationSource<Media>,
  right: ClubLivePresentationSource<Media>,
) {
  return sourceSortKey(left).localeCompare(sourceSortKey(right))
    || left.id.localeCompare(right.id);
}

export function clubLiveSessionUsesSharedPresentation(session: ClubLiveSession) {
  return session.presentation === 'shared'
    && session.multiplayer
    && Boolean(session.sharedViewId)
    && session.activityType !== 'get-pulled'
    && sharedActivityTypes.has(session.activityType);
}

export function clubLivePresentationId(session: ClubLiveSession) {
  if (clubLiveSessionUsesSharedPresentation(session)) {
    return `shared:${session.clubId}:${session.activityType}:${session.sharedViewId}`;
  }
  return `individual:${session.clubId}:${session.studioRiderId}:${session.sessionId ?? session.id}`;
}

function chooseCanonicalSource<Media>(
  sources: readonly ClubLivePresentationSource<Media>[],
  previousSourceId: string | undefined,
) {
  const sorted = [...sources].sort(compareSources);
  const liveSources = sorted.filter((source) => source.mediaLive);
  const bestTransportRank = liveSources.reduce((best, source) => Math.max(
    best,
    source.mediaTransport === 'direct' ? 2 : 1,
  ), 0);
  const bestLiveSources = liveSources.filter((source) => (
    (source.mediaTransport === 'direct' ? 2 : 1) === bestTransportRank
  ));
  return bestLiveSources.find((source) => source.id === previousSourceId)
    ?? bestLiveSources[0]
    ?? sorted.find((source) => source.id === previousSourceId)
    ?? sorted[0];
}

/**
 * Converts up to four athlete sessions into the owner monitor's
 * activity-aware stages.
 *
 * A shared stage is created only from explicit server-normalized metadata.
 * Random per-device race session IDs, track labels, and close start times are
 * deliberately ignored. The prior canonical source remains selected while
 * its media is live, preventing the primary view from jumping between tablets
 * as their network updates arrive in a different order.
 */
export function selectClubLivePresentations<Media>(
  sources: readonly ClubLivePresentationSource<Media>[],
  previousCanonicalSources: ClubLiveCanonicalSelections = {},
): ClubLivePresentation<Media>[] {
  const grouped = new Map<string, ClubLivePresentationSource<Media>[]>();
  sources.slice(0, 4).forEach((source) => {
    const id = clubLivePresentationId(source.session);
    const group = grouped.get(id);
    if (group) group.push(source);
    else grouped.set(id, [source]);
  });

  return [...grouped.entries()]
    .map(([id, groupSources]) => {
      const canonicalSource = chooseCanonicalSource(groupSources, previousCanonicalSources[id]);
      return {
        id,
        kind: clubLiveSessionUsesSharedPresentation(canonicalSource.session)
          ? 'shared' as const
          : 'individual' as const,
        activityType: canonicalSource.session.activityType,
        sources: [...groupSources].sort(compareSources),
        canonicalSource,
      };
    })
    .sort((left, right) => (
      Number(right.kind === 'shared') - Number(left.kind === 'shared')
      || left.id.localeCompare(right.id)
    ));
}

export function clubLiveCanonicalSelections(
  presentations: readonly ClubLivePresentation<unknown>[],
): ClubLiveCanonicalSelections {
  return Object.fromEntries(presentations.map((presentation) => [
    presentation.id,
    presentation.canonicalSource.id,
  ]));
}
