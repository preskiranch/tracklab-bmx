import { randomUUID } from 'node:crypto';
const memory = new Map();
export function isPlayableIntervalMapping(mapping) {
  return Boolean(mapping && mapping.routeStatus === 'user-mapped'
    && Array.isArray(mapping.centerline) && mapping.centerline.length >= 2
    && Array.isArray(mapping.zones) && mapping.zones.some(z => z.type === 'pedal' && z.endMeter > z.startMeter));
}
export async function sendMappingRequestEmail(request, track, fetcher = fetch) {
  if (!process.env.TRACKLAB_RESEND_API_KEY || !process.env.TRACKLAB_ACCOUNT_EMAIL_FROM) throw new Error('Email unavailable');
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${process.env.TRACKLAB_RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `mapping-request-${request.id}` },
    body: JSON.stringify({ from: process.env.TRACKLAB_ACCOUNT_EMAIL_FROM, to: ['preskiranch@gmail.com'],
      subject: `TrackLab mapping request: ${track.name}`,
      text: `A rider requested this track for a future BMX Race Intervals update.\n\n${track.name}\n${track.state}, ${track.country}\nTrack ID: ${track.id}\nRequest ID: ${request.id}\n\nhttps://tracklabbmx.com/?track=${encodeURIComponent(track.id)}\n\nThis is a request, not a promised release date. No athlete power or health data is included.` }),
  });
  if (!response.ok) throw new Error('Email delivery failed');
}
export function createMappingRequestStore(persistence, schema) {
  return {
    async list(userId) {
      if (!persistence.persistenceEnabled()) return [...memory.values()].filter(r => r.user_id === userId);
      return (await persistence.query(`SELECT id, track_id, notified_at FROM ${schema}.track_mapping_requests WHERE user_id=$1`, [userId])).rows;
    },
    async save(userId, trackId) {
      if (!persistence.persistenceEnabled()) {
        const key = `${userId}:${trackId}`;
        if (!memory.has(key)) memory.set(key, {id: randomUUID(), user_id: userId, track_id: trackId, notified_at: null});
        return memory.get(key);
      }
      return (await persistence.query(`INSERT INTO ${schema}.track_mapping_requests(id,user_id,track_id) VALUES($1,$2,$3)
        ON CONFLICT(user_id,track_id) DO UPDATE SET track_id=EXCLUDED.track_id RETURNING id,track_id,notified_at`, [randomUUID(),userId,trackId])).rows[0];
    },
    async notified(userId, trackId) {
      if (!persistence.persistenceEnabled()) { const r=memory.get(`${userId}:${trackId}`); if(r)r.notified_at=new Date().toISOString(); return; }
      await persistence.query(`UPDATE ${schema}.track_mapping_requests SET notified_at=now() WHERE user_id=$1 AND track_id=$2`, [userId,trackId]);
    },
  };
}
