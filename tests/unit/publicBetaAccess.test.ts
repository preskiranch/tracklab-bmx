import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
// @ts-expect-error server module
import * as persistence from '../../cloud/persistence.mjs';
// @ts-expect-error server module
import { publicBetaPolicy } from '../../cloud/betaAccess.mjs';
// @ts-expect-error server module
import { wattbikeMembershipForAccount } from '../../cloud/appleMembership.mjs';
const original = process.env.TRACKLAB_PUBLIC_BETA_ENDS_AT;
afterEach(() => { if (original === undefined) delete process.env.TRACKLAB_PUBLIC_BETA_ENDS_AT; else process.env.TRACKLAB_PUBLIC_BETA_ENDS_AT = original; });
async function rider(id = randomUUID()) { return persistence.createAuthUser({ id, email: `${randomUUID()}@tracklab.test`, displayName: 'Beta rider', passwordHash:'not-a-real-password',membershipTier:'spectator',bikeSeats:1 }); }
describe('automatic public beta enrollment', () => {
  it('requires a configured future deadline and caps each grant at 90 days', () => {
    const now=Date.now();
    for(const date of ['', 'invalid', new Date(now-1).toISOString()]) expect(publicBetaPolicy({TRACKLAB_PUBLIC_BETA_ENDS_AT:date},now)).toBeNull();
    expect(publicBetaPolicy({TRACKLAB_PUBLIC_BETA_ENDS_AT:new Date(now+365*86400000).toISOString()},now)).toEqual({bikeSeats:4,expiresAt:now+90*86400000});
  });
  it('grants once concurrently, preserves paid fields, and never reinstates revoked access', async () => {
    const now=Date.now(); process.env.TRACKLAB_PUBLIC_BETA_ENDS_AT=new Date(now+86400000).toISOString();
    const user=await rider(); const grants=await Promise.all(Array.from({length:8},()=>persistence.ensurePublicBetaAccess(user.id,now)));
    expect(new Set(grants.map(x=>x.id)).size).toBe(1);
    const projected=await persistence.findAuthUserById(user.id);
    expect(projected.membershipTier).toBe('spectator');
    expect(wattbikeMembershipForAccount(projected,{appleOnlyCutover:true})).toEqual({tier:'racer',bikeSeats:4});
    await persistence.revokeBetaAccess({grantId:grants[0].id,actorUserId:user.id},now+1);
    expect((await persistence.ensurePublicBetaAccess(user.id,now+2)).revokedAt).toBe(now+1);
    expect(wattbikeMembershipForAccount(await persistence.findAuthUserById(user.id),{appleOnlyCutover:true}).tier).toBe('spectator');
  });
  it('supports child identities without email invitations and does not extend expiration', async () => {
    const now=Date.now();process.env.TRACKLAB_PUBLIC_BETA_ENDS_AT=new Date(now+10000).toISOString();
    const child=await rider(`child-${randomUUID()}`);const first=await persistence.ensurePublicBetaAccess(child.id,now);
    process.env.TRACKLAB_PUBLIC_BETA_ENDS_AT=new Date(now+100000).toISOString();
    expect((await persistence.ensurePublicBetaAccess(child.id,now+20000)).expiresAt).toBe(first.expiresAt);
    expect(await persistence.ensurePublicBetaAccess('missing-user',now)).toBeNull();
  });
});
