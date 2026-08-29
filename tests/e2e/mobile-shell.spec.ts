import { expect, test, type Locator, type Page } from '@playwright/test';

const iphonePortrait = { width: 390, height: 844 };
const portraitViewports = [
  { label: 'iPhone SE', width: 320, height: 568 },
  { label: 'iPhone SE 3', width: 375, height: 667 },
  { label: 'iPhone mini', width: 375, height: 812 },
  { label: 'iPhone 16e', width: 390, height: 844 },
  { label: 'iPhone 15/16', width: 393, height: 852 },
  { label: 'iPhone 16 Pro', width: 402, height: 874 },
  { label: 'iPhone Plus', width: 430, height: 932 },
  { label: 'iPhone 16 Pro Max', width: 440, height: 956 },
  { label: 'iPad mini', width: 744, height: 1133 },
  { label: 'iPad', width: 768, height: 1024 },
  { label: 'iPad Air', width: 820, height: 1180 },
  { label: 'iPad Pro 11', width: 834, height: 1194 },
] as const;

async function mockSignedInRacer(
  page: Page,
  activeRecoveryEpisode: Record<string, unknown> | null = null,
  admin = false,
) {
  const now = Date.now();
  const user = {
    id: 'mobile-shell-racer',
    profileKey: 'user:mobile-shell-racer',
    email: 'mobile-shell@tracklab.test',
    name: 'Mobile Shell Racer',
    admin,
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
    timerSeconds: 300,
    targetBpm: 115,
    minimumSeconds: 60,
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

async function replaceMinuteValue(field: Locator, value: string) {
  await field.selectText();
  await field.press('Backspace');
  await expect(field).toHaveValue('');
  await field.pressSequentially(value);
  await expect(field).toHaveValue(value);
}

async function exerciseRecoveryMinuteField({
  card,
  field,
  label,
  initialMinutes,
  customMinutes,
  minimumMinutes,
  maximumMinutes,
}: {
  card: Locator;
  field: Locator;
  label: string;
  initialMinutes: number;
  customMinutes: number;
  minimumMinutes: number;
  maximumMinutes: number;
}) {
  const decrease = card.getByRole('button', {
    name: `Decrease ${label} by 1 minute`,
    exact: true,
  });
  const increase = card.getByRole('button', {
    name: `Increase ${label} by 1 minute`,
    exact: true,
  });
  const save = card.getByRole('button', { name: 'Save Recovery Alert' });

  await expect(field).toHaveValue(String(initialMinutes));
  await expect(field).toHaveAttribute('step', '1');
  await expect(decrease).toBeVisible();
  await expect(increase).toBeVisible();

  if (initialMinutes === minimumMinutes) {
    await expect(decrease).toBeDisabled();
    await increase.click();
    await expect(field).toHaveValue(String(initialMinutes + 1));
    await decrease.click();
  } else {
    await decrease.click();
    await expect(field).toHaveValue(String(initialMinutes - 1));
    await increase.click();
  }
  await expect(field).toHaveValue(String(initialMinutes));

  await field.press('ArrowUp');
  await expect(field).toHaveValue(String(initialMinutes + 1));
  await field.press('ArrowDown');
  await expect(field).toHaveValue(String(initialMinutes));

  await field.selectText();
  await field.press('Backspace');
  await expect(field).toHaveValue('');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(save).toBeDisabled();
  await field.pressSequentially(String(customMinutes));
  await expect(field).toHaveValue(String(customMinutes));
  await expect(field).toHaveAttribute('aria-invalid', 'false');
  if (customMinutes === maximumMinutes) await expect(increase).toBeDisabled();

  await replaceMinuteValue(field, String(initialMinutes));
}

test('iPhone portrait shell is fixed-width with readable navigation and headers', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    });
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await mockSignedInRacer(page);
  await page.goto('/?track=oak-creek-bmx');
  await openSignedInApp(page);
  await page.setViewportSize(iphonePortrait);

  const watchIndicator = page.locator('.side-nav .watch-connect-indicator');
  await expect(watchIndicator).toBeVisible();
  await watchIndicator.locator('.watch-connect-indicator-label').evaluate((label) => {
    label.textContent = 'Watch disconnected';
  });

  const layout = await page.evaluate(() => {
    const navigation = document.querySelector<HTMLElement>('.side-nav');
    const buttons = [...(navigation?.querySelectorAll<HTMLElement>(':scope > button') ?? [])];
    const navItems = [...(navigation?.querySelectorAll<HTMLElement>(
      ':scope > button, :scope > .watch-connect-indicator-slot .watch-connect-indicator',
    ) ?? [])];
    const buttonRows = new Set(navItems.map((button) => Math.round(button.getBoundingClientRect().top)));
    const firstButtonStyle = buttons[0] ? getComputedStyle(buttons[0]) : null;
    const watch = navigation?.querySelector<HTMLElement>('.watch-connect-indicator');
    const selectorLabel = document.querySelector<HTMLElement>('.track-selectors span');
    const selector = document.querySelector<HTMLElement>('.track-selectors select');
    const readiness = document.querySelector<HTMLElement>('.race-readiness-strip');
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      shellFits: (document.querySelector<HTMLElement>('.platform-shell')?.scrollWidth ?? 1)
        <= (document.querySelector<HTMLElement>('.platform-shell')?.clientWidth ?? 0),
      navButtonCount: buttons.length,
      navItemCount: navItems.length,
      navRowCount: buttonRows.size,
      navFontSize: Number.parseFloat(firstButtonStyle?.fontSize ?? '0'),
      navFontWeight: Number.parseFloat(firstButtonStyle?.fontWeight ?? '0'),
      navButtonMinHeight: Math.min(...buttons.map((button) => button.getBoundingClientRect().height)),
      navPosition: navigation ? getComputedStyle(navigation).position : '',
      watchFits: Boolean(watch && watch.scrollWidth <= watch.clientWidth + 1),
      selectorLabelFontSize: Number.parseFloat(selectorLabel ? getComputedStyle(selectorLabel).fontSize : '0'),
      selectorFontSize: Number.parseFloat(selector ? getComputedStyle(selector).fontSize : '0'),
      selectorHeight: selector?.getBoundingClientRect().height ?? 0,
      readinessFits: readiness ? readiness.scrollWidth <= readiness.clientWidth : false,
    };
  });

  expect(layout.documentFits).toBe(true);
  expect(layout.shellFits).toBe(true);
  expect(layout.navButtonCount).toBe(10);
  expect(layout.navItemCount).toBe(11);
  expect(layout.navRowCount).toBe(3);
  expect(layout.navFontSize).toBeGreaterThanOrEqual(13);
  expect(layout.navFontWeight).toBeGreaterThanOrEqual(700);
  expect(layout.navButtonMinHeight).toBeGreaterThanOrEqual(58);
  expect(layout.navPosition).toBe('sticky');
  expect(layout.watchFits).toBe(true);
  expect(layout.selectorLabelFontSize).toBeGreaterThanOrEqual(12);
  expect(layout.selectorFontSize).toBeGreaterThanOrEqual(16);
  expect(layout.selectorHeight).toBeGreaterThanOrEqual(44);
  expect(layout.readinessFits).toBe(true);

  const containedSelectors = [
    '#root',
    '.platform-shell',
    '.side-nav',
    '.platform-main',
    '.platform-topbar',
    '.track-selectors',
    '.race-readiness-strip',
    '.recovery-alert-card',
    '.dashboard-grid',
    '.earth-panel',
    '.earth-header',
    '.earth-meta',
  ];
  for (const viewport of portraitViewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const containment = await page.evaluate((selectors) => {
      const viewportWidth = document.documentElement.clientWidth;
      const failures: string[] = [];
      for (const selector of selectors) {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) {
          failures.push(`${selector}: missing`);
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.left < -1 || rect.right > viewportWidth + 1) {
          failures.push(`${selector}: bounds ${rect.left.toFixed(1)}..${rect.right.toFixed(1)} / ${viewportWidth}`);
        }
        if (element.scrollWidth > element.clientWidth + 1) {
          failures.push(`${selector}: width ${element.scrollWidth}/${element.clientWidth}`);
        }
      }
      const nav = document.querySelector<HTMLElement>('.side-nav');
      const navItems = [...(nav?.querySelectorAll<HTMLElement>(
        ':scope > button, :scope > .watch-connect-indicator-slot .watch-connect-indicator',
      ) ?? [])];
      for (const [index, item] of navItems.entries()) {
        const rect = item.getBoundingClientRect();
        if (
          rect.left < -1
          || rect.right > viewportWidth + 1
          || item.scrollWidth > item.clientWidth + 1
        ) {
          failures.push(`nav item ${index}: bounds ${rect.left.toFixed(1)}..${rect.right.toFixed(1)}, width ${item.scrollWidth}/${item.clientWidth}`);
        }
      }
      const watchLabel = document.querySelector<HTMLElement>('.watch-connect-indicator-label');
      if (
        viewportWidth <= 720
        && watchLabel
        && watchLabel.scrollWidth > watchLabel.clientWidth + 1
      ) {
        failures.push(`watch label: width ${watchLabel.scrollWidth}/${watchLabel.clientWidth}`);
      }
      return {
        failures,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth,
      };
    }, containedSelectors);
    expect(containment.failures, viewport.label).toEqual([]);
    expect(containment.documentWidth, viewport.label).toBeLessThanOrEqual(containment.viewportWidth);
  }

  await page.setViewportSize(iphonePortrait);
  await page.mouse.wheel(600, 0);
  await page.evaluate(() => window.scrollTo({ top: 900, left: 1000 }));
  await expect.poll(() => page.evaluate(() => ({
    page: window.scrollX,
    navigation: document.querySelector<HTMLElement>('.side-nav')?.scrollLeft ?? -1,
    main: document.querySelector<HTMLElement>('.platform-main')?.scrollLeft ?? -1,
  }))).toEqual({ page: 0, navigation: 0, main: 0 });

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

test('iPhone activities cover portrait with a rotation guard and reveal the app in landscape', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    });
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await mockSignedInRacer(page, null, true);
  await page.goto('/?track=air-time-bmx');
  await openSignedInApp(page);

  const guard = page.getByRole('dialog', { name: 'Rotate your iPhone' });
  await expect(guard).toBeHidden();

  // Orientation enforcement starts with the live activity, not the dashboard,
  // so Watch Connect, settings, and the activity picker remain accessible.
  await page.setViewportSize(iphonePortrait);
  await expect(guard).toBeHidden();
  await expect(page.getByRole('button', { name: 'More', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('button', { name: /Demo/i }).first().click();
  const startAction = page.locator('.workflow-step.primary-action');
  await expect(startAction).toContainText('Start Demo Race');
  await startAction.click();
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
  await expect(guard).toBeHidden();
  await page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
  });

  await page.setViewportSize(iphonePortrait);
  await expect(guard).toBeVisible();
  await expect(guard).toContainText(
    'Activities play in landscape so the course and live metrics stay visible.',
  );
  const portraitGuardLayout = await guard.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      bottom: Math.round(bounds.bottom),
      height: Math.round(bounds.height),
      left: Math.round(bounds.left),
      position: style.position,
      right: Math.round(bounds.right),
      top: Math.round(bounds.top),
      width: Math.round(bounds.width),
      zIndex: Number(style.zIndex),
    };
  });
  expect(portraitGuardLayout).toEqual({
    bottom: iphonePortrait.height,
    height: iphonePortrait.height,
    left: 0,
    position: 'fixed',
    right: iphonePortrait.width,
    top: 0,
    width: iphonePortrait.width,
    zIndex: 2_147_483_647,
  });

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(guard).toBeHidden();
  await expect(page.locator('.earth-stage')).toBeVisible();
});

test('Recovery Alert stays simple, readable, and available in all three sprint programs', async ({ page }) => {
  await page.setViewportSize(iphonePortrait);
  await mockSignedInRacer(page);
  let savedTimerSeconds: unknown;
  let savedRecoveryPreference: Record<string, unknown> | undefined;
  let recoverySaveCount = 0;
  page.on('request', (request) => {
    if (request.method() !== 'PATCH' || !request.url().endsWith('/preferences')) return;
    savedRecoveryPreference = request.postDataJSON() as Record<string, unknown>;
    savedTimerSeconds = savedRecoveryPreference.timerSeconds;
    recoverySaveCount += 1;
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
  await recoveryMinutes.selectText();
  await recoveryMinutes.press('Backspace');
  await expect(recoveryMinutes).toHaveValue('');
  await expect(recoveryMinutes).toHaveAttribute('aria-invalid', 'true');
  await expect(card.getByRole('button', { name: 'Save Recovery Alert' })).toBeDisabled();
  await recoveryMinutes.blur();
  await expect(recoveryMinutes).toHaveValue('5');
  await expect(recoveryMinutes).toHaveAttribute('aria-invalid', 'false');
  expect(savedTimerSeconds).toBeUndefined();
  await recoveryMinutes.selectText();
  await recoveryMinutes.press('Backspace');
  await recoveryMinutes.pressSequentially('7');
  await expect(recoveryMinutes).toHaveAttribute('aria-invalid', 'false');
  await card.getByRole('button', { name: 'Save Recovery Alert' }).click();
  await expect(card).toContainText('Saved for Race Intervals, Straight Sprint, and Get Pulled.');
  await expect.poll(() => savedTimerSeconds).toBe(420);

  await page.setViewportSize({ width: 1024, height: 768 });
  await card.getByRole('button', { name: 'Heart Rate', exact: true }).click();
  const earliestAlert = card.getByLabel('Earliest alert in minutes', { exact: true });
  const recoverySaveButton = card.getByRole('button', { name: 'Save Recovery Alert' });
  await expect(earliestAlert).toHaveValue('1');
  await earliestAlert.selectText();
  await earliestAlert.press('Backspace');
  await expect(earliestAlert).toHaveValue('');
  await expect(earliestAlert).toHaveAttribute('aria-invalid', 'true');
  await expect(recoverySaveButton).toBeDisabled();
  await recoverySaveButton.click({ force: true });
  await expect(earliestAlert).toHaveValue('1');
  expect(recoverySaveCount).toBe(1);
  await earliestAlert.selectText();
  await earliestAlert.press('Backspace');
  await expect(earliestAlert).toHaveValue('');
  await earliestAlert.pressSequentially('7');
  await expect(earliestAlert).toHaveAttribute('aria-invalid', 'false');
  await recoverySaveButton.click();
  await expect.poll(() => savedRecoveryPreference?.minimumSeconds).toBe(420);
  expect(Number(savedRecoveryPreference?.maximumSeconds)).toBeGreaterThanOrEqual(420);

  await earliestAlert.selectText();
  await earliestAlert.press('Backspace');
  await earliestAlert.pressSequentially('99');
  await expect(earliestAlert).toHaveAttribute('aria-invalid', 'true');
  await expect(recoverySaveButton).toBeDisabled();
  await earliestAlert.press('Enter');
  await expect(earliestAlert).toHaveValue('9');
  expect(recoverySaveCount).toBe(2);
  await earliestAlert.selectText();
  await earliestAlert.press('Backspace');
  await earliestAlert.pressSequentially('7');
  await earliestAlert.selectText();
  await earliestAlert.press('Backspace');
  await expect(earliestAlert).toHaveValue('');
  const timerBackup = card.getByLabel('Timer backup in minutes', { exact: true });
  await timerBackup.evaluate((element) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '9');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(timerBackup).toHaveValue('9');
  await expect(earliestAlert).toHaveValue('');
  await expect(earliestAlert).toHaveAttribute('aria-invalid', 'true');
  await expect(recoverySaveButton).toBeDisabled();
  expect(recoverySaveCount).toBe(2);
  await earliestAlert.press('Enter');
  await expect(earliestAlert).toHaveValue('7');
  await expect(recoverySaveButton).toBeEnabled();

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
  await expect(page.getByRole('region', { name: 'Recovery Alert' })).toContainText('Heart Rate');
  await navigation.getByRole('button', { name: 'Get Pulled', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Recovery Alert' })).toContainText('Heart Rate');

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

test('all Recovery minute controls default safely and accept exact one-minute edits', async ({ page }) => {
  await page.setViewportSize(iphonePortrait);
  await mockSignedInRacer(page);
  let recoverySaveCount = 0;
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith('/preferences')) {
      recoverySaveCount += 1;
    }
  });
  await page.goto('/?track=oak-creek-bmx');
  await openSignedInApp(page);

  const card = page.getByRole('region', { name: 'Recovery Alert' });
  await card.getByRole('button', { name: 'Timer', exact: true }).click();
  const recoveryTime = card.getByLabel('Recovery time in minutes', { exact: true });
  await exerciseRecoveryMinuteField({
    card,
    field: recoveryTime,
    label: 'Recovery time',
    initialMinutes: 5,
    customMinutes: 12,
    minimumMinutes: 1,
    maximumMinutes: 30,
  });

  await card.getByRole('button', { name: 'Heart Rate', exact: true }).click();
  const heartRateBackup = card.getByLabel('Timer backup in minutes', { exact: true });
  const heartRateEarliest = card.getByLabel('Earliest alert in minutes', { exact: true });
  await expect(heartRateBackup).toHaveValue('10');
  await expect(heartRateEarliest).toHaveValue('1');
  await exerciseRecoveryMinuteField({
    card,
    field: heartRateBackup,
    label: 'Timer backup',
    initialMinutes: 10,
    customMinutes: 12,
    minimumMinutes: 1,
    maximumMinutes: 30,
  });
  await exerciseRecoveryMinuteField({
    card,
    field: heartRateEarliest,
    label: 'Earliest alert',
    initialMinutes: 1,
    customMinutes: 10,
    minimumMinutes: 1,
    maximumMinutes: 10,
  });

  await replaceMinuteValue(heartRateEarliest, '7');
  await replaceMinuteValue(heartRateBackup, '7');
  await expect(card.getByRole('button', {
    name: 'Decrease Timer backup by 1 minute',
    exact: true,
  })).toBeDisabled();
  await replaceMinuteValue(heartRateEarliest, '1');
  await replaceMinuteValue(heartRateBackup, '10');

  await card.getByRole('button', { name: 'Smart', exact: true }).click();
  const smartStarting = card.getByLabel('Starting recovery time in minutes', { exact: true });
  const smartEarliest = card.getByLabel('Earliest alert in minutes', { exact: true });
  const smartBackup = card.getByLabel('Timer backup in minutes', { exact: true });
  await expect(smartStarting).toHaveValue('5');
  await expect(smartEarliest).toHaveValue('1');
  await expect(smartBackup).toHaveValue('10');
  await exerciseRecoveryMinuteField({
    card,
    field: smartStarting,
    label: 'Starting recovery time',
    initialMinutes: 5,
    customMinutes: 12,
    minimumMinutes: 1,
    maximumMinutes: 30,
  });
  await replaceMinuteValue(smartBackup, '10');
  await exerciseRecoveryMinuteField({
    card,
    field: smartEarliest,
    label: 'Earliest alert',
    initialMinutes: 1,
    customMinutes: 10,
    minimumMinutes: 1,
    maximumMinutes: 10,
  });
  await exerciseRecoveryMinuteField({
    card,
    field: smartBackup,
    label: 'Timer backup',
    initialMinutes: 10,
    customMinutes: 12,
    minimumMinutes: 5,
    maximumMinutes: 30,
  });

  await replaceMinuteValue(smartBackup, '5');
  await card.getByRole('button', {
    name: 'Increase Starting recovery time by 1 minute',
    exact: true,
  }).click();
  await expect(smartStarting).toHaveValue('6');
  await expect(smartBackup).toHaveValue('6');
  await expect(card.getByRole('button', {
    name: 'Decrease Timer backup by 1 minute',
    exact: true,
  })).toBeDisabled();

  const layout = await card.evaluate((element) => ({
    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    cardFits: element.scrollWidth <= element.clientWidth,
    minuteButtons: [...element.querySelectorAll<HTMLElement>('.recovery-alert-minute-controls button')]
      .map((button) => button.getBoundingClientRect().height),
  }));
  expect(layout.documentFits).toBe(true);
  expect(layout.cardFits).toBe(true);
  expect(Math.min(...layout.minuteButtons)).toBeGreaterThanOrEqual(44);
  expect(recoverySaveCount).toBe(0);
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
