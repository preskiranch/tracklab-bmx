/** Country federation links and generic BMX map tags do not verify a race venue. */
export function isRacingDirectoryTrack(track: { providerId?: string; sourceType?: string; verificationStatus?: string }) {
  return ['usabmx', 'ffc-bmx-racing', 'auscycling', 'bmxnz', 'british-cycling'].includes(track.providerId ?? '')
    && ['sanctioning-body-track-directory', 'national-federation-track-directory', 'national-federation-club-directory'].includes(track.sourceType ?? '')
    && ['official-track-directory', 'federation-directory'].includes(track.verificationStatus ?? '');
}
