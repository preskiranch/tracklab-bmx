// Keep the desktop connector fail-closed before it derives or emits any
// cadence-driven value. The web app repeats this guard at its trust boundary.
export const maximumAcceptedWattbikeCadenceRpm = 200;
export const maximumAcceptedWattbikeSpeedKph = 80;
// App-derived Explore speed reaches 82.8 KPH at the accepted 200 RPM cadence.
// Keep raw sensor packets at 80 KPH while allowing that valid derived state.
export const maximumAcceptedTrainingSpeedKph = 83;
export const maximumAcceptedTrainingSpeedMph = maximumAcceptedTrainingSpeedKph / 1.609344;

export function acceptedWattbikeCadenceRpm(value) {
  const cadence = Number(value);
  if (
    !Number.isFinite(cadence)
    || cadence < 0
    || cadence > maximumAcceptedWattbikeCadenceRpm
  ) {
    return null;
  }

  return cadence;
}

export function cleanWattbikeCadenceRpm(value) {
  const cadence = acceptedWattbikeCadenceRpm(value);
  return cadence == null ? null : Math.round(cadence);
}

export function acceptedWattbikeSpeedKph(value) {
  const speedKph = Number(value);
  if (
    !Number.isFinite(speedKph)
    || speedKph < 0
    || speedKph > maximumAcceptedWattbikeSpeedKph
  ) {
    return null;
  }

  return speedKph;
}

export function acceptedTrainingSpeedKph(value) {
  const speedKph = Number(value);
  if (
    !Number.isFinite(speedKph)
    || speedKph < 0
    || speedKph > maximumAcceptedTrainingSpeedKph
  ) {
    return null;
  }

  return speedKph;
}

export function acceptedTrainingSpeedMph(value) {
  const speedMph = Number(value);
  if (
    !Number.isFinite(speedMph)
    || speedMph < 0
    || speedMph > maximumAcceptedTrainingSpeedMph
  ) {
    return null;
  }
  return speedMph;
}

export function cleanWattbikeSpeedKph(value) {
  const speedKph = acceptedWattbikeSpeedKph(value);
  return speedKph == null ? null : Math.round(speedKph * 100) / 100;
}
