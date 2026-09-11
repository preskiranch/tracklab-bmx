import { useCallback, useEffect, useRef, useState } from 'react';
import { exploreRequestHeaders, type ExploreRequestAccess } from '../lib/exploreRoutes';

const endpoint = '/api/explore/preview-settings';
const cacheKey = 'tracklab-explore-preview-speed-v1';
const validSpeed = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 2;
function cachedSpeed() {
  try {
    const value = Number(localStorage.getItem(cacheKey));
    return validSpeed(value) ? value : 1;
  } catch { return 1; }
}

export function useExplorePreviewSettings(access: ExploreRequestAccess | null, administrator: boolean) {
  const [savedSpeed, setSavedSpeed] = useState(cachedSpeed);
  const [draftSpeed, setDraftSpeed] = useState(savedSpeed);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const revision = useRef(0);
  useEffect(() => { if (!administrator) { setEditing(false); setMessage(''); } }, [administrator]);
  const apply = useCallback((value: number) => {
    setSavedSpeed(value);
    try { localStorage.setItem(cacheKey, String(value)); } catch { /* Cloud remains authoritative. */ }
  }, []);
  const refresh = useCallback(async () => {
    const requestRevision = revision.current;
    try {
      const response = await fetch(endpoint, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      const payload = await response.json();
      if (requestRevision === revision.current && validSpeed(payload.orbitSpeed)) apply(payload.orbitSpeed);
    } catch { /* Retain the last received setting while offline. */ }
  }, [apply]);
  useEffect(() => {
    void refresh();
    const onVisible = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(onVisible, 15_000);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      revision.current += 1;
      clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);
  const save = async () => {
    revision.current += 1;
    setSaving(true);
    setMessage('Saving to all devices…');
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...exploreRequestHeaders(access) },
        body: JSON.stringify({ orbitSpeed: draftSpeed }),
      });
      const payload = await response.json();
      if (!response.ok || !validSpeed(payload.orbitSpeed)) throw new Error(payload.error || 'Could not save the orbit speed. Please retry.');
      revision.current += 1;
      apply(payload.orbitSpeed);
      setEditing(false);
      setMessage('Saved and locked for all devices.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save. Please retry.'); }
    finally { setSaving(false); }
  };
  return {
    speed: editing ? draftSpeed : savedSpeed, editing, saving, message, refresh, save, setDraftSpeed,
    unlock: () => { setDraftSpeed(savedSpeed); setEditing(true); setMessage('Adjust the speed, then save and lock it for all devices.'); },
    cancel: () => { setEditing(false); setMessage(''); },
  };
}
