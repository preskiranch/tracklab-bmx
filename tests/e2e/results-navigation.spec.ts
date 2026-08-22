import { expect, test } from '@playwright/test';

test('Results opens quickly without remounting the race workspace', async ({ page }) => {
  const now = Date.now();
  const authUser = {
    id: 'results-navigation-racer',
    profileKey: 'user:results-navigation-racer',
    email: 'results-navigation@tracklab.test',
    name: 'Results Navigation Racer',
    admin: false,
    membership: { tier: 'racer', bikeSeats: 1, updatedAt: now },
  };

  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user: authUser }),
  }));
  await page.route('**/api/user-data*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      trackMappings: {},
      customRoutes: [],
      bikeProfiles: [],
      studioRiders: [],
      accountProfile: { updatedAt: now },
    }),
  }));
  await page.route('**/api/club-connect*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ memberships: [], ownedClub: null, canManageClub: false }),
  }));
  await page.route('**/api/friends**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/friends/privacy'
      ? { privacy: { discoverable: false, profile: { id: authUser.id, handle: 'results.navigation', displayName: authUser.name } } }
      : { items: [], nextCursor: null, total: 0, incomingTotal: 0, outgoingTotal: 0 };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/ghosts*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ghosts: [] }),
  }));
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());

  await page.goto('/');
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary' });
  const openApp = page.getByRole('button', { name: 'Open App' });
  await openApp.or(primaryNavigation).first().waitFor({ state: 'visible' });
  if (await openApp.isVisible()) await openApp.click();

  await primaryNavigation.getByRole('button', { name: 'Straight Sprint', exact: true }).click();
  await expect(page.locator('.analytics-panel')).toContainText(/sprint • Wattbike Air 1/);
  await primaryNavigation.getByRole('button', { name: 'My Profile', exact: true }).click();
  await expect(page.locator('.account-profile-view')).toBeVisible();
  await expect(page.locator('.google-map-layer')).toHaveCount(0);

  await page.evaluate(() => {
    const testWindow = window as typeof window & { __tracklabMapMountCount?: number };
    testWindow.__tracklabMapMountCount = 0;
    new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches('.google-map-layer') || node.querySelector('.google-map-layer')) {
          testWindow.__tracklabMapMountCount = (testWindow.__tracklabMapMountCount ?? 0) + 1;
        }
      }));
    }).observe(document.body, { childList: true, subtree: true });
  });

  const startedAt = Date.now();
  await primaryNavigation.getByRole('button', { name: 'Results', exact: true }).click();
  const analytics = page.locator('.analytics-panel');
  await expect(analytics).toBeVisible({ timeout: 750 });
  expect(Date.now() - startedAt).toBeLessThan(750);
  await expect(page.getByRole('heading', { name: 'Post-race analysis' })).toBeVisible();
  await expect(analytics).toContainText(/sprint • Wattbike Air 1/);
  await expect(page.locator('.earth-panel, .control-panel, .multiplayer-panel')).toHaveCount(0);
  await expect(page.locator('.sidebar-workflow')).toHaveCount(0);
  expect(await page.evaluate(() => (
    (window as typeof window & { __tracklabMapMountCount?: number }).__tracklabMapMountCount ?? 0
  ))).toBe(0);
});
