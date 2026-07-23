import type { RaceState } from '../types';
import type { RaceCommentaryEventKind } from './raceCommentary';

export type RaceCommentaryPlaybackPhase = 'idle' | 'thinking' | 'preparing' | 'speaking';

export function browserSpeechWatchdogMs(line: string) {
  const wordCount = line.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(30_000, Math.max(12_000, 5_000 + (wordCount * 900)));
}

export function raceStateStopsCommentary(raceState: RaceState) {
  return raceState === 'ready';
}

export function commentaryNeedsImmediateLine(eventKind: RaceCommentaryEventKind) {
  return eventKind === 'lead-change'
    || eventKind === 'position-change'
    || eventKind === 'rider-finish'
    || eventKind === 'finish';
}

export function commentaryLineRequestBudgetMs(eventKind: RaceCommentaryEventKind) {
  return commentaryNeedsImmediateLine(eventKind) ? 0 : 1_200;
}

export function shouldInterruptCommentaryForEvent(
  phase: RaceCommentaryPlaybackPhase,
  eventKind: RaceCommentaryEventKind,
) {
  return commentaryNeedsImmediateLine(eventKind)
    && (phase === 'thinking' || phase === 'preparing');
}
