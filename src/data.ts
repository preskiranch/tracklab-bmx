import type { PlayerSlot } from './types';

export const raceLengthMeters = 340;
export const maxPlayers = 8;
export const liveBikeTimeoutMs = 3800;

export const defaultPlayerSlots: PlayerSlot[] = [
  { id: 1, name: 'Player 1', colorName: 'lime', accent: '#7ade36', deviceId: null },
  { id: 2, name: 'Player 2', colorName: 'red', accent: '#ff4d42', deviceId: null },
  { id: 3, name: 'Player 3', colorName: 'blue', accent: '#39a8ff', deviceId: null },
  { id: 4, name: 'Player 4', colorName: 'yellow', accent: '#ffd83d', deviceId: null },
  { id: 5, name: 'Player 5', colorName: 'lime', accent: '#20c997', deviceId: null },
  { id: 6, name: 'Player 6', colorName: 'red', accent: '#ff8a3d', deviceId: null },
  { id: 7, name: 'Player 7', colorName: 'blue', accent: '#8b5cf6', deviceId: null },
  { id: 8, name: 'Player 8', colorName: 'yellow', accent: '#ec4899', deviceId: null },
];

export const storageKey = 'wattbike-bmx-player-mapping-v1';
export const bikeProfilesStorageKey = 'tracklab-bmx-bike-profiles-v1';
export const speedUnitStorageKey = 'wattbike-bmx-speed-unit-v1';
export const distanceUnitStorageKey = 'wattbike-bmx-distance-unit-v1';
export const raceCaptureStorageKey = 'tracklab-bmx-last-race-capture-v1';
export const customRoutesStorageKey = 'tracklab-bmx-custom-routes-v1';
