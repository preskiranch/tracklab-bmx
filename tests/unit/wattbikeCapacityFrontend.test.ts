import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bluetoothConnectionAllowed,
  bluetoothConnectionsToDisconnect,
} from '../../src/hooks/useBluetoothBikes';
import {
  clubTabletWattbikeCapacityGrant,
  effectiveWattbikeConnectionLimit,
  normalizeWattbikeCapacityMessage,
  wattbikeCapacityClientGrantTtlMs,
  wattbikeCapacityStatusMessage,
  type WattbikeCapacityState,
} from '../../src/lib/wattbikeCapacity';

const fullGrant: WattbikeCapacityState = {
  type: 'wattbike-capacity',
  requestedConnections: 2,
  grantedConnections: 2,
  connectionLimit: 4,
  accountConnectionsInUse: 2,
  action: 'none',
  reason: 'presence-updated',
};

describe('frontend account-wide Wattbike capacity', () => {
  it('accepts only bounded internally consistent server messages', () => {
    expect(normalizeWattbikeCapacityMessage(fullGrant)).toEqual(fullGrant);
    expect(normalizeWattbikeCapacityMessage({ ...fullGrant, type: 'room-state' })).toBeNull();
    expect(normalizeWattbikeCapacityMessage({ ...fullGrant, requestedConnections: 5 })).toBeNull();
    expect(normalizeWattbikeCapacityMessage({
      ...fullGrant,
      requestedConnections: 2,
      grantedConnections: 1,
      action: 'none',
    })).toBeNull();
    expect(normalizeWattbikeCapacityMessage({
      ...fullGrant,
      requestedConnections: 1,
      grantedConnections: 1,
      action: 'disconnect-excess',
    })).toBeNull();
  });

  it('allows only unallocated account capacity and immediately honors a reduced grant', () => {
    expect(effectiveWattbikeConnectionLimit(4, null)).toBe(0);
    expect(effectiveWattbikeConnectionLimit(4, {
      ...fullGrant,
      requestedConnections: 0,
      grantedConnections: 0,
      accountConnectionsInUse: 3,
    })).toBe(1);
    expect(effectiveWattbikeConnectionLimit(4, fullGrant)).toBe(4);
    expect(effectiveWattbikeConnectionLimit(4, {
      ...fullGrant,
      requestedConnections: 4,
      grantedConnections: 2,
      action: 'disconnect-excess',
      reason: 'capacity-reduced',
    })).toBe(2);
    expect(effectiveWattbikeConnectionLimit(4, {
      ...fullGrant,
      requestedConnections: 4,
      grantedConnections: 0,
      accountConnectionsInUse: 4,
      action: 'disconnect-excess',
      reason: 'capacity-full',
    })).toBe(0);
  });

  it('uses a short-lived, one-seat grant for an authenticated Club Tablet session', () => {
    expect(wattbikeCapacityClientGrantTtlMs).toBeGreaterThan(15_000);
    expect(wattbikeCapacityClientGrantTtlMs).toBeLessThan(45_000);
    expect(clubTabletWattbikeCapacityGrant()).toEqual({
      type: 'wattbike-capacity',
      requestedConnections: 1,
      grantedConnections: 1,
      connectionLimit: 1,
      accountConnectionsInUse: 1,
      action: 'none',
      reason: 'club-tablet-session-authenticated',
    });
    expect(effectiveWattbikeConnectionLimit(1, clubTabletWattbikeCapacityGrant())).toBe(1);
  });

  it('fails closed when the authenticated grant is missing or expires', () => {
    expect(effectiveWattbikeConnectionLimit(4, null)).toBe(0);
    expect(bluetoothConnectionAllowed(false, 'new-bike', [], [], 4)).toBe(false);

    const multiplayerSource = readFileSync(new URL('../../src/hooks/useMultiplayer.ts', import.meta.url), 'utf8');
    const bluetoothSource = readFileSync(new URL('../../src/hooks/useBluetoothBikes.ts', import.meta.url), 'utf8');
    expect(multiplayerSource).toContain('}, wattbikeCapacityClientGrantTtlMs);');
    expect(multiplayerSource).toContain('onWattbikeCapacityChangeRef.current?.(null);');
    expect(bluetoothSource).toContain('activeServersRef.current.forEach(({ deviceId, label }, browserDeviceId) => {');
    expect(bluetoothSource).toContain('disconnectBluetoothDevice(browserDeviceId, deviceId, label);');
  });

  it('disconnects excess Bluetooth GATT servers by stable TrackLab device ID', () => {
    const overflow = bluetoothConnectionsToDisconnect([
      { browserDeviceId: 'browser-c', deviceId: 30, label: 'Bike 30' },
      { browserDeviceId: 'browser-a', deviceId: 10, label: 'Bike 10' },
      { browserDeviceId: 'browser-b', deviceId: 20, label: 'Bike 20' },
      { browserDeviceId: 'browser-d', deviceId: 40, label: 'Bike 40' },
    ], 2);

    expect(overflow.map((connection) => connection.deviceId)).toEqual([30, 40]);
  });

  it('explains forced local disconnection with account-wide usage', () => {
    expect(wattbikeCapacityStatusMessage({
      ...fullGrant,
      requestedConnections: 1,
      grantedConnections: 0,
      accountConnectionsInUse: 4,
      action: 'disconnect-excess',
      reason: 'capacity-full',
    })).toContain('4 of 4 account connections are in use on other TrackLab devices');
    expect(wattbikeCapacityStatusMessage({
      ...fullGrant,
      requestedConnections: 2,
      grantedConnections: 0,
      connectionLimit: 0,
      accountConnectionsInUse: 0,
      action: 'disconnect-excess',
      reason: 'membership-changed',
    })).toContain('not currently included for this account');
  });

  it('wires server messages to the scoped owner or Club Tablet grant used by Bluetooth', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const multiplayerSource = readFileSync(new URL('../../src/hooks/useMultiplayer.ts', import.meta.url), 'utf8');

    expect(multiplayerSource).toContain("message.type === 'wattbike-capacity'");
    expect(multiplayerSource).toContain('publishWattbikeCapacityGrant(capacity)');
    expect(multiplayerSource).toContain('clearWattbikeCapacityGrant();');
    expect(multiplayerSource).toContain('capacityChannelEnabled');
    expect(multiplayerSource).toContain('validateClubTabletSessionCapacity(tabletSession)');
    expect(multiplayerSource).toContain('const clubTabletSessionToken = clubTabletSession?.sessionToken ??');
    expect(multiplayerSource).toContain('latestClubTabletSessionRef.current = clubTabletSession;');
    expect(multiplayerSource).toContain("available: enabled ? latestProfile.available : false");
    expect(multiplayerSource).toContain('if (!enabled) return;');
    expect(multiplayerSource).toContain('bikeCount: wattbikeConnectionCount');
    expect(appSource).toContain('onWattbikeCapacityChange: handleWattbikeCapacityChange');
    expect(appSource).toContain('capacityChannelEnabled: Boolean(');
    expect(appSource).toContain("authStatus === 'signed-in' && authUser");
    expect(appSource).toContain('clubTabletKioskMode && clubTabletSessionActive');
    expect(appSource).toContain('wattbikeConnectionCount,');
    expect(appSource).toContain('serverAuthorizedWattbikeConnectionLimit');
    expect(appSource).toContain('&& clubLiveAccessActive');
    expect(appSource).toContain('separately authenticated /api/club-live/access poll');
    expect(appSource).toContain('maxDevices: Math.max(1, serverAuthorizedWattbikeConnectionLimit)');
    expect(appSource).toContain('claimClubTabletPickerWattbikeCapacity(clubTabletDevice');
    expect(appSource).toContain("appMode !== 'club-tablet'");
    expect(appSource).toContain('clubTabletSessionActive');
    expect(appSource).toContain('Math.min(wattbikeCapacityClientGrantTtlMs, serverGrantRemainingMs)');
    expect(appSource).toContain('releaseClubTabletPickerWattbikeCapacity(clubTabletDevice, { keepalive: true })');
  });
});
