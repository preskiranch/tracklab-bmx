import type { PlayerSlot } from './types';
import { EVERGREEN_RIDER_ACCENT } from './lib/playerPalette';

export const raceLengthMeters = 340;
export const maxPlayers = 4;
export const liveBikeTimeoutMs = 3800;

export const defaultPlayerSlots: PlayerSlot[] = [
  { id: 1, name: 'Player 1', colorName: 'lime', accent: EVERGREEN_RIDER_ACCENT, deviceId: null },
  { id: 2, name: 'Player 2', colorName: 'blue', accent: '#39a8ff', deviceId: null },
  { id: 3, name: 'Player 3', colorName: 'red', accent: '#ff4d42', deviceId: null },
  { id: 4, name: 'Player 4', colorName: 'yellow', accent: '#ffd83d', deviceId: null },
];

export const storageKey = 'wattbike-bmx-player-mapping-v1';
export const bikeProfilesStorageKey = 'tracklab-bmx-bike-profiles-v1';
export const studioRidersStorageKey = 'tracklab-bmx-studio-riders-v1';
export const bikeConnectionSourceStorageKey = 'tracklab-bmx-bike-connection-source-v1';
export const speedUnitStorageKey = 'wattbike-bmx-speed-unit-v1';
export const distanceUnitStorageKey = 'wattbike-bmx-distance-unit-v1';
export const unitPreferencesStorageKey = 'tracklab-bmx-unit-preferences-v1';
export const unitPreferencesLegacyOwnerStorageKey = 'tracklab-bmx-unit-preferences-legacy-owner-v1';
export const raceCaptureStorageKey = 'tracklab-bmx-last-race-capture-v1';
export const ghostLapsStorageKey = 'tracklab-bmx-ghost-laps-v1';
export const customRoutesStorageKey = 'tracklab-bmx-custom-routes-v1';
export const earthCameraStorageKey = 'tracklab-bmx-earth-camera-v1';
export const raceViewPreferencesStorageKey = 'tracklab-bmx-race-view-preferences-v1';
