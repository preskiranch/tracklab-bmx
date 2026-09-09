import { normalizeAnalyticsEvent } from '../../cloud/adminAnalytics.mjs';
import { describe, expect, it } from 'vitest';
import { analyticsPage, reportedWattbikeCount } from '../../src/lib/adminAnalytics';

describe('analytics privacy boundaries', () => {
  it('accepts bounded counts without copying device details and distinguishes old clients', () => {
    const event={visitId:'12345678-1234-1234-1234-123456789abc',page:'app',platform:'web',kind:'heartbeat'};
    expect(normalizeAnalyticsEvent(event)).not.toHaveProperty('wattbikeConnections');
    expect(normalizeAnalyticsEvent({...event,wattbikeConnections:0})).toHaveProperty('wattbikeConnections',0);
    for (const value of [-1,5,1.5,'2']) expect(normalizeAnalyticsEvent({...event,wattbikeConnections:value})).not.toHaveProperty('wattbikeConnections');
    expect(normalizeAnalyticsEvent({...event,wattbikeConnections:2,deviceName:'private',watts:900})).toEqual({...event,wattbikeConnections:2});
  });
  it('counts connected physical devices once and excludes simulations', () => {
    expect(reportedWattbikeCount([
      {deviceId:1,label:'Private bike name',connected:true,source:'bluetooth'},
      {deviceId:1,label:'Duplicate',connected:true,source:'bluetooth'},
      {deviceId:2,label:'Offline',connected:false,source:'bluetooth'},
      {deviceId:3,label:'Sim',connected:true,source:'sim'},
      {deviceId:4,label:'Demo',connected:true,source:'demo'},
    ])).toBe(1);
  });
  it('never includes invitation credentials or arbitrary URLs in page categories', () => {
    expect(analyticsPage('#clubInvite=secret')).toBe('app');
    expect(analyticsPage('#familyInvite=private')).toBe('app');
    expect(analyticsPage('#track-locator?token=private')).toBe('tracks');
    expect(analyticsPage('#bike-shop-directory')).toBe('shops');
    expect(analyticsPage('')).toBe('home');
  });
});
