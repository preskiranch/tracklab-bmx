/**
 * Decide which surface owns an app launch before React mounts.
 *
 * TrackLab's normal entry point is the Community home. The public directory
 * URLs are also rendered by that surface, so they intentionally remain there
 * and select their requested tab. In contrast, invitations, rooms, and a
 * saved track selection remains available after the rider chooses Open App,
 * but it must not bypass the Community home on launch. Invitations, rooms,
 * and account handoffs do have a specific in-app destination and remain
 * direct launches.
 */
export function shouldOpenCommunityHomeOnLaunch(href: string | null | undefined) {
  try {
    const url = new URL(href || '/', 'https://tracklab.invalid/');
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    const opensCommunityDirectory = url.searchParams.has('locator')
      || url.hash === '#track-locator'
      || url.hash === '#bike-shop-directory';

    if (opensCommunityDirectory) return true;

    const opensWorkspace = url.searchParams.has('room')
      || url.searchParams.has('clubInvite')
      || url.searchParams.has('friendInvite')
      || url.searchParams.has('heartRateStudioInvite')
      || (url.pathname === '/friends/invite' && url.searchParams.has('token'))
      || fragment.has('clubInvite')
      || fragment.has('heartRateAccountBlock');

    return !opensWorkspace;
  } catch {
    // A malformed link should never keep a normal app launch away from home.
    return true;
  }
}
