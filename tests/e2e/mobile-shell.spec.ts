import { expect, test, type Page } from '@playwright/test';

const iphonePortrait = { width: 390, height: 844 };

async function mockSignedInRacer(page: Page, activeRecoveryEpisode: Record<string, unknown> | null = null) {
  const now = Date.now();
  const user = {
    id: 'mobile-shell-racer',
    profileKey: 'user:mobile-shell-racer',
    email: 'mobile-shell@tracklab.test',
    name: 'Mobile Shell Racer',
    admin: false,
    membership: { tier: 'racer', bikeSeats: 1, updatedAt: now },
  };

  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user }),
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
      ? { privacy: { discoverable: false, profile: { id: user.id, handle: 'mobile.shell', displayName: user.name } } }
      : { items: [], nextCursor: null, total: 0, incomingTotal: 0, outgoingTotal: 0 };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/ghosts*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ghosts: [] }),
  }));
  const recoveryAccountId = `recacct_${'a'.repeat(32)}`;
  let recoveryPreference = {
    mode: 'off',
    timerSeconds: 120,
    targetBpm: 115,
    minimumSeconds: 30,
    maximumSeconds: 600,
    updatedAt: now,
  };
  await page.route('**/api/recovery-alert/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/episodes/active')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ accountId: recoveryAccountId, episode: activeRecoveryEpisode }),
      });
      return;
    }
    if (path.endsWith('/preferences')) {
      if (request.method() === 'PATCH') {
        recoveryPreference = {
          ...recoveryPreference,
          ...request.postDataJSON(),
          updatedAt: Date.now(),
        };
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ accountId: recoveryAccountId, preference: recoveryPreference }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not mocked"}' });
  });
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());
}

async function openSignedInApp(page: Page) {
  const openApp = page.getByRole('button', { name: 'Open App' });
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary' });
  await openApp.or(primaryNavigation).first().waitFor({ state: 'visible', timeout: 15_000 });
  if (await openApp.isVisible()) await openApp.click();
  await expect(primaryNavigation).toBeVisible();
}

test('iPhone portrait shell is fixed-width with readable navigation and headers', async ({ page }) => {
  await page.setViewportSize(iphonePortrait);
  await mockSignedInRacer(page);
  await page.goto('/?track=oak-creek-bmx');
  await openSignedInApp(page);

  const layout = await page.evaluate(() => {
    const navigation = document.querySelector<HTMLElement>('.side-nav');
    const buttons = [...(navigation?.querySelectorAll<HTMLElement>(':scope > button') ?? [])];
    const buttonRows = new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    const firstButtonStyle = buttons[0] ? getComputedStyle(buttons[0]) : null;
    const selectorLabel = document.querySelector<HTMLElement>('.track-selectors span');
    const selector = document.querySelector<HTMLElement>('.track-selectors select');
    const readiness = document.querySelector<HTMLElement>('.race-readiness-strip');
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      shellFits: (document.querySelector<HTMLElement>('.platform-shell')?.scrollWidth ?? 1)
        <= (document.querySelector<HTMLElement>('.platform-shell')?.clientWidth ?? 0),
      navButtonCount: buttons.length,
      navRowCount: buttonRows.size,
      navFontSize: Number.parseFloat(firstButtonStyle?.fontSize ?? '0'),
      navFontWeight: Number.parseFloat(firstButtonStyle?.fontWeight ?? '0'),
      navButtonMinHeight: Math.min(...buttons.map((button) => button.getBoundingClientRect().height)),
      navPosition: navigation ? getComputedStyle(navigation).position : '',
      selectorLabelFontSize: Number.parseFloat(selectorLabel ? getComputedStyle(selectorLabel).fontSize : '0'),
      selectorFontSize: Number.parseFloat(selector ? getComputedStyle(selector).fontSize : '0'),
      selectorHeight: selector?.getBoundingClientRect().height ?? 0,
      readinessFits: readiness ? readiness.scrollWidth <= readiness.clientWidth : false,
    };
  });

  expect(layout.documentFits).toBe(true);
  expect(layout.shellFits).toBe(true);
  expect(layout.navButtonCount).toBe(10);
  expect(layout.navRowCount).toBe(3);
  expect(layout.navFontSize).toBeGreaterThanOrEqual(13);
  expect(layout.navFontWeight).toBeGreaterThanOrEqual(700);
  expect(layout.navButtonMinHeight).toBeGreaterThanOrEqual(58);
  expect(layout.navPosition).toBe('sticky');
  expect(layout.selectorLabelFontSize).toBeGreaterThanOrEqual(12);
  expect(layout.selectorFontSize).toBeGreaterThanOrEqual(16);
  expect(layout.selectorHeight).toBeGreaterThanOrEqual(44);
  expect(layout.readinessFits).toBe(true);

  await page.getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'My Profile', exact: true })
    .click();
  await expect(page.locator('.explore-topbar-heading')).toBeVisible();
  const topbarType = await page.locator('.explore-topbar-heading').evaluate((heading) => ({
    title: Number.parseFloat(getComputedStyle(heading.querySelector('strong')!).fontSize),
    detail: Number.parseFloat(getComputedStyle(heading.querySelector('small')!).fontSize),
  }));
  expect(topbarType.title).toBeGreaterThanOrEqual(18);
  expect(topbarType.detail).toBeGreaterThanOrEqual(13);

  await page.evaluate(() => window.scrollTo({ top: 900, left: 100 }));
  await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(0);
  const stickyTop = await page.locator('.side-nav').evaluate((navigation) => (
    navigation.getBoundingClientRect().top
  ));
  expect(stickyTop).toBeGreaterThanOrEqual(0);
});

test('Recovery Alert stays simple, readable, and available in all three sprint programs', async ({ page }) => {
  await page.setViewportSize(iphonePortrait);
  await mockSignedInRacer(page);
  let savedTimerSeconds: unknown;
  page.on('request', (request) => {
    if (request.method() !== 'PATCH' || !request.url().endsWith('/preferences')) return;
    savedTimerSeconds = (request.postDataJSON() as Record<string, unknown>).timerSeconds;
  });
  await page.goto('/?track=oak-creek-bmx');
  await openSignedInApp(page);

  const card = page.getByRole('region', { name: 'Recovery Alert' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Off', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Timer', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Heart Rate', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Smart', exact: true })).toBeVisible();

  await card.getByRole('button', { name: 'Timer', exact: true }).click();
  const recoveryMinutes = card.getByLabel('Recovery time in minutes', { exact: true });
  await expect(recoveryMinutes).toHaveAttribute('step', '1');
  await recoveryMinutes.fill('7');
  await card.getByRole('button', { name: 'Save Recovery Alert' }).click();
  await expect(card).toContainText('Saved for Race Intervals, Straight Sprint, and Get Pulled.');
  await expect.poll(() => savedTimerSeconds).toBe(420);

  const layout = await card.evaluate((element) => ({
    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    cardFits: element.scrollWidth <= element.clientWidth,
    smallestButton: Math.min(...[...element.querySelectorAll('button')]
      .map((button) => button.getBoundingClientRect().height)),
    titleSize: Number.parseFloat(getComputedStyle(element.querySelector('strong')!).fontSize),
  }));
  expect(layout.documentFits).toBe(true);
  expect(layout.cardFits).toBe(true);
  expect(layout.smallestButton).toBeGreaterThanOrEqual(44);
  expect(layout.titleSize).toBeGreaterThanOrEqual(17);

  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await navigation.getByRole('button', { name: 'Straight Sprint', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Recovery Alert' })).toContainText('Timer');
  await navigation.getByRole('button', { name: 'Get Pulled', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Recovery Alert' })).toContainText('Timer');

  await page.setViewportSize({ width: 1024, height: 768 });
  const ipadLayout = await page.getByRole('region', { name: 'Recovery Alert' }).evaluate((element) => ({
    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    cardFits: element.scrollWidth <= element.clientWidth,
    smallestButton: Math.min(...[...element.querySelectorAll('button')]
      .map((button) => button.getBoundingClientRect().height)),
  }));
  expect(ipadLayout.documentFits).toBe(true);
  expect(ipadLayout.cardFits).toBe(true);
  expect(ipadLayout.smallestButton).toBeGreaterThanOrEqual(44);
});

test('active Recovery Alert remains visible as a compact fullscreen cue', async ({ page }) => {
  const now = Date.now();
  await page.setViewportSize({ width: 844, height: 390 });
  await mockSignedInRacer(page, {
    id: 'recovery-fullscreen',
    activityType: 'bmx-race',
    sessionId: 'race-fullscreen',
    repetitionId: 'race-fullscreen-rider',
    mode: 'timer',
    state: 'recovering',
    startedAt: now - 10_000,
    notBeforeAt: now - 1_000,
    plannedReadyAt: now + 50_000,
    fallbackAt: now + 50_000,
    readyAt: null,
    targetBpm: null,
    reason: 'fixed-timer',
    explanation: 'Your fixed recovery time.',
    confidence: 'fixed',
    learningEpisodeCount: 0,
    alertedAt: null,
    alertTrigger: null,
    updatedAt: now,
  });
  await page.goto('/?track=oak-creek-bmx');
  await openSignedInApp(page);

  const card = page.getByRole('region', { name: 'Recovery Alert' });
  await expect(card).toContainText('Recovering');
  await page.locator('.platform-shell').evaluate((shell) => shell.classList.add('race-fullscreen'));
  await expect(card).toBeVisible();
  const raceLayout = await card.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      width: bounds.width,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      actionsHidden: getComputedStyle(element.querySelector('.recovery-alert-actions')!).display === 'none',
    };
  });
  expect(raceLayout.top).toBeGreaterThanOrEqual(0);
  expect(raceLayout.bottom).toBeLessThanOrEqual(raceLayout.viewportHeight);
  expect(raceLayout.width).toBeLessThan(raceLayout.viewportWidth);
  expect(raceLayout.actionsHidden).toBe(true);

  await page.locator('.platform-shell').evaluate((shell) => {
    shell.classList.remove('race-fullscreen');
    shell.classList.add('utility-fullscreen');
  });
  await expect(card).toBeVisible();
});

test('public track locator text remains legible in iPhone portrait', async ({ page }) => {
  await page.setViewportSize(iphonePortrait);
  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user: null }),
  }));
  await page.goto('/?locator=oak-creek-bmx');

  const locator = page.locator('#track-locator');
  await expect(locator).toBeVisible();
  const typography = await locator.evaluate((element) => {
    const fontSize = (selector: string) => {
      const match = element.querySelector<HTMLElement>(selector);
      return Number.parseFloat(match ? getComputedStyle(match).fontSize : '0');
    };
    return {
      label: fontSize('.public-locator-filters label > span'),
      select: fontSize('.public-locator-filters select'),
      resultName: fontSize('.public-track-results button strong'),
      resultLocation: fontSize('.public-track-results button span'),
      searchHeight: element.querySelector<HTMLElement>('.public-track-search > div')
        ?.getBoundingClientRect().height ?? 0,
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
  });

  expect(typography.label).toBeGreaterThanOrEqual(13);
  expect(typography.select).toBeGreaterThanOrEqual(16);
  expect(typography.resultName).toBeGreaterThanOrEqual(16);
  expect(typography.resultLocation).toBeGreaterThanOrEqual(14);
  expect(typography.searchHeight).toBeGreaterThanOrEqual(44);
  expect(typography.documentFits).toBe(true);
});
