import type { BikeProfile, TrackRecord } from '../types';
import type { StoredTrackMappings } from './trackMapping';

export type BridgeUserData = {
  version: 1;
  updatedAt: number;
  trackMappings: StoredTrackMappings;
  customRoutes: TrackRecord[];
  bikeProfiles: BikeProfile[];
};

const bridgeUrl = import.meta.env.VITE_WATTBIKE_BRIDGE_URL?.trim() || 'ws://127.0.0.1:8787';

function bridgeHttpUrl(path: string) {
  const url = new URL(bridgeUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function readBridgeUserData() {
  const response = await fetch(bridgeHttpUrl('/api/user-data'));
  if (!response.ok) {
    throw new Error(`Local bridge user data returned ${response.status}`);
  }

  return response.json() as Promise<BridgeUserData>;
}

export async function patchBridgeUserData(patch: Partial<Omit<BridgeUserData, 'version' | 'updatedAt'>>) {
  const response = await fetch(bridgeHttpUrl('/api/user-data'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(`Local bridge user data save returned ${response.status}`);
  }

  return response.json() as Promise<BridgeUserData>;
}
