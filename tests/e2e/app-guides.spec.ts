import { expect, test, type Page } from '@playwright/test';

async function isolateGuideAccount(page: Page, signedIn = false) {
  const user = signedIn ? {
    id: 'guide-reader-fixture', profileKey: 'user:guide-reader-fixture',
    email: 'guide-reader@example.com', name: 'Guide Reader', admin: false,
    membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() },
  } : null;
  const errors: string[] = [];
  const mutations: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.context().routeWebSocket(/.*/, (socket) => socket.close());
  // Every API request is fulfilled locally, including background account work.
  // The guide test cannot create a real account, grant, or shared record.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (!['GET', 'HEAD'].includes(request.method())) mutations.push(path);
    let status = 200;
    let result: unknown = { ok: true };
    if (path === '/api/auth/me') result = { user };
    else if (path === '/api/beta-access') result = { beta: {
      id: 'guide-beta-fixture', active: true, bikeSeats: 4, revokedAt: null,
      expiresAt: Date.now() + 7_776_000_000,
    } };
    else if (path.startsWith('/api/user-data')) result = {
      trackMappings: {}, customRoutes: [], bikeProfiles: [], studioRiders: [],
      accountProfile: { updatedAt: Date.now() },
    };
    else if (path === '/api/public-track-mappings') result = { trackMappings: {}, count: 0 };
    else if (path.startsWith('/api/club-connect')) result = { memberships: [], ownedClub: null, canManageClub: false };
    else if (path.startsWith('/api/friends')) result = path.endsWith('/privacy')
      ? { privacy: { discoverable: false, profile: { id: user?.id, handle: 'guide.reader', displayName: user?.name } } }
      : { items: [], nextCursor: null, total: 0, incomingTotal: 0, outgoingTotal: 0 };
    else if (path.startsWith('/api/ghosts')) result = { ghosts: [] };
    else if (path === '/api/commentary/config') result = { aiAvailable: false };
    else if (path === '/api/auth/websocket-ticket') {
      status = 401; result = { error: 'Guide fixture has no live socket.' };
    } else if (path.startsWith('/api/recovery-alert')) result = {
      accountId: `recacct_${'b'.repeat(32)}`, episode: null,
      preference: { mode: 'off', timerSeconds: 300, targetBpm: 115, minimumSeconds: 60, maximumSeconds: 600, updatedAt: Date.now() },
    };
    else if (path === '/api/bike-shops/hierarchy') result = {
      level: url.searchParams.has('region') ? 'city' : url.searchParams.has('countryCode') ? 'region' : 'country',
      items: [], attributions: [],
    };
    else if (path.startsWith('/api/bike-shops')) result = { shops: [], total: 0, attributions: [] };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());
  return { errors, mutations };
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => (
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth + 1
  ))).toBe(true);
}

const viewports = [
  { name: 'iPhone', width: 390, height: 844 },
  { name: 'iPad', width: 1024, height: 1366 },
  { name: 'desktop', width: 1440, height: 1000 },
];

for (const viewport of viewports) {
  test(`public guides support search, topics, and browser history on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = await isolateGuideAccount(page);
    await page.goto('/#app-guide');
    const guide = page.getByRole('region', { name: 'App Guide', exact: true });
    const nav = page.getByRole('navigation', { name: 'TrackLab home navigation' });
    await expect(guide).toBeVisible();
    await expect(nav.getByRole('button', { name: 'App Guide', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(guide.locator('.app-guide-section > h2').first()).toHaveText('Membership and Wattbike access');
    await expect(guide.getByText(/Public live multiplayer:/)).toContainText('Coming soon');
    const pairing = guide.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Pair directly with Bluetooth', exact: true }) });
    await expect(pairing.locator('ol > li')).toHaveCount(5);
    await expect(pairing).toContainText('Pair Wattbike');
    await expect(guide.locator('#guide-training')).toHaveText('Train your start, sprint, and power');
    await expect(guide.locator('#guide-explore-world')).toHaveText('Explore the World');
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`app-guide-${viewport.name}.png`) });

    if (viewport.width < 760) {
      const topics = guide.getByRole('combobox', { name: 'Jump to a topic' });
      await expect(topics).toBeVisible();
      await topics.selectOption('tracks-shops');
    } else {
      await guide.getByRole('navigation', { name: 'Guide topics' })
        .getByRole('button', { name: 'Find tracks and bike shops', exact: true }).click();
    }
    await expect(guide.locator('#guide-tracks-shops')).toBeFocused();
    await expect(guide.locator('#guide-tracks-shops')).toBeInViewport();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`guide-topic-${viewport.name}.png`) });

    const search = guide.getByRole('searchbox', { name: 'Search this guide' });
    await search.fill('25 miles');
    await expect(guide.getByRole('heading', { name: 'Go from a track to a shop, or a shop to a track', exact: true })).toBeVisible();
    await expect(guide.getByRole('article').filter({ hasText: 'closest three mapped bike shops within 25 miles' })).toContainText('BMX tracks within 50 miles');
    await expect(guide.locator('#guide-training')).toHaveCount(0);
    await search.fill('zzzz-no-such-guide-topic-987');
    await expect(guide.getByRole('heading', { name: /No topics match/ })).toBeVisible();
    await expect(guide.locator('.app-guide-section')).toHaveCount(0);
    await guide.getByRole('button', { name: 'Show all topics', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(guide.locator('#guide-training')).toBeAttached();
    await expectNoHorizontalOverflow(page);

    await guide.getByRole('button', { name: 'View Beta Testing Info', exact: true }).click();
    await expect(page).toHaveURL(/#beta-testing-info$/);
    const beta = page.getByRole('region', { name: 'Beta Testing Info guide', exact: true });
    await expect(beta).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Beta Testing Info', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(beta.locator('.app-guide-section > h2').first()).toHaveText('Start testing TrackLab');
    const invitation = beta.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Start your automatic beta access', exact: true }) });
    await expect(invitation.locator('ol > li')).toHaveCount(4);
    await expect(invitation).toContainText('automatically gives a new tester four simultaneous Wattbike connections');
    await expect(invitation).toContainText('TestFlight installation invitation are separate');
    await expect(beta.locator('#guide-tracks-shops')).toBeAttached();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`beta-guide-${viewport.name}.png`) });

    await page.goBack();
    await expect(page).toHaveURL(/#app-guide$/);
    await expect(guide).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/#beta-testing-info$/);
    await expect(beta).toBeVisible();
    await beta.getByRole('button', { name: 'View App Guide', exact: true }).click();
    await expect(guide).toBeVisible();
    expect(state.errors).toEqual([]);
    expect(state.mutations.filter((path) => /\/api\/(auth\/(register|login)|beta-access\/accept|admin\/beta-access)/.test(path))).toEqual([]);
  });
}

test('signed-out visitors can open both guide tabs and continue to either public directory', async ({ page }) => {
  const state = await isolateGuideAccount(page);
  await page.goto('/#beta-testing-info');
  await expect(page.getByRole('region', { name: 'Beta Testing Info guide', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'TrackLab home navigation' });
  await nav.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page).not.toHaveURL(/#beta-testing-info$/);
  await nav.getByRole('button', { name: 'App Guide', exact: true }).click();
  const guide = page.getByRole('region', { name: 'App Guide', exact: true });
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: 'Find BMX tracks', exact: true }).click();
  await expect(page).toHaveURL(/#track-locator$/);
  await expect(page.getByRole('heading', { name: 'Find a BMX racing track', exact: true })).toBeVisible();
  await page.goBack();
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: 'Find bike shops', exact: true }).click();
  await expect(page).toHaveURL(/#bike-shop-directory$/);
  await expect(page.getByRole('heading', { name: 'Find a bike shop near you', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Beta Testing Info', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Beta Testing Info guide', exact: true })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('guide introduction actions clear a search that hides their destination', async ({ page }) => {
  const state = await isolateGuideAccount(page);
  for (const mode of [
    { hash: 'app-guide', label: 'App Guide', action: 'Connect and ride', target: 'wattbike' },
    { hash: 'beta-testing-info', label: 'Beta Testing Info guide', action: 'Start beta testing', target: 'beta-start' },
  ]) {
    await page.goto(`/#${mode.hash}`);
    const guide = page.getByRole('region', { name: mode.label, exact: true });
    await expect(guide).toBeVisible();
    const search = guide.getByRole('searchbox', { name: 'Search this guide' });
    await search.fill('zzzz-no-such-guide-topic-987');
    await expect(guide.locator(`#guide-${mode.target}`)).toHaveCount(0);
    await guide.getByRole('button', { name: mode.action, exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(guide.locator(`#guide-${mode.target}`)).toBeFocused();
    await expect(guide.locator(`#guide-${mode.target}`)).toBeInViewport();
    await search.fill('25 miles');
    await guide.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(guide.locator(`#guide-${mode.target}`)).toBeAttached();
  }
  expect(state.errors).toEqual([]);
});

test('signed-in riders reach both guides through More and the beta access panel', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await isolateGuideAccount(page, true);
  await page.goto('/');
  const enter = async () => {
    const openApp = page.getByRole('button', { name: 'Open App', exact: true });
    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    await expect(openApp.or(primaryNav).first()).toBeVisible();
    if (await openApp.isVisible()) await openApp.click();
    await expect(primaryNav).toBeVisible();
  };
  const openMoreItem = async (name: string) => {
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await nav.getByRole('button', { name: 'More', exact: true }).click();
    await nav.getByRole('button', { name, exact: true }).click();
  };
  await enter();
  await openMoreItem('App Guide');
  await expect(page).toHaveURL(/#app-guide$/);
  await expect(page.getByRole('region', { name: 'App Guide', exact: true })).toBeVisible();
  await enter();
  await openMoreItem('Beta Testing Info');
  await expect(page).toHaveURL(/#beta-testing-info$/);
  await expect(page.getByRole('region', { name: 'Beta Testing Info guide', exact: true })).toBeVisible();
  await enter();
  await openMoreItem('Beta Testing');
  const panel = page.locator('#beta-testing');
  await expect(panel.getByText('4 Wattbike connections included', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Read Beta Testing Info', exact: true }).click();
  await expect(page).toHaveURL(/#beta-testing-info$/);
  await expect(page.getByRole('region', { name: 'Beta Testing Info guide', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('beta-info-from-signed-in-phone.png') });
  expect(state.errors).toEqual([]);
  expect(state.mutations.filter((path) => path.startsWith('/api/beta-access/') || path.startsWith('/api/admin/beta-access'))).toEqual([]);
});
