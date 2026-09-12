export function stadiumProgress(distance: number, length: number) {
  return Number.isFinite(distance) && Number.isFinite(length) && length > 0
    ? Math.min(1, Math.max(0, distance / length)) : 0;
}

export function stadiumCadence(cadence: number | undefined) {
  return Number.isFinite(cadence) ? Math.min(300, Math.max(0, cadence!)) : 0;
}
