import type { ConnectedBikeDevice } from '../types';
import { isTrackLabNativeShell } from './serviceOrigins';

export type AdminAnalytics = {
  generatedAt: string; since: string; days: number; trackingSince?: string;
  accounts: { total: number; verified: number; new: number };
  family: { parents: number; children: number; linked: number };
  traffic: { platform: string; visits: number; views: number; online: number }[];
  daily: { day: string; visits: number; views: number }[];
  pages: { page: string; views: number }[];
  active: { daily: number; weekly: number; monthly: number };
  activity: { activity: string; sessions: number }[];
  reactions: number;
  wattbikes?: { platform: string; connections: number; reporting: number; connectedSessions: number }[];
  requests: { track_id: string; requests: number }[];
};

let wattbikeConnections: number | undefined;
export function reportedWattbikeCount(devices: ConnectedBikeDevice[]) {
  return new Set(devices.filter(d => d.connected && d.source !== 'sim' && d.source !== 'demo').map(d => d.deviceId)).size;
}
export function setAnalyticsWattbikeConnections(devices: ConnectedBikeDevice[]) { wattbikeConnections = reportedWattbikeCount(devices); }
let appVisible = false;
let screenChanged = () => {};
export function setAnalyticsAppVisible(visible: boolean) { appVisible = visible; screenChanged(); }

export function analyticsPage(hash: string, pathname = '/') {
  if (pathname === '/privacy' || pathname === '/privacy-policy') return 'privacy';
  if (pathname === '/support') return 'support';
  const key = hash.split('?')[0].toLowerCase();
  if (key === '#track-locator') return 'tracks';
  if (key === '#bike-shop-directory') return 'shops';
  if (key === '#app-guide') return 'guide';
  if (key === '#beta-testing-info') return 'beta';
  return key ? 'app' : 'home';
}

// First-party operational counts only. Never send URLs, invite tokens, location,
// names, fitness measurements or referrers to this endpoint.
export function startAdminAnalytics() {
  if (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  let visitId: string;
  try {
    visitId = sessionStorage.getItem('tracklab-usage-session') || crypto.randomUUID();
    sessionStorage.setItem('tracklab-usage-session', visitId);
  } catch { return; }
  const platform = isTrackLabNativeShell() ? 'ios' : 'web';
  const currentPage = () => appVisible ? 'app' : analyticsPage(location.hash, location.pathname);
  const send = (kind: 'view' | 'heartbeat') => {
    if (document.visibilityState !== 'visible') return;
    void fetch('/api/usage-event', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitId, platform, page: currentPage(), kind, wattbikeConnections }),
    }).catch(() => undefined);
  };
  let lastPage = currentPage();
  send('view');
  const checkPage = () => {
    const nextPage = currentPage();
    if (nextPage !== lastPage) { lastPage = nextPage; send('view'); }
  };
  screenChanged = checkPage;
  window.addEventListener('hashchange', checkPage);
  // App navigation also uses history.replaceState, which does not emit hashchange.
  window.setInterval(checkPage, 2_000);
  document.addEventListener('visibilitychange', () => send('heartbeat'));
  window.setInterval(() => send('heartbeat'), 60_000);
}

export async function readAdminAnalytics(days: number, signal?: AbortSignal): Promise<AdminAnalytics> {
  const response = await fetch(`/api/admin/analytics?days=${days}`, { credentials: 'same-origin', cache: 'no-store', signal });
  if (!response.ok) throw new Error(response.status === 403 || response.status === 401
    ? 'Sign in with your administrator account to view analytics.' : 'Analytics could not be loaded. Please try Refresh.');
  return response.json();
}
