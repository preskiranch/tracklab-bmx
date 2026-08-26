import type { CommentaryMediaGenerationRef } from './commentaryMediaPrime';

export type CommentaryMediaCancelRef = { current: (() => void) | null };

function mediaSourceMatches(audio: HTMLAudioElement, expectedSource: string) {
  return audio.src === expectedSource || audio.currentSrc === expectedSource;
}

/** Plays one speech blob and reports start only after the browser confirms it. */
export async function playCommentaryMediaBlob({
  audio,
  audioBlob,
  volume,
  generationRef,
  activeCancelRef,
  shouldContinue,
  onStart,
  watchdogMs,
}: {
  audio: HTMLAudioElement;
  audioBlob: Blob;
  volume: number;
  generationRef: CommentaryMediaGenerationRef;
  activeCancelRef: CommentaryMediaCancelRef;
  shouldContinue: () => boolean;
  onStart: () => void;
  watchdogMs: number;
}) {
  if (!shouldContinue()) return false;

  const generation = generationRef.current + 1;
  generationRef.current = generation;
  const audioUrl = URL.createObjectURL(audioBlob);
  const isCurrentSpeech = () => (
    generationRef.current === generation
    && mediaSourceMatches(audio, audioUrl)
  );

  audio.pause();
  audio.src = audioUrl;
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  audio.muted = false;
  audio.volume = Math.max(0, Math.min(1, volume));
  audio.load();

  return await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let started = false;
    let watchdogId: ReturnType<typeof setTimeout> | null = null;

    const handleEnded = () => release(started);
    const handleError = () => release(
      false,
      new Error('AI speech audio could not be played.'),
    );
    const release = (played: boolean, error?: unknown) => {
      if (settled) return;
      settled = true;
      if (watchdogId != null) clearTimeout(watchdogId);
      if (audio.onended === handleEnded) audio.onended = null;
      if (audio.onerror === handleError) audio.onerror = null;
      URL.revokeObjectURL(audioUrl);
      if (activeCancelRef.current === cancel) activeCancelRef.current = null;
      if (error) reject(error);
      else resolve(played);
    };
    const cancel = () => {
      if (isCurrentSpeech()) audio.pause();
      release(false);
    };

    audio.onended = handleEnded;
    audio.onerror = handleError;
    activeCancelRef.current = cancel;
    watchdogId = setTimeout(cancel, watchdogMs);
    void audio.play().then(() => {
      // iOS can leave play() pending while its media session is changing. A
      // stop, timeout, or replacement may settle this request first; never
      // announce a late resolution as a real playback start.
      if (settled) return;
      if (!isCurrentSpeech() || !shouldContinue()) {
        cancel();
        return;
      }
      started = true;
      onStart();
    }).catch((error) => {
      release(false, error);
    });
  });
}
