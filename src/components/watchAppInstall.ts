import type { NativeHeartRateAvailability } from '../lib/nativeHeartRate';

// Replace this with TrackLab's approved public TestFlight join URL when Apple
// makes that link available. Never guess or fabricate a beta invitation code.
export const trackLabTestFlightUrl = 'https://testflight.apple.com/';

export const watchAppInstallInstructions = 'Open TrackLab BMX in TestFlight. On its App Details page, scroll to Information, then tap Install beside Apple Watch. Return here and tap Check again.';

export function watchAppNeedsInstall(
  availability: NativeHeartRateAvailability | null,
) {
  return availability?.platform === 'iphone'
    && availability.paired === true
    && availability.supported === false
    && availability.watchAppInstalled === false;
}
