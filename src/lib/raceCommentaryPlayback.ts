import type { RaceState } from '../types';
import type { RaceCommentaryEvent, RaceCommentaryEventKind } from './raceCommentary';

export type RaceCommentaryPlaybackPhase = 'idle' | 'thinking' | 'preparing' | 'speaking';
export const finishCommentaryReleaseTimeoutMs = 40_000;

function isFinishEvent(event: RaceCommentaryEvent) {
  return event.kind === 'finish' || event.kind === 'rider-finish';
}

export function finishEventHasCompleteField(event: RaceCommentaryEvent) {
  return isFinishEvent(event)
    && event.riders.length > 0
    && event.riders.every((rider) => rider.finished);
}

export function completeFieldFinishReplacesActiveCall(event: RaceCommentaryEvent) {
  return finishEventHasCompleteField(event);
}

export function enqueueFinishCommentaryEvents(
  currentQueue: RaceCommentaryEvent[],
  incomingEvents: RaceCommentaryEvent[],
) {
  const completeFieldEvent = [...incomingEvents]
    .reverse()
    .find(finishEventHasCompleteField);
  if (completeFieldEvent) {
    return [completeFieldEvent];
  }

  const incomingIds = new Set(incomingEvents.map((event) => event.id));
  return [
    ...currentQueue.filter((event) => !incomingIds.has(event.id)),
    ...incomingEvents,
  ].slice(-4);
}

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
  return commentaryNeedsImmediateLine(eventKind) ? 0 : 800;
}

export function shouldInterruptCommentaryForEvent(
  phase: RaceCommentaryPlaybackPhase,
  eventKind: RaceCommentaryEventKind,
) {
  return commentaryNeedsImmediateLine(eventKind)
    && phase === 'thinking';
}
