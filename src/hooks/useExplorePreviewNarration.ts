import { useEffect, useRef, useState } from 'react';
import type { ExploreRoute } from '../types';
import { nextPreviewNarrationVariant, previewNarrationLines } from '../lib/explorePreviewNarration';
import { exploreRequestHeaders, type ExploreRequestAccess } from '../lib/exploreRoutes';
import { getTrackLabAudioContext } from '../lib/audioCues';

type Preview = { progress: number; playing: boolean } | null;
export function useExplorePreviewNarration(route: ExploreRoute | null, preview: Preview, metric: boolean, access?: ExploreRequestAccess | null) {
  const [enabled, setEnabled] = useState(true);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const buffers = useRef<Array<AudioBuffer | null>>([]);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const playback = useRef({ index: -1, offset: 0, startedAt: 0, finished: false });
  const context = useRef<AudioContext | null>(null);
  const stopAudio = () => {
    const node = source.current;
    source.current = null;
    if (node) { node.onended = null; try { node.stop(); } catch { /* Already ended. */ } node.disconnect(); }
  };
  const pauseAudio = () => {
    if (source.current && context.current) playback.current.offset += context.current.currentTime - playback.current.startedAt;
    stopAudio();
  };
  const clear = () => {
    controller.current?.abort(); controller.current = null;
    stopAudio(); buffers.current = [];
    playback.current = { index: -1, offset: 0, startedAt: 0, finished: false };
  };
  const start = (force = false) => {
    clear(); setMessage('');
    if (!route || (!enabled && !force)) return;
    const ctx = getTrackLabAudioContext(); context.current = ctx;
    if (!ctx) { setMessage('AI narration audio is unavailable on this device.'); return; }
    // Resume in the button gesture; never prime race cadence or crowd audio.
    void ctx.resume().catch(() => setMessage('Tap Narration off, then on to enable audio.'));
    const pending = new AbortController(); controller.current = pending;
    const lines = previewNarrationLines(route, nextPreviewNarrationVariant(route.id), metric);
    setMessage('Preparing female AI narration…');
    buffers.current = lines.map(() => null);
    lines.forEach((line, index) => {
      void (async () => {
        try {
          const response = await fetch('/api/explore/preview-speech', {
            method: 'POST', credentials: 'same-origin', signal: pending.signal,
            headers: { 'Content-Type': 'application/json', Accept: 'audio/wav', ...exploreRequestHeaders(access) },
            body: JSON.stringify({ line }),
          });
          if (!response.ok) throw new Error('AI narration is temporarily unavailable.');
          const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
          if (pending.signal.aborted || controller.current !== pending) return;
          buffers.current[index] = buffer;
          setMessage(''); setReady(value => value + 1);
        } catch {
          if (!pending.signal.aborted && controller.current === pending) setMessage('AI narration is unavailable. Turn narration off and on to retry.');
        }
      })();
    });
  };
  useEffect(() => {
    if (!preview || preview.progress >= 1) { clear(); return; }
    if (!enabled || !preview.playing || document.hidden) { pauseAudio(); return; }
    const index = preview.progress >= 0.72 ? 2 : preview.progress >= 0.32 ? 1 : 0;
    if (playback.current.index !== index) {
      stopAudio(); playback.current = { index, offset: 0, startedAt: 0, finished: false };
    }
    const ctx = context.current;
    const buffer = buffers.current[index];
    if (!ctx || !buffer || source.current || playback.current.finished) return;
    if (playback.current.offset >= buffer.duration) { playback.current.finished = true; return; }
    const node = ctx.createBufferSource(); node.buffer = buffer;
    node.connect(ctx.destination); source.current = node;
    playback.current.startedAt = ctx.currentTime;
    node.onended = () => { if (source.current === node) { source.current = null; playback.current.finished = true; node.disconnect(); } };
    node.start(0, playback.current.offset);
  }, [preview?.playing, preview ? Math.floor(preview.progress * 100) : -1, enabled, ready]);
  useEffect(() => {
    const hide = () => { if (document.hidden) pauseAudio(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); clear(); };
  }, [route?.id, access]);
  return { start, enabled, message, toggle: () => {
    if (enabled) pauseAudio();
    else {
      void context.current?.resume();
      if (preview && preview.progress < 1 && (!buffers.current.some(Boolean) || message.includes('unavailable'))) start(true);
    }
    setEnabled(value => !value);
  } };
}
