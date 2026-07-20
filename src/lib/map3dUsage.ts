import type { TrackRecord } from '../types';

export type Map3DLoadContext = 'view' | 'edit' | 'race';

export type Map3DUsage = {
  generatedAt: string;
  monthlyAllowance: number;
  thisMonth: {
    count: number;
    remaining: number;
    percentUsed: number;
    startsAt: string;
  };
  today: number;
  lifetime: number;
  byContext: Array<{ context: Map3DLoadContext; count: number }>;
  topTracks: Array<{ trackId: string; trackName: string; count: number }>;
  daily: Array<{ date: string; count: number }>;
};

function eventId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `3d-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function recordMap3DLoad(track: TrackRecord, context: Map3DLoadContext) {
  const response = await fetch('/api/map-3d-loads', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: eventId(),
      trackId: track.id,
      trackName: track.name,
      context,
    }),
  });
  if (!response.ok) {
    throw new Error('3D map usage could not be recorded.');
  }
}

export async function readMap3DUsage(): Promise<Map3DUsage> {
  const response = await fetch('/api/admin/map-3d-usage', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : '3D usage could not be loaded.');
  }
  return payload as Map3DUsage;
}
