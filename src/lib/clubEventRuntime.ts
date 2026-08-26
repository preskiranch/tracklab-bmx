/** A tablet may publish multiplayer state only for its active coach event. */
export function clubEventMultiplayerRoomReady(
  activeEventId: string | null | undefined,
  roomEventId: string | null | undefined,
) {
  return !activeEventId || activeEventId === roomEventId;
}
