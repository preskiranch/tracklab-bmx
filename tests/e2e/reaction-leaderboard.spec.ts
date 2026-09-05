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

async function mockReactionAccount(page: Page, canJoinLeaderboard = true) {
  const now = Date.now();
  const account = {
    id: 'private-reaction-account',
    profileKey: 'user:private-reaction-account',
    email: 'private-reaction-account@tracklab.test',
    name: 'Private Account Identity',
    admin: false,
    membership: { tier: 'spectator', bikeSeats: 1, updatedAt: now },
  };
  const state = {
    personalBestMs: 205,
    leaderboard: { joined: false, displayName: '' },
    canJoinLeaderboard,
  };
  const limits: number[] = [];
  const preferenceWrites: Array<{ joined: boolean; displayName?: string; expectedAccountId: string }> = [];
  const trainingWrites: string[] = [];
  const resultWrites: unknown[] = [];
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
    reactionTimeMs: 180 + index * 10,
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
  await page.route(/\/api\/reaction-test(?:\?.*)?$/, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(state),
  }));
  await page.route('**/api/reaction-test/leaderboard*', async (route) => {
    if (route.request().method() === 'PATCH') {
      const preference = route.request().postDataJSON() as typeof preferenceWrites[number];
      preferenceWrites.push(preference);
      state.leaderboard = {
        joined: preference.joined,
        displayName: preference.displayName ?? state.leaderboard.displayName,
      };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
      return;
    }
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('expectedAccountId')).toBe(account.id);
    const limit = Number(query.get('limit'));
    limits.push(limit);
    const entries = rows.map((row, index) => index === 2 && state.leaderboard.joined
      ? { ...row, displayName: state.leaderboard.displayName, reactionTimeMs: state.personalBestMs, isYou: true }
      : row).slice(0, limit);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entries }) });
  });
  await page.route('**/api/reaction-test/result', (route) => {
    resultWrites.push(route.request().postDataJSON());
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

test('reaction leaderboard defaults to Top 5 and publishes only an explicitly chosen display name', async ({ page }) => {
  const mock = await mockReactionAccount(page);
  const view = await openReactionTest(page);
  let dialog = await openLeaderboard(page, view);
  const size = dialog.getByLabel('Leaderboard size', { exact: true });
  await expect(size).toHaveValue('5');
  await expect(size.locator('option')).toHaveText(['Top 5', 'Top 10', 'Top 25', 'Top 50']);
  await expect(dialog.getByText('Gate Rider 05', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Gate Rider 06', { exact: true })).toHaveCount(0);
  expect(mock.limits).toEqual([5]);
  expect(mock.preferenceWrites).toEqual([]);
  await expect(dialog).not.toContainText(mock.account.name);
  await expect(dialog).not.toContainText(mock.account.email);
  await expect(dialog.getByLabel('Leaderboard display name', { exact: true })).toHaveValue('');

  for (const limit of [10, 25, 50]) {
    await size.selectOption(String(limit));
    await expect(dialog.getByText(`Gate Rider ${limit}`, { exact: true })).toBeAttached();
    await expect.poll(() => mock.limits.at(-1)).toBe(limit);
    if (limit < 50) await expect(dialog.getByText(`Gate Rider ${limit + 1}`, { exact: true })).toHaveCount(0);
  }
  await size.selectOption('5');
  await dialog.getByLabel('Leaderboard display name', { exact: true }).fill('Gate Flyer');
  await dialog.getByRole('button', { name: 'Join leaderboard', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Leave leaderboard', exact: true })).toBeVisible();
  await expect.poll(() => mock.preferenceWrites).toEqual([{
    joined: true, displayName: 'Gate Flyer', expectedAccountId: mock.account.id,
  }]);
  await expect(dialog.getByRole('rowheader', { name: 'Gate Flyer You', exact: true })).toBeVisible();
  await expect(dialog).not.toContainText(mock.account.name);
  await expect(dialog).not.toContainText(mock.account.email);
  expect(mock.trainingWrites).toEqual([]);
  expect(mock.resultWrites).toEqual([]);

  // Reloading exercises the account preference response, rather than only the
  // optimistic state after the join request.
  const reopenedView = await openReactionTest(page);
  dialog = await openLeaderboard(page, reopenedView);
  await expect(dialog.getByRole('button', { name: 'Leave leaderboard', exact: true })).toBeVisible();
  await expect(dialog.getByRole('rowheader', { name: 'Gate Flyer You', exact: true })).toBeVisible();
  await dialog.getByLabel('Leaderboard display name', { exact: true }).fill('Gate Flyer Updated');
  await dialog.getByRole('button', { name: 'Save display name', exact: true }).click();
  await expect(dialog.getByRole('rowheader', { name: 'Gate Flyer Updated You', exact: true })).toBeVisible();
  await expect.poll(() => mock.preferenceWrites[1]).toEqual({
    joined: true, displayName: 'Gate Flyer Updated', expectedAccountId: mock.account.id,
  });
  await dialog.getByRole('button', { name: 'Leave leaderboard', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Join leaderboard', exact: true })).toBeVisible();
  await expect.poll(() => mock.preferenceWrites.length).toBe(3);
  expect(mock.preferenceWrites[2]).toMatchObject({ joined: false, expectedAccountId: mock.account.id });
  await expect(dialog.getByRole('rowheader', { name: 'Gate Flyer Updated You', exact: true })).toHaveCount(0);
  expect(mock.state.personalBestMs).toBe(205);
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
          clearsSceneControls: ['.reaction-title', '.reaction-exit-action', '.reaction-tree'].every((selector) => {
            const other = view.querySelector(selector);
            return !other || !overlaps(other.getBoundingClientRect());
          }),
        };
      });
      expect(headerLayout).toEqual({ inViewport: true, clearsSceneControls: true });
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

test('reaction leaderboard prevents enrollment when the active context cannot join', async ({ page }) => {
  const mock = await mockReactionAccount(page, false);
  const view = await openReactionTest(page);
  const dialog = await openLeaderboard(page, view);
  await expect(dialog.getByRole('button', { name: 'Join leaderboard', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Leave leaderboard', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Leaderboard display name', { exact: true })).toHaveCount(0);
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
  await expect(dialog.getByRole('button', { name: 'Join leaderboard', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Leaderboard display name', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Leaderboard size', { exact: true }).selectOption('50');
  await expect(dialog.getByText('Gate Rider 50', { exact: true })).toBeAttached();
  expect(mock.preferenceWrites).toEqual([]);
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
