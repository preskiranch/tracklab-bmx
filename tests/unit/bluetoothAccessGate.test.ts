import { describe, expect, it } from 'vitest';
import {
  bluetoothConnectionAllowed,
  bluetoothPairingMayOpen,
  normalizeBluetoothMaxDevices,
} from '../../src/hooks/useBluetoothBikes';
import {
  authenticatedRacerBikeAccess,
  authenticatedRacerBikeSeatLimit,
} from '../../src/lib/advancedConnectorPolicy';

describe('temporary club Bluetooth access gate', () => {
  it('fails closed if access expires while the device chooser is open', () => {
    expect(bluetoothPairingMayOpen(false, true, true)).toBe(false);
    expect(bluetoothPairingMayOpen(false, false, false)).toBe(false);
  });

  it('allows only one device for a temporary club seat, including in-flight connections', () => {
    expect(bluetoothConnectionAllowed(true, 'bike-b', ['bike-a'], [], 1)).toBe(false);
    expect(bluetoothConnectionAllowed(true, 'bike-b', [], ['bike-a'], 1)).toBe(false);
    expect(bluetoothConnectionAllowed(true, 'bike-a', ['bike-a'], [], 1)).toBe(true);
  });

  it('always denies new connections while Bluetooth access is locked', () => {
    expect(bluetoothConnectionAllowed(false, 'bike-a', [], [], 4)).toBe(false);
  });

  it('clamps the physical connection limit to TrackLab\'s one-to-four racer range', () => {
    expect(normalizeBluetoothMaxDevices(0)).toBe(1);
    expect(normalizeBluetoothMaxDevices(2.4)).toBe(2);
    expect(normalizeBluetoothMaxDevices(99)).toBe(4);
  });

  it('never trusts stored or billing-URL Racer state before the server restores the account', () => {
    expect(authenticatedRacerBikeAccess('loading', 'racer')).toBe(false);
    expect(authenticatedRacerBikeAccess('signed-out', 'racer')).toBe(false);
    expect(authenticatedRacerBikeAccess('signed-in', 'spectator')).toBe(false);
    expect(authenticatedRacerBikeAccess('signed-in', 'racer')).toBe(true);
  });

  it('limits personal connections to the server-restored number of purchased bike seats', () => {
    expect(authenticatedRacerBikeSeatLimit('signed-in', 'racer', 1)).toBe(1);
    expect(authenticatedRacerBikeSeatLimit('signed-in', 'racer', 3)).toBe(3);
    expect(authenticatedRacerBikeSeatLimit('signed-in', 'racer', 20)).toBe(4);
    expect(authenticatedRacerBikeSeatLimit('signed-in', 'racer', 99)).toBe(4);
    expect(authenticatedRacerBikeSeatLimit('signed-in', 'spectator', 4)).toBe(0);
    expect(authenticatedRacerBikeSeatLimit('loading', 'racer', 4)).toBe(0);
  });
});
