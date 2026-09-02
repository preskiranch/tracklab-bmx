import { expect, test } from '@playwright/test';

const favoriteTrack = {
  id: 'apple-valley-bmx-moto-park',
  name: 'Apple Valley BMX Moto Park',
  country: 'United States',
  countryCode: 'US',
  state: 'California',
  region: 'California',
  source: 'USA BMX',
  address: '24320 Highway 18, Apple Valley, CA 92307',
  city: 'Apple Valley',
  postalCode: '92307',
  latitude: 34.471,
  longitude: -117.185,
};

const otherTrack = {
  ...favoriteTrack,
  id: 'bellflower-bmx',
  name: 'Bellflower BMX',
  address: 'Different public address',
  city: 'Bellflower',
  latitude: 33.88,
  longitude: -118.13,
};

test('favorites, friend sharing, and canonical track links stay exact and responsive', async ({ page }) => {
  const accountId = 'favorite-track-rider';
  const favoriteIds = new Set<string>();
  const favoriteMutations: string[] = [];
  const shareMutations: Array<Record<string, unknown>> = [];
  let releaseFavoriteHydration = () => undefined;
  const favoriteHydration = new Promise<void>((resolve) => { releaseFavoriteHydration = resolve; });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as typeof window & { copiedTrackLink?: string }).copiedTrackLink = value;
        },
      },
    });
  });
  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      user: {
        id: accountId,
        profileKey: `user:${accountId}`,
        email: 'favorite-track@tracklab.test',
        name: 'Favorite Track Rider',
        admin: false,
        membership: { tier: 'spectator', bikeSeats: 1, updatedAt: Date.now() },
      },
    }),
  }));
  await page.route('**/api/user-data*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      trackMappings: {},
      customRoutes: [],
      bikeProfiles: [],
      studioRiders: [],
      accountProfile: { updatedAt: Date.now() },
    }),
  }));
  await page.route('**/data/track-locator.json', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ tracks: [favoriteTrack, otherTrack] }),
  }));
  await page.route('**/api/track-favorites**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      await favoriteHydration;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ trackIds: [...favoriteIds] }) });
      return;
    }
    const trackId = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
    if (request.method() === 'PUT') {
      favoriteIds.add(trackId);
      favoriteMutations.push(`save:${trackId}`);
    } else {
      favoriteIds.delete(trackId);
      favoriteMutations.push(`remove:${trackId}`);
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ trackId, favorite: request.method() === 'PUT' }) });
  });
  await page.route('**/api/friends**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/friends/track-shares' && request.method() === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      shareMutations.push(payload);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          share: {
            id: 'share-apple-valley',
            trackId: payload.trackId,
            trackName: favoriteTrack.name,
            trackLocation: 'Apple Valley, California, United States',
            sender: { id: accountId, handle: 'favorite.track', displayName: 'Favorite Track Rider' },
            createdAt: new Date().toISOString(),
            openedAt: null,
          },
        }),
      });
      return;
    }
    if (path === '/api/friends') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: 'explicit-friend-rider',
            handle: 'explicit.friend',
            displayName: 'Explicit Friend',
            relationship: 'friend',
            canShareTrack: true,
          }, {
            id: 'official-default',
            handle: 'official.default',
            displayName: 'Official Default',
            relationship: 'friend',
            officialKind: 'founder',
          }],
          nextCursor: null,
          total: 2,
        }),
      });
      return;
    }
    await route.fulfill({ status: path === '/api/friends/events' ? 204 : 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/heart-rate/**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/club-connect*', (route) => route.fulfill({ contentType: 'application/json', body: '{"memberships":[]}' }));
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());

  await page.goto(`/?locator=${favoriteTrack.id}#track-locator`);
  const locator = page.locator('#track-locator');
  await expect(locator.getByRole('heading', { name: favoriteTrack.name })).toBeVisible();
  const favoriteButton = locator.getByRole('button', { name: 'Favorite', exact: true });
  await expect(favoriteButton).toBeDisabled();
  releaseFavoriteHydration();
  await expect(favoriteButton).toBeEnabled();
  await favoriteButton.click();
  await expect(locator.getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(favoriteMutations).toEqual([`save:${favoriteTrack.id}`]);

  await page.reload();
  await expect(locator.getByRole('heading', { name: favoriteTrack.name })).toBeVisible();
  await locator.getByRole('button', { name: /Favorites \(1\)/ }).click();
  await expect(locator.getByRole('button', { name: new RegExp(favoriteTrack.name) })).toBeVisible();
  await expect(locator.getByRole('button', { name: new RegExp(otherTrack.name) })).toHaveCount(0);
  await locator.getByLabel('Search tracks').fill(otherTrack.name);
  await expect(locator.getByText('No tracks match those filters.')).toBeVisible();
  await locator.getByLabel('Search tracks').fill('');

  const expectedTrackLink = new URL('/', 'https://tracklab-bmx.onrender.com');
  expectedTrackLink.searchParams.set('locator', favoriteTrack.id);
  expectedTrackLink.hash = 'track-locator';
  await locator.getByRole('button', { name: 'Copy link' }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { copiedTrackLink?: string }).copiedTrackLink
  ))).toBe(expectedTrackLink.toString());

  for (const track of [otherTrack, favoriteTrack]) {
    await page.evaluate((trackId) => {
      const url = new URL('/', window.location.origin);
      url.searchParams.set('locator', trackId);
      url.hash = 'track-locator';
      window.history.replaceState(window.history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, track.id);
    await expect(locator.getByRole('heading', { name: track.name })).toBeVisible();
  }

  await locator.getByLabel('Search tracks').fill(favoriteTrack.name);
  await expect(locator.getByText('1 found', { exact: true })).toBeVisible();
  for (const viewport of [
    { width: 1280, height: 960, minimumMapHeight: 460, desktop: true },
    { width: 1024, height: 768, minimumMapHeight: 360, desktop: false },
    { width: 390, height: 844, minimumMapHeight: 360, desktop: false },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await locator.evaluate((element) => {
      const bounds = (selector: string) => {
        const match = element.querySelector<HTMLElement>(selector);
        if (!match) throw new Error(`Missing responsive locator element: ${selector}`);
        const box = match.getBoundingClientRect();
        return {
          bottom: box.bottom,
          height: box.height,
          left: box.left,
          right: box.right,
          top: box.top,
        };
      };
      const layout = element.querySelector<HTMLElement>('.public-locator-layout');
      const preview = element.querySelector<HTMLElement>('.public-locator-preview');
      if (!layout || !preview) throw new Error('Missing responsive locator shell');
      const previewBounds = preview.getBoundingClientRect();
      const controls = [...element.querySelectorAll<HTMLElement>(
        '.public-track-official-links a, .public-track-actions a, .public-track-actions button',
      )].map((control) => {
        const box = control.getBoundingClientRect();
        return {
          height: box.height,
          insidePreview: box.left >= previewBounds.left - 1 && box.right <= previewBounds.right + 1,
        };
      });
      return {
        actionGroupTops: [...element.querySelectorAll<HTMLElement>('.public-track-link-group')]
          .map((group) => Math.round(group.getBoundingClientRect().top)),
        details: bounds('.public-track-details'),
        documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        layoutHeight: layout.getBoundingClientRect().height,
        layoutFits: layout.scrollWidth <= layout.clientWidth + 1,
        map: bounds('.public-track-map'),
        preview: bounds('.public-locator-preview'),
        previewFits: preview.scrollWidth <= preview.clientWidth + 1,
        controls,
      };
    });
    expect(geometry.map.height).toBeGreaterThanOrEqual(viewport.minimumMapHeight);
    expect(geometry.documentFits).toBe(true);
    expect(geometry.layoutFits).toBe(true);
    expect(geometry.previewFits).toBe(true);
    expect(geometry.details.bottom).toBeLessThanOrEqual(geometry.preview.bottom + 1);
    expect(geometry.controls.every((control) => control.height >= 44 && control.insidePreview)).toBe(true);
    if (viewport.desktop) {
      expect(geometry.layoutHeight).toBeLessThanOrEqual(730);
      expect(new Set(geometry.actionGroupTops).size).toBe(1);
    }
  }

  await locator.getByRole('button', { name: 'Share with friend' }).click();
  const dialog = page.getByRole('dialog', { name: favoriteTrack.name });
  await expect(dialog.getByText('Explicit Friend')).toBeVisible();
  await expect(dialog.getByText('Official Default')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Close track sharing' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('link', { name: 'Preview the shareable track link' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close track sharing' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog.getByText(`${favoriteTrack.name} was shared with Explicit Friend.`)).toBeVisible();
  expect(shareMutations).toHaveLength(1);
  expect(shareMutations[0]).toMatchObject({
    recipientProfileId: 'explicit-friend-rider',
    trackId: favoriteTrack.id,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const controls = dialog.locator('button, input, a[href]');
  const heights = await controls.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().height)));
  expect(heights.every((height) => height >= 44)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await dialog.getByRole('button', { name: 'Close track sharing' }).click();

  await page.reload();
  await expect(locator.getByRole('heading', { name: favoriteTrack.name })).toBeVisible();
  await page.getByRole('button', { name: 'Open App', exact: true }).click();
  await expect(page.getByRole('button', { name: 'BMX Race Intervals', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/locator=/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'BMX Race Intervals', exact: true })).toBeVisible();
  await expect(locator).toHaveCount(0);

  await page.goto('/?locator=removed-track#track-locator');
  await expect(locator.getByText('This shared track is no longer listed in the TrackLab directory.')).toBeVisible();
  await expect(page).toHaveURL(/locator=removed-track/);
  await expect(locator.getByRole('heading', { name: favoriteTrack.name })).toHaveCount(0);

  await page.goto('/?locator=track%2Fprivate#track-locator');
  await expect(locator.getByText('This shared track is no longer listed in the TrackLab directory.')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('locator')).toBe('track/private');
  await expect(locator.getByRole('heading', { name: favoriteTrack.name })).toHaveCount(0);
});
