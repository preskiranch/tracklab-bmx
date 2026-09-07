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
  const isRetry = await retry.isVisible();
  await page.evaluate(() => {
    delete (window as typeof window & { __reactionFirstRedAt?: number }).__reactionFirstRedAt;
  });
  if (isRetry) await retry.click();
  else await view.getByRole('button', { name: 'Start Reaction Test', exact: true }).click();
  await page.waitForFunction((delay) => {
    const firstRedAt = (window as typeof window & { __reactionFirstRedAt?: number }).__reactionFirstRedAt;
    return firstRedAt !== undefined && performance.now() - firstRedAt >= delay;
  }, reactionDelayMs);
  await view.locator('.reaction-race-surface').click({ position: { x: 500, y: 300 } });
  await expect(view.locator('.reaction-result-card')).toBeVisible();
  await expect(view.getByText('TOO EARLY / FALSE START', { exact: true })).toHaveCount(0);
  await expect(retry).toBeVisible();
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`gate air sounds follow movement and keep the return quiet (${reducedMotion})`, async ({ page }) => {
    await mockReactionAccount(page);
    await preparePredictableCadence(page);
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      const soundWindow = window as typeof window & {
        __gateAirSounds?: Array<{ duration: number; peak: number }>;
      };
      soundWindow.__gateAirSounds = [];
      const originalStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        const duration = this.buffer?.duration ?? 0;
        if (Math.abs(duration - 1) < 0.001 || Math.abs(duration - 2) < 0.001) {
          const samples = this.buffer!.getChannelData(0);
          let peak = 0;
          for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
          soundWindow.__gateAirSounds!.push({ duration, peak });
        }
        return Reflect.apply(originalStart, this, args);
      };
    });
    const sounds = () => page.evaluate(() => (
      window as typeof window & { __gateAirSounds: Array<{ duration: number; peak: number }> }
    ).__gateAirSounds);
    const view = await openReactionTest(page);
    const gate = view.locator('.reaction-gate-layer');
    await expect(gate).toHaveAttribute('data-gate-progress', '0.000');
    expect(await sounds()).toEqual([]);

    await recordValidRun(page, view, 120);
    await expect(gate).toHaveAttribute('data-gate-progress', '1.000');
    await expect(gate.locator('[data-gate-photo-clip=mesh]')).toHaveCSS('opacity', '1');
    await expect(gate.locator('[data-gate-photo=reveal]')).toHaveCSS('opacity', '1');
    await expect(gate.locator('[data-gate-photo=mesh]')).toHaveJSProperty('naturalWidth', 1280);
    expect(await sounds()).toHaveLength(1);
    expect((await sounds())[0].duration).toBeCloseTo(1, 3);

    // Observe real geometry, not rounded progress: "0.000" can appear just
    // before the eased rise has actually reached its upright endpoint.
    const uprightQuad = await gate.getAttribute('data-gate-upright-quad');
    expect(uprightQuad).not.toBeNull();
    await gate.evaluate((element) => {
      const trace = { startedAt: 0, frames: [] as Array<{ elapsed: number; progress: number; settled: boolean; photoVisible: boolean }> };
      (window as typeof window & { __gateRaiseTrace?: typeof trace }).__gateRaiseTrace = trace;
      const originalQuad = element.getAttribute('data-gate-upright-quad');
      const record = () => {
        if (!trace.startedAt) return;
        const settled = element.querySelector('[data-gate-part="mesh"]')?.getAttribute('data-gate-quad') === originalQuad;
        trace.frames.push({
          elapsed: performance.now() - trace.startedAt,
          progress: Number(element.getAttribute('data-gate-progress')),
          settled,
          photoVisible: getComputedStyle(element.querySelector('[data-gate-photo-clip=mesh]')!).opacity === '1'
            && getComputedStyle(element.querySelector('[data-gate-photo=mesh]')!).transform.startsWith('matrix3d(')
            && (element.querySelector('[data-gate-photo=mesh]') as HTMLImageElement).naturalWidth === 1280,
        });
        if (settled) observer.disconnect();
      };
      const observer = new MutationObserver(record);
      observer.observe(element, { attributes: true, subtree: true, attributeFilter: ['data-gate-progress', 'data-gate-quad'] });
      const retry = element.closest('.reaction-test-view')!.querySelector<HTMLButtonElement>('.reaction-primary-action')!;
      retry.addEventListener('click', () => {
        trace.startedAt = performance.now();
        record();
      }, { once: true });
    });
    await view.getByRole('button', { name: 'Try Again', exact: true }).click();
    await expect(gate.locator('[data-gate-part="mesh"]')).toHaveAttribute('data-gate-quad', uprightQuad!);
    await expect(gate).toHaveAttribute('data-gate-progress', '0.000');
    const riseFrames = await page.evaluate(() => (
      window as typeof window & { __gateRaiseTrace: { frames: Array<{ elapsed: number; progress: number; settled: boolean; photoVisible: boolean }> } }
    ).__gateRaiseTrace.frames);
    const settledFrame = riseFrames.find((frame) => frame.settled);
    expect(settledFrame, 'The return must finish at the exact upright gate geometry.').toBeDefined();
    if (reducedMotion === 'no-preference') {
      expect(riseFrames.some((frame) => frame.elapsed >= 750 && frame.elapsed <= 1_250 && frame.progress > 0 && frame.progress < 1 && frame.photoVisible),
        'The gate must still be physically rising midway through its two-second return.').toBe(true);
      expect(settledFrame!.elapsed).toBeGreaterThanOrEqual(2_000);
      expect(settledFrame!.elapsed).toBeLessThan(2_500);
    } else {
      expect(riseFrames.every((frame) => frame.progress === 0 || frame.progress === 1),
        'Reduced motion must skip intermediate gate positions.').toBe(true);
      expect(settledFrame!.elapsed).toBeLessThan(500);
    }
    await expect(gate.locator('[data-gate-photo-clip=mesh]')).toHaveCSS('opacity', '0');
    await expect(gate.locator('[data-gate-photo=reveal]')).toHaveCSS('opacity', '0');
    const completed = await sounds();
    expect(completed).toHaveLength(2);
    expect(completed[1].duration).toBeCloseTo(2, 3);
    expect(completed[1].peak / completed[0].peak).toBeCloseTo(10 ** (-18 / 20), 3);

    // Automatic retry is already waiting for the red tone. A false start keeps the gate upright.
    await view.locator('.reaction-race-surface').click({ position: { x: 500, y: 300 } });
    await expect(view.getByText('TOO EARLY / FALSE START', { exact: true })).toBeVisible();
    await view.getByRole('button', { name: 'Try Again', exact: true }).click();
    await expect(gate).toHaveAttribute('data-gate-progress', '0.000');
    expect(await sounds()).toHaveLength(2);
  });
}

for (const interruption of ['suspend', 'close'] as const) {
  test(`gate return restores real audio after context ${interruption}`, async ({ page }) => {
    await mockReactionAccount(page);
    await preparePredictableCadence(page);
    await page.addInitScript(() => {
      // Chromium can decode the 48kHz WAV one frame short at a 44.1kHz output
      // rate. Exercise that real resampling path instead of relying on the
      // host's default audio device rate (48kHz on the development machine).
      const BrowserAudioContext = window.AudioContext;
      window.AudioContext = class extends BrowserAudioContext {
        constructor(options?: AudioContextOptions) { super({ ...options, sampleRate: 44_100 }); }
      };
      const probe = { context: null as AudioContext | null, signals: [] as Array<{ direction: 'drop' | 'raise'; duration: number; sourcePeak: number; peak: number; ended: boolean }> };
      (window as typeof window & { __gateSignal?: typeof probe }).__gateSignal = probe;
      const originalStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        const duration = this.buffer?.duration ?? 0;
        const direction = Math.abs(duration - 1) < 0.005 ? 'drop'
          : Math.abs(duration - 2) < 0.005 ? 'raise' : null;
        if (direction) {
          probe.context = this.context as AudioContext;
          const sourcePeak = this.buffer!.getChannelData(0).reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
          const signal = { direction, duration, sourcePeak, peak: 0, ended: false };
          probe.signals.push(signal);
          // Tap the real source graph; never replace source.start or the WAV.
          const analyser = this.context.createAnalyser();
          const silent = this.context.createGain();
          silent.gain.value = 0;
          this.connect(analyser);
          analyser.connect(silent);
          silent.connect(this.context.destination);
          const samples = new Float32Array(analyser.fftSize);
          const interval = window.setInterval(() => {
            analyser.getFloatTimeDomainData(samples);
            for (const sample of samples) signal.peak = Math.max(signal.peak, Math.abs(sample));
          }, 20);
          this.addEventListener('ended', () => {
            signal.ended = true;
            window.clearInterval(interval);
            analyser.disconnect();
            silent.disconnect();
          }, { once: true });
        }
        return Reflect.apply(originalStart, this, args);
      };
    });
    const view = await openReactionTest(page);
    await recordValidRun(page, view, 120);
    await page.waitForFunction(() => (window as typeof window & {
      __gateSignal: { signals: Array<{ direction: string; ended: boolean }> };
    }).__gateSignal.signals.some(signal => signal.direction === 'drop' && signal.ended));
    await page.evaluate(async action => {
      const context = (window as typeof window & { __gateSignal: { context: AudioContext } }).__gateSignal.context;
      await context[action]();
    }, interruption);
    await view.getByRole('button', { name: 'Try Again', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as typeof window & {
      __gateSignal: { signals: Array<{ direction: string; ended: boolean }> };
    }).__gateSignal.signals.find(signal => signal.direction === 'raise'))).toMatchObject({ direction: 'raise', ended: true });
    const returnSignal = await page.evaluate(() => (window as typeof window & {
      __gateSignal: { signals: Array<{ direction: string; duration: number; sourcePeak: number; peak: number }> };
    }).__gateSignal.signals.find(signal => signal.direction === 'raise')!);
    expect(returnSignal.duration).toBeCloseTo(2, 3);
    // Resampling can slightly increase sample peaks. Compare the real output
    // with its decoded source, while still requiring a quiet, nonzero return.
    expect(returnSignal.sourcePeak).toBeGreaterThan(0.025);
    expect(returnSignal.sourcePeak).toBeLessThan(0.05);
    expect(returnSignal.peak).toBeGreaterThan(returnSignal.sourcePeak * 0.8);
    expect(returnSignal.peak).toBeLessThanOrEqual(returnSignal.sourcePeak + 0.001);
    await expect(view.locator('.reaction-gate-layer')).toHaveAttribute('data-gate-progress', '0.000');
  });
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
    { label: 'compact-phone-portrait', width: 320, height: 568, safeArea: { top: 20, right: 0, bottom: 0, left: 0 } },
    { label: 'compact-phone-landscape', width: 568, height: 320, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } },
    { label: 'phone-portrait', width: 390, height: 844, safeArea: { top: 59, right: 0, bottom: 34, left: 0 } },
    { label: 'phone-landscape', width: 844, height: 390, safeArea: { top: 0, right: 59, bottom: 21, left: 59 } },
    { label: 'tablet-portrait', width: 820, height: 1180, safeArea: { top: 24, right: 0, bottom: 20, left: 0 } },
    { label: 'tablet-landscape', width: 1180, height: 820, safeArea: { top: 24, right: 0, bottom: 20, left: 0 } },
  ];
  for (const viewport of viewports) {
    await test.step(viewport.label, async () => {
      const { safeArea } = viewport;
      await view.evaluate((element, insets) => {
        for (const [edge, value] of Object.entries(insets)) {
          (element as HTMLElement).style.setProperty(`--reaction-safe-${edge}`, `${value}px`);
        }
      }, safeArea);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
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
          personalRecordReadable: Number.parseFloat(getComputedStyle(view.querySelector('.reaction-pr-badge span')!).fontSize) >= 13,
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

test('original reaction scene keeps the full tree and gate clear in ready and dropped phone/tablet views', async ({ page }, testInfo) => {
  await mockReactionAccount(page);
  await preparePredictableCadence(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  const view = await openReactionTest(page);
  const gate = view.locator('.reaction-gate-layer');
  const viewports = [
    { label: 'compact-portrait', width: 320, height: 568, top: 20, bottom: 0, side: 0 },
    { label: 'compact-landscape', width: 568, height: 320, top: 0, bottom: 0, side: 0 },
    { label: 'phone-portrait', width: 393, height: 852, top: 59, bottom: 34, side: 0 },
    { label: 'phone-landscape', width: 852, height: 393, top: 0, bottom: 21, side: 45 },
    { label: 'tablet-portrait', width: 820, height: 1180, top: 24, bottom: 20, side: 0 },
    { label: 'tablet-landscape', width: 1180, height: 820, top: 24, bottom: 20, side: 0 },
  ];
  for (const state of ['ready', 'dropped'] as const) {
    if (state === 'dropped') {
      await recordValidRun(page, view, 1_100);
      await expect(gate).toHaveAttribute('data-gate-progress', '1.000');
    }
    for (const viewport of viewports) {
      await test.step(`${state} ${viewport.label}`, async () => {
        await view.evaluate((element, safe) => {
          const style = (element as HTMLElement).style;
          style.setProperty('--reaction-safe-top', `${safe.top}px`);
          style.setProperty('--reaction-safe-bottom', `${safe.bottom}px`);
          style.setProperty('--reaction-safe-left', `${safe.side}px`);
          style.setProperty('--reaction-safe-right', `${safe.side}px`);
        }, viewport);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const framing = await view.evaluate(element => {
          const scene = element.querySelector('.reaction-scene-frame')!.getBoundingClientRect();
          const image = element.querySelector<HTMLImageElement>('.reaction-scene-background')!;
          const tree = element.querySelector('.reaction-tree')!.getBoundingClientRect();
          const gateLayer = element.querySelector('.reaction-gate-layer')!;
          const points = ['data-gate-upright-quad', 'data-gate-flush-quad'].flatMap(attribute => (
            gateLayer.getAttribute(attribute)!.split(' ').map(pair => {
              const [x, y] = pair.split(',').map(Number);
              return { x: scene.left + x / 1672 * scene.width, y: scene.top + y / 941 * scene.height };
            })
          ));
          const gateBounds = {
            left: Math.min(...points.map(point => point.x)), right: Math.max(...points.map(point => point.x)),
            top: Math.min(...points.map(point => point.y)), bottom: Math.max(...points.map(point => point.y)),
          };
          const controls = ['.reaction-title', '.reaction-exit-action', '.reaction-result-stack', '.reaction-primary-action']
            .map(selector => ({ selector, rect: element.querySelector(selector)!.getBoundingClientRect() }));
          const recordStackElement = element.querySelector('.reaction-result-stack')!;
          const recordStack = recordStackElement.getBoundingClientRect();
          const recordChildren = [...element.querySelectorAll<HTMLElement>('.reaction-result-stack *')]
            .filter(child => child.getBoundingClientRect().width > 0 && !child.closest('dialog'));
          const outsideCard = (rect: DOMRect) => rect.left < recordStack.left - 1 || rect.right > recordStack.right + 1
            || rect.top < recordStack.top - 1 || rect.bottom > recordStack.bottom + 1;
          const recordTextOverflow: string[] = [];
          const textNodes = document.createTreeWalker(recordStackElement, NodeFilter.SHOW_TEXT);
          for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
            if (!node.textContent?.trim() || node.parentElement?.closest('dialog')) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            if ([...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0 && outsideCard(rect))) {
              recordTextOverflow.push(node.textContent.trim());
            }
          }
          const intersects = (a: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, b: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>) => (
            Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1
          );
          return {
            source: { width: image.naturalWidth, height: image.naturalHeight, path: image.getAttribute('src') },
            tree: tree.toJSON(), gateBounds, points,
            collisions: controls.filter(control => intersects(control.rect, tree) || intersects(control.rect, gateBounds)).map(control => control.selector),
            recordOverflow: recordChildren.filter(child => {
              const rect = child.getBoundingClientRect();
              const style = getComputedStyle(child);
              // Visible content may use a flex wrapper's surrounding card
              // padding. scrollWidth alone does not mean that content is clipped.
              const clips = (overflow: string) => /^(hidden|clip|auto|scroll)$/.test(overflow);
              return outsideCard(rect)
                || (clips(style.overflowX) && child.scrollWidth > child.clientWidth + 1)
                || (clips(style.overflowY) && child.scrollHeight > child.clientHeight + 1);
            }).map(child => `${child.tagName}.${child.className}`),
            recordTextOverflow,
            controls: controls.map(control => ({ selector: control.selector, ...control.rect.toJSON() })),
            scene: scene.toJSON(), layer: gateLayer.getBoundingClientRect().toJSON(),
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        expect(framing.source).toEqual({ width: 1280, height: 720, path: '/assets/reaction-test-bmx-original-dirt-fixed.png' });
        expect(framing.overflow).toBe(false);
        expect(framing.collisions, `${state} ${viewport.label}: floating controls must leave the original subjects visible`).toEqual([]);
        expect(framing.recordOverflow, `${state} ${viewport.label}: record text and controls must stay inside their card`).toEqual([]);
        expect(framing.recordTextOverflow, `${state} ${viewport.label}: rendered record text must remain inside its card`).toEqual([]);
        for (const subject of [framing.tree, framing.gateBounds]) {
          expect(subject.left).toBeGreaterThanOrEqual(0);
          expect(subject.top).toBeGreaterThanOrEqual(0);
          expect(subject.right).toBeLessThanOrEqual(viewport.width);
          expect(subject.bottom).toBeLessThanOrEqual(viewport.height);
        }
        for (const control of framing.controls) {
          expect(control.left).toBeGreaterThanOrEqual(viewport.side);
          expect(control.right).toBeLessThanOrEqual(viewport.width - viewport.side);
          expect(control.top).toBeGreaterThanOrEqual(viewport.top);
          expect(control.bottom).toBeLessThanOrEqual(viewport.height - viewport.bottom);
        }
        expect(framing.layer).toEqual(framing.scene);
        await expect(view.locator('.reaction-scene-vignette')).toHaveCount(0);
        if (state === 'ready') {
          await expect(view.locator('.reaction-tree')).toHaveClass(/is-ready/);
          await expect(view.locator('[data-lamp-state="lit"]')).toHaveCount(4);
          for (const bulb of await view.locator('.reaction-light-bulb').all()) await expect(bulb).toHaveCSS('visibility', 'hidden');
        } else {
          await expect(view.locator('[data-lamp-state="stopped"]')).toHaveCount(1);
          await expect(view.locator('[data-lamp-state="lit"]')).toHaveCount(3);
    await expect(view.locator('.reaction-scene-stack')).toHaveAttribute('data-gate-state', 'settled');
        }
        await page.screenshot({ path: testInfo.outputPath(`original-scene-${state}-${viewport.label}.png`) });
      });
    }
  }
});

for (const [cueNumber, stoppedStage] of ['red', 'yellow-1', 'yellow-2', 'green'].entries()) {
  test(`photo tree retains the ${stoppedStage} lamp after the gate drops`, async ({ page }, testInfo) => {
    await mockReactionAccount(page);
    await preparePredictableCadence(page);
    await page.addInitScript((targetCue) => {
      let cues = 0;
      window.addEventListener('tracklab-start-gate-tone', () => {
        if (cues++ === targetCue) window.setTimeout(() => {
          document.querySelector('.reaction-race-surface')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        }, 30);
      });
    }, cueNumber);
    await page.setViewportSize({ width: 1180, height: 820 });
    const view = await openReactionTest(page);
    await expect(view.locator('.reaction-scene-background')).toHaveJSProperty('naturalWidth', 1280);
    await expect(view.locator('.reaction-tree')).toHaveClass(/is-ready/);
    await expect(view.locator('[data-lamp-state="lit"]')).toHaveCount(4);
    await view.getByRole('button', { name: 'Start Reaction Test', exact: true }).click();
    await expect(view.locator(`[data-reaction-stage="${stoppedStage}"]`)).toHaveAttribute('data-lamp-state', 'stopped');
    await expect(view.getByRole('button', { name: 'Try Again', exact: true })).toBeVisible();
    await expect(view.locator('[data-lamp-state="stopped"]')).toHaveCount(1);
    await expect(view.locator('[data-lamp-state="lit"]')).toHaveCount(3);
    await expect(view.locator('.reaction-scene-stack')).toHaveAttribute('data-gate-state', 'settled');
    await expect(view.locator('.reaction-light-stop-marker')).toHaveCount(0);
    await expect(view.locator(`[data-reaction-stage="${stoppedStage}"]`)).toHaveCSS('box-shadow', 'none');
    await expect(view.locator(`[data-reaction-stage="${stoppedStage}"]`)).toHaveCSS('outline-style', 'none');
    await expect(view.locator(`[data-reaction-stage="${stoppedStage}"] .reaction-light-bulb`)).toHaveCSS('filter', 'brightness(1.65) saturate(1.2)');
    await page.screenshot({ path: testInfo.outputPath(`tree-${stoppedStage}-tablet.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => view.locator('.reaction-tree').evaluate(el => {
      const r=el.getBoundingClientRect();return r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight;
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`tree-${stoppedStage}-phone.png`) });
    await view.getByRole('button', { name: 'Try Again', exact: true }).click();
    await expect(view.getByRole('button', { name: 'Start Reaction Test', exact: true })).toHaveCount(0);
    await expect(view.locator('[data-reaction-stage="red"]')).toHaveAttribute('data-lamp-state', 'lit');
  });
}

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`Try Again starts automatically after the gate returns (${motion})`, async ({ page }) => {
    await mockReactionAccount(page);
    await preparePredictableCadence(page);
    await page.emulateMedia({ reducedMotion: motion });
    const view = await openReactionTest(page);
    await recordValidRun(page, view, 50);
    await expect(view.getByRole('button', { name: 'Try Again', exact: true })).toBeVisible();
    await view.getByRole('button', { name: 'Try Again', exact: true }).click();
    await expect(view.locator('.reaction-gate-layer')).toHaveAttribute('data-gate-progress', '0.000');
    await expect(view.getByRole('button', { name: 'Start Reaction Test', exact: true })).toHaveCount(0);
    await expect(view.locator('[data-reaction-stage="red"]')).toHaveAttribute('data-lamp-state', 'lit');
    await view.locator('.reaction-race-surface').click({ position: { x: 500, y: 300 } });
    await expect(view.locator('.reaction-result-card')).toBeVisible();
  });
}

test('false-start retry starts the next cadence without a gate movement', async ({ page }) => {
  await mockReactionAccount(page);
  await preparePredictableCadence(page);
  const view = await openReactionTest(page);
  await view.getByRole('button', { name: 'Start Reaction Test', exact: true }).click();
  await view.locator('.reaction-race-surface').click({ position: { x: 500, y: 300 } });
  await expect(view.getByText('TOO EARLY / FALSE START', { exact: true })).toBeVisible();
  await view.getByRole('button', { name: 'Try Again', exact: true }).click();
  await expect(view.getByRole('button', { name: 'Start Reaction Test', exact: true })).toHaveCount(0);
  await expect(view.locator('[data-reaction-stage="red"]')).toHaveAttribute('data-lamp-state', 'lit');
  await expect(view.locator('.reaction-gate-layer')).toHaveAttribute('data-gate-progress', '0.000');
});
