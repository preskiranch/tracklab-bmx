import { expect, test, type Locator, type Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), 'The reaction leaderboard must not raise browser runtime errors.').toEqual([]);
});

type ReactionResultWrite = {
  result: { reactionTimeMs: number | null; valid: boolean; falseStart: boolean };
  expectedAccountId: string;
};

async function mockReactionAccount(page: Page, options: {
  canJoinLeaderboard?: boolean;
  personalBestMs?: number | null;
  joined?: boolean;
  hidden?: boolean;
  tier?: 'spectator' | 'racer';
  resultGate?: Promise<void>;
} = {}) {
  const now = Date.now();
  const account = {
    id: 'private-reaction-account',
    profileKey: 'user:private-reaction-account',
    email: 'private-reaction-account@tracklab.test',
    name: 'Current Account Rider',
    admin: false,
    membership: { tier: options.tier ?? 'spectator', bikeSeats: 1, updatedAt: now },
  };
  const state = {
    personalBestMs: options.personalBestMs === undefined ? 205 : options.personalBestMs,
    leaderboard: { joined: options.joined ?? false, hidden: options.hidden ?? false, displayName: account.name },
    canJoinLeaderboard: options.canJoinLeaderboard ?? true,
  };
  const limits: number[] = [];
  const preferenceWrites: Array<{ joined: boolean; displayName?: string; expectedAccountId: string }> = [];
  const trainingWrites: string[] = [];
  const resultWrites: ReactionResultWrite[] = [];
  let userData: Record<string, unknown> = {
    trackMappings: {},
    customRoutes: [],
    bikeProfiles: [],
    studioRiders: [],
    accountProfile: { personalRecords: { reactionTestBestMs: state.personalBestMs }, updatedAt: now },
  };
  const rows = Array.from({ length: 50 }, (_, index) => ({
    rank: index + 1,
    displayName: index === 0 ? 'Championship Gate Specialist' : `Gate Rider ${String(index + 1).padStart(2, '0')}`,
    reactionTimeMs: 180 + index * 50,
    isYou: false,
  }));

  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user: account }),
  }));
  await page.route('**/api/user-data*', (route) => {
    if (route.request().method() === 'PATCH') {
      userData = { ...userData, ...route.request().postDataJSON() };
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(userData) });
  });
  await page.route(/\/api\/reaction-test(?:\?.*)?$/, (route) => {
    expect(new URL(route.request().url()).searchParams.get('expectedAccountId')).toBe(account.id);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
  });
  await page.route('**/api/reaction-test/leaderboard*', async (route) => {
    if (route.request().method() === 'PATCH') {
      const preference = route.request().postDataJSON() as typeof preferenceWrites[number];
      preferenceWrites.push(preference);
      state.leaderboard = {
        joined: preference.joined,
        hidden: !preference.joined,
        displayName: account.name,
      };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
      return;
    }
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('expectedAccountId')).toBe(account.id);
    const limit = Number(query.get('limit'));
    limits.push(limit);
    const accountEntry = state.leaderboard.joined && state.personalBestMs != null
      ? [{ rank: 0, displayName: account.name, reactionTimeMs: state.personalBestMs, isYou: true }] : [];
    const entries = [...rows, ...accountEntry].sort((left, right) => left.reactionTimeMs - right.reactionTimeMs)
      .slice(0, limit).map((entry, index) => ({ ...entry, rank: index + 1 }));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entries }) });
  });
  await page.route('**/api/reaction-test/result', async (route) => {
    const payload = route.request().postDataJSON() as ReactionResultWrite;
    expect(payload.expectedAccountId).toBe(account.id);
    resultWrites.push(payload);
    await options.resultGate;
    const result = payload.result;
    if (result.valid && !result.falseStart && result.reactionTimeMs != null && result.reactionTimeMs > 0) {
      state.personalBestMs = Math.min(state.personalBestMs ?? Infinity, result.reactionTimeMs);
      if (state.canJoinLeaderboard && !state.leaderboard.hidden) state.leaderboard.joined = true;
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
  });
  await page.route('**/api/training-sessions*', (route) => {
    if (route.request().method() === 'POST') trainingWrites.push(route.request().postData() ?? '');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessions: [] }) });
  });
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());

  return { account, state, limits, preferenceWrites, trainingWrites, resultWrites };
}

async function openReactionTest(page: Page) {
  await page.goto('/');
  const openApp = page.getByRole('button', { name: 'Open App', exact: true });
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await openApp.or(navigation).first().waitFor({ state: 'visible' });
  if (await openApp.isVisible()) await openApp.click();
  await page.getByRole('button', { name: 'Reaction Test', exact: true }).click();
  const view = page.getByLabel('Reaction Test', { exact: true });
  await expect(view).toBeVisible();
  return view;
}

async function openLeaderboard(page: Page, view: Locator) {
  await view.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reaction time leaderboard', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Championship Gate Specialist', { exact: true })).toBeVisible();
  return dialog;
}

test('reaction leaderboard defaults to Top 5 and shows the account name without an enrollment form', async ({ page }) => {
  const mock = await mockReactionAccount(page);
  const view = await openReactionTest(page);
  const dialog = await openLeaderboard(page, view);
  const size = dialog.getByLabel('Leaderboard size', { exact: true });
  await expect(size).toHaveValue('5');
  await expect(size.locator('option')).toHaveText(['Top 5', 'Top 10', 'Top 25', 'Top 50']);
  await expect(dialog.getByText('Gate Rider 05', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Gate Rider 06', { exact: true })).toHaveCount(0);
  expect(mock.limits).toEqual([5]);
  expect(mock.preferenceWrites).toEqual([]);
  await expect(dialog.getByRole('heading', { name: 'Your leaderboard time', exact: true })).toBeVisible();
  await expect(dialog).toContainText(mock.account.name);
  await expect(dialog).not.toContainText(mock.account.email);
  await expect(dialog.getByLabel('Leaderboard display name', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Join leaderboard', exact: true })).toHaveCount(0);
  await expect(dialog.locator('form')).toHaveCount(0);
  await expect(dialog).toContainText(/automatically/i);

  for (const limit of [10, 25, 50]) {
    await size.selectOption(String(limit));
    await expect(dialog.getByText(`Gate Rider ${limit}`, { exact: true })).toBeAttached();
    await expect.poll(() => mock.limits.at(-1)).toBe(limit);
    if (limit < 50) await expect(dialog.getByText(`Gate Rider ${limit + 1}`, { exact: true })).toHaveCount(0);
  }
  expect(mock.state.leaderboard.joined).toBe(false);
  expect(mock.preferenceWrites).toEqual([]);
  expect(mock.trainingWrites).toEqual([]);
  expect(mock.resultWrites).toEqual([]);
});

async function preparePredictableCadence(page: Page) {
  await page.addInitScript(() => {
    const timingWindow = window as typeof window & { __reactionFirstRedAt?: number };
    window.addEventListener('tracklab-start-gate-tone', (event) => {
      if ((event as CustomEvent<{ kind?: string }>).detail?.kind === 'uci-red'
        && timingWindow.__reactionFirstRedAt === undefined) {
        timingWindow.__reactionFirstRedAt = performance.now();
      }
    });
    const original = Crypto.prototype.getRandomValues;
    Crypto.prototype.getRandomValues = function (array) {
      if (array instanceof Uint32Array && array.length === 1) {
        array[0] = 0;
        return array;
      }
      return original.call(this, array);
    };
  });
}

async function recordValidRun(page: Page, view: Locator, reactionDelayMs: number) {
  const retry = view.getByRole('button', { name: 'Try Again', exact: true });
  if (await retry.isVisible()) await retry.click();
  await page.evaluate(() => {
    delete (window as typeof window & { __reactionFirstRedAt?: number }).__reactionFirstRedAt;
  });
  await view.getByRole('button', { name: 'Start Reaction Test', exact: true }).click();
  await page.waitForFunction((delay) => {
    const firstRedAt = (window as typeof window & { __reactionFirstRedAt?: number }).__reactionFirstRedAt;
    return firstRedAt !== undefined && performance.now() - firstRedAt >= delay;
  }, reactionDelayMs);
  await view.locator('.reaction-race-surface').click({ position: { x: 500, y: 300 } });
  await expect(view.locator('.reaction-result-card')).toBeVisible();
  await expect(view.getByText('TOO EARLY / FALSE START', { exact: true })).toHaveCount(0);
  await expect(retry).toBeVisible();
}

for (const tier of ['racer', 'spectator'] as const) {
  test(`${tier} account automatically posts its best valid run under its existing name`, async ({ page }) => {
    test.setTimeout(90_000);
    const mock = await mockReactionAccount(page, { tier, personalBestMs: null });
    await preparePredictableCadence(page);
    const view = await openReactionTest(page);
    let bestMs = Infinity;
    for (const [index, delay] of [900, 300, 1_500].entries()) {
      await recordValidRun(page, view, delay);
      await expect.poll(() => mock.resultWrites.length).toBe(index + 1);
      const result = mock.resultWrites[index].result;
      expect(result).toMatchObject({ valid: true, falseStart: false });
      const milliseconds = result.reactionTimeMs!;
      expect(milliseconds).toBeGreaterThan(0);
      if (index === 1) expect(milliseconds).toBeLessThan(bestMs);
      if (index === 2) expect(milliseconds).toBeGreaterThan(bestMs);
      bestMs = Math.min(bestMs, milliseconds);

      const dialog = await openLeaderboard(page, view);
      await dialog.getByLabel('Leaderboard size', { exact: true }).selectOption('50');
      const ownRow = dialog.locator('tbody tr.is-you');
      await expect(ownRow).toHaveCount(1);
      await expect(ownRow.getByRole('rowheader')).toHaveText(`${mock.account.name} You`);
      await expect(ownRow.getByRole('cell').last()).toHaveText(`${(bestMs / 1_000).toFixed(2)} sec`);
      await expect(dialog.getByRole('button', { name: 'Hide my time', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Join leaderboard', exact: true })).toHaveCount(0);
      await expect(dialog.getByLabel('Leaderboard display name', { exact: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Close leaderboard', exact: true }).click();
      expect(mock.state.personalBestMs).toBe(bestMs);
      expect(mock.state.leaderboard).toEqual({ joined: true, hidden: false, displayName: mock.account.name });
      expect(mock.preferenceWrites).toEqual([]);
      expect(mock.trainingWrites).toEqual([]);
    }

    const reopenedView = await openReactionTest(page);
    const dialog = await openLeaderboard(page, reopenedView);
    await dialog.getByLabel('Leaderboard size', { exact: true }).selectOption('50');
    await expect(dialog.locator('tbody tr.is-you')).toHaveCount(1);
    await expect(dialog.locator('tbody tr.is-you')).toContainText(`${(bestMs / 1_000).toFixed(2)} sec`);
    expect(mock.preferenceWrites).toEqual([]);
  });
}

test('an open leaderboard refreshes automatically when a delayed result finishes saving', async ({ page }) => {
  let releaseResult!: () => void;
  const resultGate = new Promise<void>((resolve) => { releaseResult = resolve; });
  const mock = await mockReactionAccount(page, { tier: 'racer', personalBestMs: null, resultGate });
  await preparePredictableCadence(page);
  try {
    const view = await openReactionTest(page);
    await recordValidRun(page, view, 300);
    await expect.poll(() => mock.resultWrites.length).toBe(1);
    expect(mock.state.personalBestMs).toBeNull();
    const dialog = await openLeaderboard(page, view);
    await dialog.getByLabel('Leaderboard size', { exact: true }).selectOption('50');
    await expect(dialog.getByText('Gate Rider 50', { exact: true })).toBeAttached();
    await expect(dialog.locator('tbody tr.is-you')).toHaveCount(0);

    releaseResult();
    await expect(dialog.locator('tbody tr.is-you')).toHaveCount(1);
    await expect(dialog.locator('tbody tr.is-you')).toContainText(mock.account.name);
    await expect(dialog.locator('tbody tr.is-you')).toContainText(`${(mock.resultWrites[0].result.reactionTimeMs! / 1_000).toFixed(2)} sec`);
    await expect(dialog.getByRole('button', { name: 'Hide my time', exact: true })).toBeVisible();
    expect(mock.preferenceWrites).toEqual([]);
    expect(mock.trainingWrites).toEqual([]);
  } finally {
    releaseResult();
  }
});

test('hiding a leaderboard time persists across reload and a later valid run until shown again', async ({ page }) => {
  test.setTimeout(60_000);
  const mock = await mockReactionAccount(page, { joined: true, personalBestMs: 2_000 });
  await preparePredictableCadence(page);
  let view = await openReactionTest(page);
  let dialog = await openLeaderboard(page, view);
  await dialog.getByLabel('Leaderboard size', { exact: true }).selectOption('50');
  await expect(dialog.locator('tbody tr.is-you')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Hide my time', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Show my time', exact: true })).toBeVisible();
  await expect(dialog.locator('tbody tr.is-you')).toHaveCount(0);
  expect(mock.preferenceWrites).toMatchObject([{ joined: false, expectedAccountId: mock.account.id }]);

  view = await openReactionTest(page);
  dialog = await openLeaderboard(page, view);
  await expect(dialog.getByRole('button', { name: 'Show my time', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close leaderboard', exact: true }).click();
  await recordValidRun(page, view, 300);
  await expect.poll(() => mock.resultWrites.length).toBe(1);
  expect(mock.state.personalBestMs).toBeLessThan(2_000);
  expect(mock.state.leaderboard).toMatchObject({ joined: false, hidden: true });
  dialog = await openLeaderboard(page, view);
  await expect(dialog.getByRole('button', { name: 'Show my time', exact: true })).toBeVisible();
  await expect(dialog.locator('tbody tr.is-you')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Show my time', exact: true }).click();
  await dialog.getByLabel('Leaderboard size', { exact: true }).selectOption('50');
  await expect(dialog.locator('tbody tr.is-you')).toHaveCount(1);
  await expect(dialog.getByRole('rowheader', { name: `${mock.account.name} You`, exact: true })).toBeAttached();
  expect(mock.preferenceWrites).toMatchObject([
    { joined: false, expectedAccountId: mock.account.id },
    { joined: true, expectedAccountId: mock.account.id },
  ]);
  expect(mock.trainingWrites).toEqual([]);
});

test('reaction leaderboard stays contained without overlapping controls on phones and tablets', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await mockReactionAccount(page);
  const view = await openReactionTest(page);
  const viewports = [
    { label: 'compact-phone-portrait', width: 320, height: 568 },
    { label: 'compact-phone-landscape', width: 568, height: 320 },
    { label: 'phone-portrait', width: 390, height: 844 },
    { label: 'phone-landscape', width: 844, height: 390 },
    { label: 'tablet-portrait', width: 820, height: 1180 },
    { label: 'tablet-landscape', width: 1180, height: 820 },
  ];
  for (const viewport of viewports) {
    await test.step(viewport.label, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const safeArea = viewport.width > viewport.height
        ? { top: 0, right: 59, bottom: 21, left: 59 }
        : { top: 59, right: 0, bottom: 34, left: 0 };
      await view.evaluate((element, insets) => {
        for (const [edge, value] of Object.entries(insets)) {
          (element as HTMLElement).style.setProperty(`--reaction-safe-${edge}`, `${value}px`);
        }
      }, safeArea);
      const leaderboardButton = view.getByRole('button', { name: 'Leaderboard', exact: true });
      await expect(leaderboardButton).toBeVisible();
      const headerLayout = await leaderboardButton.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const view = button.closest('.reaction-test-view')!;
        const overlaps = (other: DOMRect) => rect.left < other.right - 1 && rect.right > other.left + 1
          && rect.top < other.bottom - 1 && rect.bottom > other.top + 1;
        return {
          inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          lightLabelsReadable: [...view.querySelectorAll<HTMLElement>('.reaction-light small')].every((label) => (
            Number.parseFloat(getComputedStyle(label).fontSize) >= 14 && label.scrollWidth <= label.clientWidth + 1
          )),
          personalRecordReadable: Number.parseFloat(getComputedStyle(view.querySelector('.reaction-pr-badge span')!).fontSize) >= 16,
          clearsSceneControls: ['.reaction-title', '.reaction-exit-action', '.reaction-tree'].every((selector) => {
            const other = view.querySelector(selector);
            return !other || !overlaps(other.getBoundingClientRect());
          }),
        };
      });
      expect(headerLayout).toEqual({ inViewport: true, clearsSceneControls: true, lightLabelsReadable: true, personalRecordReadable: true });
      await page.screenshot({ fullPage: false, path: testInfo.outputPath(`reaction-readable-${viewport.label}.png`) });
      const dialog = await openLeaderboard(page, view);
      for (const limit of [5, 50]) {
        await dialog.getByLabel('Leaderboard size', { exact: true }).selectOption(String(limit));
        await expect(dialog.getByText(`Gate Rider ${String(limit).padStart(2, '0')}`, { exact: true })).toBeAttached();
        const layout = await dialog.evaluate((element, insets) => {
          const rect = element.getBoundingClientRect();
          const controls = [...element.querySelectorAll<HTMLElement>('button, input, select')]
            .filter((control) => control.getBoundingClientRect().width > 0);
          const overlaps = (left: DOMRect, right: DOMRect) => left.left < right.right - 1
            && left.right > right.left + 1 && left.top < right.bottom - 1 && left.bottom > right.top + 1;
          return {
            withinViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
            withinSafeArea: rect.left >= insets.left - 1 && rect.top >= insets.top - 1
              && rect.right <= innerWidth - insets.right + 1 && rect.bottom <= innerHeight - insets.bottom + 1,
            noHorizontalOverflow: element.scrollWidth <= element.clientWidth + 1
              && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
            controlsFitWidth: controls.every((control) => {
              const controlRect = control.getBoundingClientRect();
              return controlRect.left >= rect.left - 1 && controlRect.right <= rect.right + 1
                && control.scrollWidth <= control.clientWidth + 1;
            }),
            controlsClear: controls.every((control, index) => controls.slice(index + 1)
              .every((other) => !overlaps(control.getBoundingClientRect(), other.getBoundingClientRect()))),
          };
        }, safeArea);
        expect(layout).toEqual({ withinViewport: true, withinSafeArea: true, noHorizontalOverflow: true, controlsFitWidth: true, controlsClear: true });
        await page.screenshot({ fullPage: false, path: testInfo.outputPath(`reaction-leaderboard-top-${limit}-${viewport.label}.png`) });
      }
      await dialog.getByRole('button', { name: /close/i }).click();
      await expect(dialog).toBeHidden();
    });
  }
});

test('read-only leaderboard contexts keep the personal PR without automatic enrollment', async ({ page }) => {
  const mock = await mockReactionAccount(page, { canJoinLeaderboard: false, personalBestMs: 2_000 });
  await preparePredictableCadence(page);
  const view = await openReactionTest(page);
  await expect(view.getByText('PR · 2.00 sec', { exact: true })).toBeVisible();
  await recordValidRun(page, view, 300);
  await expect.poll(() => mock.resultWrites.length).toBe(1);
  expect(mock.state.personalBestMs).toBeLessThan(2_000);
  expect(mock.state.leaderboard.joined).toBe(false);
  const dialog = await openLeaderboard(page, view);
  await expect(dialog.getByRole('button', { name: 'Join leaderboard', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Leave leaderboard', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Hide my time', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Show my time', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Leaderboard display name', { exact: true })).toHaveCount(0);
  await expect(dialog.locator('tbody tr.is-you')).toHaveCount(0);
  await expect(dialog).not.toContainText(mock.account.name);
  await expect(dialog).not.toContainText(mock.account.email);
  expect(mock.preferenceWrites).toEqual([]);
  expect(mock.trainingWrites).toEqual([]);
});

test('the public reaction leaderboard remains available when the private profile session expires', async ({ page }) => {
  const mock = await mockReactionAccount(page);
  await page.route(/\/api\/reaction-test(?:\?.*)?$/, (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Please sign in to view your private reaction record.' }),
  }));
  const view = await openReactionTest(page);
  const dialog = await openLeaderboard(page, view);
  await expect(dialog.getByLabel('Leaderboard size', { exact: true })).toHaveValue('5');
  await expect(dialog.getByRole('alert')).toContainText('Your leaderboard settings could not load');
  await expect(dialog).not.toContainText('Sign in to your own account');
  await expect(dialog.getByRole('button', { name: 'Join leaderboard', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Hide my time', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Show my time', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Leaderboard display name', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Leaderboard size', { exact: true }).selectOption('50');
  await expect(dialog.getByText('Gate Rider 50', { exact: true })).toBeAttached();
  expect(mock.preferenceWrites).toEqual([]);
  expect(mock.trainingWrites).toEqual([]);
});

test('a paid account can retry a failed profile load without being told to sign in or reenroll', async ({ page }) => {
  const mock = await mockReactionAccount(page, { tier: 'racer', joined: true });
  let profileUnavailable = true;
  await page.route(/\/api\/reaction-test(?:\?.*)?$/, (route) => profileUnavailable
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable' }) })
    : route.fallback());
  const view = await openReactionTest(page);
  const dialog = await openLeaderboard(page, view);
  await expect(dialog.getByRole('alert')).toContainText('Your leaderboard settings could not load');
  await expect(dialog.getByRole('rowheader', { name: `${mock.account.name} You`, exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Join leaderboard', exact: true })).toHaveCount(0);
  await expect(dialog).not.toContainText('Sign in to your own account');

  profileUnavailable = false;
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Your leaderboard time', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Hide my time', exact: true })).toBeVisible();

  profileUnavailable = true;
  await dialog.getByLabel('Leaderboard size', { exact: true }).selectOption('10');
  await expect(dialog.getByRole('alert')).toContainText('Your leaderboard settings could not load');
  await expect(dialog.getByRole('heading', { name: 'Your leaderboard time', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Hide my time', exact: true })).toBeVisible();
  await expect(dialog).not.toContainText('Sign in to your own account');
  expect(mock.preferenceWrites).toEqual([]);
  expect(mock.resultWrites).toEqual([]);
  expect(mock.trainingWrites).toEqual([]);
});

test('leaderboard controls do not interrupt an active reaction attempt', async ({ page }) => {
  const mock = await mockReactionAccount(page);
  const view = await openReactionTest(page);
  await expect(view.getByRole('button', { name: 'Leaderboard', exact: true })).toBeEnabled();
  await view.getByRole('button', { name: 'Start Reaction Test', exact: true }).click();
  const leaderboardButton = view.getByRole('button', { name: 'Leaderboard', exact: true });
  await expect.poll(async () => !await leaderboardButton.isVisible() || !await leaderboardButton.isEnabled()).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Reaction time leaderboard', exact: true })).toHaveCount(0);
  await view.locator('.reaction-race-surface').click({ position: { x: 500, y: 300 } });
  await expect(view.getByText('TOO EARLY / FALSE START', { exact: true })).toBeVisible();
  await expect(leaderboardButton).toBeEnabled();
  expect(mock.preferenceWrites).toEqual([]);
  expect(mock.resultWrites).toEqual([]);
  expect(mock.trainingWrites).toEqual([]);
});
