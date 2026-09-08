import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error server module
import { createMappingRequestStore, isPlayableIntervalMapping, sendMappingRequestEmail } from '../../cloud/trackMappingRequests.mjs';
afterEach(()=>vi.unstubAllEnvs());
describe('mapping requests',()=>{
  it('requires saved route geometry and at least one usable pedal zone',()=>{
    const mapping={routeStatus:'user-mapped',centerline:[{x:0,y:0},{x:10,y:0}],zones:[{type:'pedal',startMeter:0,endMeter:10}]};
    expect(isPlayableIntervalMapping(mapping)).toBe(true);
    expect(isPlayableIntervalMapping({...mapping,zones:[]})).toBe(false);
    expect(isPlayableIntervalMapping({...mapping,routeStatus:'estimated'})).toBe(false);
    expect(isPlayableIntervalMapping({...mapping,centerline:[]})).toBe(false);
  });
  it('deduplicates each account/track pair and keeps account lists separate',async()=>{
    const store=createMappingRequestStore({persistenceEnabled:()=>false},'tracklab');
    const one=await store.save('request-owner-a','test-track');
    expect((await store.save('request-owner-a','test-track')).id).toBe(one.id);
    expect(await store.list('request-owner-b')).toEqual([]);
    await store.notified('request-owner-a','test-track');
    expect((await store.list('request-owner-a'))[0].notified_at).toBeTruthy();
  });
  it('emails only the owner, uses stable idempotency, and omits athlete metrics',async()=>{
    vi.stubEnv('TRACKLAB_RESEND_API_KEY','test-only-key');vi.stubEnv('TRACKLAB_ACCOUNT_EMAIL_FROM','TrackLab <accounts@example.test>');
    const send=vi.fn().mockResolvedValue({ok:true});
    await sendMappingRequestEmail({id:'request-123'}, {id:'track-1',name:'Example BMX',state:'California',country:'United States',watts:999},send);
    const options=send.mock.calls[0][1];const body=JSON.parse(options.body);
    expect(body.to).toEqual(['preskiranch@gmail.com']);expect(body.text).toContain('Example BMX');expect(body.text).not.toContain('999');
    expect(options.headers['Idempotency-Key']).toBe('mapping-request-request-123');
    await expect(sendMappingRequestEmail({id:'request-123'},{id:'track-1'},vi.fn().mockResolvedValue({ok:false}))).rejects.toThrow('delivery');
  });
});
