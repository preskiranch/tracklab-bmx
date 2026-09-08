import { randomBytes, createHash } from 'node:crypto';
export const accountEmailHash = token => createHash('sha256').update(token).digest('hex');
export const validAccountEmailToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
export function accountEmailConfigured() { return Boolean(process.env.TRACKLAB_RESEND_API_KEY && process.env.TRACKLAB_ACCOUNT_EMAIL_FROM); }
export function accountEmailVerificationEnabled() { return process.env.TRACKLAB_REQUIRE_EMAIL_VERIFICATION === 'true'; }
export async function sendAccountEmail(user, purpose, persistence, fetcher = fetch) {
  if (!accountEmailConfigured()) throw new Error('Account email is temporarily unavailable. Please try again shortly.');
  const token = randomBytes(32).toString('hex');
  const hash = accountEmailHash(token);
  const minutes = purpose === 'reset' ? 30 : 1440;
  if (!(await persistence.issueAccountEmailToken(user.id, purpose, hash, Date.now() + minutes * 60000, user.email))) return;
  const origin = process.env.TRACKLAB_ACCOUNT_PUBLIC_ORIGIN || 'https://tracklabbmx.com';
  const url = new URL('/account-access.html', origin);
  if(url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Secure account URL required');
  url.hash = `${purpose}=${token}`;
  const action = purpose === 'reset' ? 'Reset password' : 'Verify email';
  const duration = purpose === 'reset' ? '30 minutes' : '24 hours';
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method:'POST', signal:AbortSignal.timeout(12000),
      headers:{Authorization:`Bearer ${process.env.TRACKLAB_RESEND_API_KEY}`,'Content-Type':'application/json','User-Agent':'TrackLab-Account-Mail','Idempotency-Key':`tracklab-${hash}`},
      body:JSON.stringify({from:process.env.TRACKLAB_ACCOUNT_EMAIL_FROM,to:[user.email],
        ...(process.env.TRACKLAB_ACCOUNT_REPLY_TO ? {reply_to:process.env.TRACKLAB_ACCOUNT_REPLY_TO}:{}),
        subject:`${action} for TrackLab BMX`,
        text:`${action} using this secure link (expires in ${duration}):\n${url.href}\n\nIf you did not request this, ignore this email.\nParents verify their own email; parent-managed children do not need an email address.`,
        html:`<h1>TrackLab BMX</h1><p>${action} to continue.</p><p><a href="${url.href}">${action}</a></p><p>This link expires in ${duration}. If you did not request it, ignore this email.</p><p>Parents verify their own email; parent-managed children do not need an email address.</p>`})
    });
    if(!response.ok) throw new Error('delivery-failed');
  } catch {
    await persistence.discardAccountEmailToken(hash);
    throw new Error('Account email could not be sent. Please try again shortly.');
  }
}
