import { expect, test, type Page } from '@playwright/test';

const iphonePortrait = { width: 390, height: 844 };

async function mockSignedInRacer(page: Page) {
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
