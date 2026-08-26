export type CommentaryMediaGenerationRef = { current: number };

function mediaSourceMatches(audio: HTMLAudioElement, expectedSource: string) {
  return audio.src === expectedSource || audio.currentSrc === expectedSource;
}

/**
 * Primes the exact media element later used by iOS for natural commentary.
 * This helper is intentionally in the eager bundle: audio.play() must execute
 * in the original pointer-handler stack before Safari clears user activation.
 * Every continuation remains generation- and source-guarded so a slow unlock
 * promise can never pause or rewind a newer live speech blob.
 */
export async function primeCommentaryMediaElement({
  audio,
  generationRef,
  unlockSource,
  timeoutMs = 700,
}: {
  audio: HTMLAudioElement;
  generationRef: CommentaryMediaGenerationRef;
  unlockSource: string;
  timeoutMs?: number;
}) {
  const generation = generationRef.current + 1;
  generationRef.current = generation;
  const isCurrentUnlock = () => (
    generationRef.current === generation
    && mediaSourceMatches(audio, unlockSource)
  );

  audio.pause();
  audio.src = unlockSource;
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  audio.muted = false;
  // The unlock WAV contains only zero PCM, so it can stay at full element
  // volume without making a sound or leaving a quiet setting behind.
  audio.volume = 1;
  audio.load();

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finish = (primed: boolean) => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) clearTimeout(timeoutId);
      if (isCurrentUnlock()) {
        audio.pause();
        try {
          audio.currentTime = 0;
        } catch {
          // Metadata can remain unavailable on a blocked mobile element.
        }
      }
      resolve(primed && isCurrentUnlock());
    };

    timeoutId = setTimeout(() => finish(false), timeoutMs);
    void audio.play().then(
      () => finish(true),
      () => finish(false),
    );
  });
}
