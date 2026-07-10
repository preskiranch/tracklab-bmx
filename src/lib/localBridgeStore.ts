import type { BikeProfile, TrackRecord } from '../types';
import type { StoredTrackMappings } from './trackMapping';
import { fetchBridgeEndpoint } from './localBridgeUrls';
import { createPatchBatcher } from './patchBatcher';

export type BridgeUserData = {
  version: 1;
  updatedAt: number;
  trackMappings: StoredTrackMappings;
  customRoutes: TrackRecord[];
  bikeProfiles: BikeProfile[];
};

export async function readBridgeUserData() {
  const response = await fetchBridgeEndpoint('/api/user-data');
  if (!response.ok) {
    throw new Error(`Advanced Connector user data returned ${response.status}`);
  }

  return response.json() as Promise<BridgeUserData>;
}

export async function patchBridgeUserData(patch: Partial<Omit<BridgeUserData, 'version' | 'updatedAt'>>) {
  const response = await fetchBridgeEndpoint('/api/user-data', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(`Advanced Connector user data save returned ${response.status}`);
  }

  return response.json() as Promise<BridgeUserData>;
}

const bridgePatchBatcher = createPatchBatcher(patchBridgeUserData);

export function queueBridgeUserDataPatch(patch: Partial<Omit<BridgeUserData, 'version' | 'updatedAt'>>) {
  return bridgePatchBatcher.enqueue(patch);
}
