// Navigation recovery is tab/device-local; ride data remains account-scoped.
const key = 'tracklab-active-explore-demo-v1';
export function hasExploreDemoRecovery() {
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}
export function setExploreDemoRecovery(active: boolean) {
  try { if (active) sessionStorage.setItem(key, '1'); else sessionStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}
