import { useEffect, useRef, useState } from 'react';
import type { ExploreRoute } from '../types';
import { nextPreviewNarrationVariant, previewNarrationLines } from '../lib/explorePreviewNarration';

type Preview = { progress: number; playing: boolean } | null;
export function useExplorePreviewNarration(route: ExploreRoute | null, preview: Preview, metric: boolean) {
  const [enabled, setEnabled] = useState(true);
  const [message, setMessage] = useState('');
  const lines = useRef<string[]>([]);
  const spoken = useRef(new Set<number>());
  const owned = useRef(false);
  const stop = () => {
    if (owned.current) window.speechSynthesis?.cancel();
    owned.current = false;
  };
  const say = (index: number, force = false) => {
    if ((!enabled && !force) || !lines.current[index] || spoken.current.has(index)) return;
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setMessage('Spoken preview is unavailable on this device.');
      return;
    }
    stop();
    spoken.current.add(index);
    const utterance = new SpeechSynthesisUtterance(lines.current[index]);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    utterance.onerror = event => {
      if (event.error !== 'canceled' && event.error !== 'interrupted') setMessage('Narration could not play. Try turning narration off and on.');
    };
    owned.current = true;
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  };
  const start = () => {
    stop();
    spoken.current.clear();
    setMessage('');
    lines.current = route ? previewNarrationLines(route, nextPreviewNarrationVariant(route.id), metric) : [];
    say(0); // Start from the preview button gesture for mobile audio policies.
  };
  useEffect(() => {
    if (!preview || preview.progress >= 1 || !enabled) { stop(); return; }
    if (!preview.playing) { if (owned.current) window.speechSynthesis?.pause(); return; }
    if (document.hidden) return;
    if (owned.current) window.speechSynthesis?.resume();
    say(preview.progress >= 0.72 ? 2 : preview.progress >= 0.32 ? 1 : 0);
  }, [preview?.playing, preview ? Math.floor(preview.progress * 100) : -1, enabled]);
  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); stop(); };
  }, [route?.id]);
  return { start, enabled, message, toggle: () => {
    if (enabled) stop();
    else if (preview?.playing && preview.progress < 1) {
      const index = preview.progress >= 0.72 ? 2 : preview.progress >= 0.32 ? 1 : 0;
      spoken.current.delete(index);
      say(index, true);
    }
    setEnabled(value => !value);
  } };
}
