export const analyticsPages = new Set(['home', 'tracks', 'shops', 'guide', 'beta', 'app', 'privacy', 'support']);
export function normalizeAnalyticsEvent(body) {
  if (!body || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.visitId ?? '') || !analyticsPages.has(body.page)
    || !['web', 'ios'].includes(body.platform) || !['view', 'heartbeat'].includes(body.kind)) return null;
  return { visitId: body.visitId, page: body.page, platform: body.platform, kind: body.kind };
}
export function analyticsDays(value) { const n = Number(value); return [1, 7, 30].includes(n) ? n : 7; }
