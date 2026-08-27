import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { getPulledFullscreenStyles } from '../../src/lib/getPulledFullscreenLayout';

const viewports = [
  { label: 'phone portrait', width: 390, height: 844 },
  { label: 'phone landscape', width: 844, height: 390 },
  { label: 'studio tablet', width: 1_024, height: 768 },
  { label: 'iPad Pro', width: 1_366, height: 1_024 },
  { label: 'desktop', width: 1_440, height: 900 },
] as const;

// Keep this fixture independent of authentication, Bluetooth, and pull timing.
// The lifecycle smoke tests exercise those behaviors; this test owns the exact
// fullscreen geometry that can otherwise regress without causing page overflow.
test('keeps active Get Pulled status and session actions clear at every supported screen size', async ({ page }) => {
  const [globalStyles, getPulledStyles] = await Promise.all([
    readFile(new URL('../../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/GetPulledView.css', import.meta.url), 'utf8'),
  ]);

  await page.setContent(`
    <div class="platform-shell utility-fullscreen">
      <main class="platform-main">
        <main class="get-pulled-view" aria-label="Get Pulled timed Wattbike test">
          <div class="get-pulled-fullscreen-actions" role="group" aria-label="Get Pulled session controls">
            <button aria-label="Cancel sprint" class="get-pulled-exit-fullscreen" type="button">
              <svg aria-hidden="true" width="18" height="18"></svg><span>Cancel sprint</span>
            </button>
            <button aria-label="End athlete session" class="get-pulled-end-session-fullscreen" type="button">
              <svg aria-hidden="true" width="18" height="18"></svg><span>End athlete session</span>
            </button>
          </div>
          <section class="get-pulled-hero">
            <div class="pull-sled-scene" role="img" aria-label="BMX rider ready to pull the TrackLab sled"></div>
            <div class="get-pulled-overlay">
              <div class="get-pulled-timer">
                <strong>0.00s</strong>
                <small>Starts on first 1-watt power signal</small>
              </div>
              <div class="get-pulled-phase">
                <strong>Rasheen Hicks (The Machine)</strong>
                <small>Ready · Reach 1 watt to start · Wattbike Air 1</small>
              </div>
            </div>
            <div class="get-pulled-countdown" role="status">
              <strong>READY</strong>
            </div>
          </section>
          <section class="get-pulled-metrics" aria-label="Live pull metrics">
            <div class="get-pulled-metric"><strong>0</strong><small>Live watts</small></div>
            <div class="get-pulled-metric"><strong>0</strong><small>Peak watts</small></div>
            <div class="get-pulled-metric"><strong>150</strong><small>Cadence RPM</small></div>
            <div class="get-pulled-metric"><strong>0</strong><small>Peak cadence</small></div>
            <div class="get-pulled-metric"><strong>24.5</strong><small>MPH</small></div>
            <div class="get-pulled-metric"><strong>--</strong><small>Heart rate</small></div>
          </section>
        </main>
      </main>
    </div>
  `);
  await page.addStyleTag({ content: globalStyles });
  await page.addStyleTag({ content: getPulledStyles });
  await page.addStyleTag({ content: getPulledFullscreenStyles });
  await page.addStyleTag({ content: `
    html,body,.platform-shell{width:100%;height:100%;margin:0;overflow:hidden}
    .platform-shell.utility-fullscreen{position:fixed;inset:0;display:block;background:#07100b}
    .utility-fullscreen .platform-main{width:100%;height:100%;min-height:0;padding:0;overflow:hidden}
    .utility-fullscreen .get-pulled-view{box-sizing:border-box;width:100%;height:100%;min-height:0;grid-template-rows:minmax(0,1fr) auto;padding:10px;background:#07100b}
    .utility-fullscreen .get-pulled-hero{height:100%;min-height:0}
    .utility-fullscreen .pull-sled-scene{width:100%;height:100%;min-height:330px;border-radius:14px;background:#425d45}
  ` });

  const fullscreen = page.locator('.platform-shell.utility-fullscreen');
  const readOverlayLayout = () => fullscreen.evaluate((shell) => {
    const timer = shell.querySelector<HTMLElement>('.get-pulled-timer');
    const phase = shell.querySelector<HTMLElement>('.get-pulled-phase');
    const actions = shell.querySelector<HTMLElement>('.get-pulled-fullscreen-actions');
    const cancel = shell.querySelector<HTMLElement>('.get-pulled-exit-fullscreen');
    const endAthlete = shell.querySelector<HTMLElement>('.get-pulled-end-session-fullscreen');
    if (!timer || !phase || !actions || !cancel || !endAthlete) {
      throw new Error('Active Get Pulled overlay fixture is incomplete.');
    }

    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && element.getBoundingClientRect().width > 0
        && element.getBoundingClientRect().height > 0;
    };
    const insideViewport = (rect: DOMRect) => (
      rect.left >= -1
      && rect.top >= -1
      && rect.right <= innerWidth + 1
      && rect.bottom <= innerHeight + 1
    );
    const clears = (left: DOMRect, right: DOMRect, gap = 4) => (
      left.bottom + gap <= right.top
      || left.right + gap <= right.left
      || right.bottom + gap <= left.top
      || right.right + gap <= left.left
    );
    const contentFits = (element: HTMLElement) => (
      element.scrollWidth <= element.clientWidth + 1
      && element.scrollHeight <= element.clientHeight + 1
    );

    const controls = [timer, phase, actions].filter(visible);
    const controlRects = controls.map((element) => ({
      className: element.className,
      rect: element.getBoundingClientRect(),
    }));
    const collisions: string[] = [];
    for (let leftIndex = 0; leftIndex < controlRects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < controlRects.length; rightIndex += 1) {
        const left = controlRects[leftIndex];
        const right = controlRects[rightIndex];
        if (left && right && !clears(left.rect, right.rect, 0)) {
          collisions.push(`${left.className} <> ${right.className}`);
        }
      }
    }

    const cancelRect = cancel.getBoundingClientRect();
    const endAthleteRect = endAthlete.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();

    return {
      actionButtonsClear: clears(cancelRect, endAthleteRect),
      actionButtonsFit: [cancel, endAthlete].every((button) => (
        insideViewport(button.getBoundingClientRect())
        && button.getBoundingClientRect().left >= actionsRect.left - 1
        && button.getBoundingClientRect().right <= actionsRect.right + 1
        && button.getBoundingClientRect().top >= actionsRect.top - 1
        && button.getBoundingClientRect().bottom <= actionsRect.bottom + 1
        && contentFits(button)
      )),
      allControlsInsideViewport: controlRects.every(({ rect }) => insideViewport(rect)),
      cancelHasTouchTarget: cancelRect.height >= 44 && cancelRect.width >= 44,
      collisions,
      documentContained: document.documentElement.scrollWidth <= innerWidth + 1
        && document.documentElement.scrollHeight <= innerHeight + 1,
      endAthleteHasTouchTarget: endAthleteRect.height >= 44 && endAthleteRect.width >= 44,
      phaseHandled: !visible(phase)
        || (insideViewport(phase.getBoundingClientRect())
          && phase.scrollHeight <= phase.clientHeight + 1),
      phaseVisible: visible(phase),
      timerTextContained: contentFits(timer),
    };
  });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(fullscreen).toBeVisible();
    const layout = await readOverlayLayout();
    expect(layout, `${viewport.label} (${viewport.width}x${viewport.height})`).toMatchObject({
      actionButtonsClear: true,
      actionButtonsFit: true,
      allControlsInsideViewport: true,
      cancelHasTouchTarget: true,
      collisions: [],
      documentContained: true,
      endAthleteHasTouchTarget: true,
      phaseHandled: true,
      timerTextContained: true,
    });
    if (viewport.width > 1_180) {
      expect(layout.phaseVisible, `${viewport.label} keeps the rider/status overlay available`).toBe(true);
    }
  }

  // The result view drops Cancel but deliberately keeps the rider-controlled
  // End action in the same reserved rail while they review their metrics.
  const sessionControls = page.getByRole('group', { name: 'Get Pulled session controls' });
  await sessionControls
    .getByRole('button', { name: 'Cancel sprint', exact: true })
    .evaluate((button) => button.remove());
  await expect(sessionControls.getByRole('button')).toHaveCount(1);
  await expect(sessionControls.getByRole('button', { name: 'End athlete session', exact: true })).toBeVisible();
  expect(await sessionControls.evaluate((controls) => {
    const rect = controls.getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
  })).toBe(true);
});

test('native TrackLab tablets use CSS utility fullscreen without requesting browser fullscreen', async ({ page }) => {
  test.setTimeout(30_000);
  const now = Date.now();
  const authUser = {
    id: 'native-get-pulled-layout',
    profileKey: 'user:native-get-pulled-layout',
    email: 'native-get-pulled-layout@tracklab.test',
    name: 'Native Get Pulled Rider',
    admin: true,
    membership: { tier: 'racer', bikeSeats: 4, updatedAt: now },
  };

  await page.setViewportSize({ width: 1_024, height: 768 });
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) TrackLabBMX-iOS',
    });
    let requestCalls = 0;
    const requestFullscreen = async () => {
      requestCalls += 1;
    };
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(HTMLElement.prototype, 'webkitRequestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(window, '__getPulledNativeFullscreenProbe', {
      configurable: true,
      value: { requestCalls: () => requestCalls },
    });
  });
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
    body: JSON.stringify({ canManageClub: true, ownedClub: null, memberships: [] }),
  }));
  await page.route('**/api/training-sessions*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ sessions: [], totals: {} }),
  }));
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());

  await page.goto('/?track=black-mountain-bmx');
  const openApp = page.getByRole('button', { name: 'Open App' });
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await openApp.or(navigation).first().waitFor({ state: 'visible' });
  if (await openApp.isVisible()) await openApp.click();
  await page.getByRole('button', { name: /Demo/i }).first().click();
  await page.getByRole('button', { name: 'Get Pulled', exact: true }).click();
  const pull = page.getByRole('main', { name: 'Get Pulled timed Wattbike test' });
  await pull.getByRole('button', { name: 'Start 3 seconds pull · Air 1', exact: true }).click();

  await expect(page.locator('.platform-shell')).toHaveClass(/utility-fullscreen/);
  await expect(pull.getByRole('button', { name: 'Cancel sprint', exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const probe = (window as typeof window & {
      __getPulledNativeFullscreenProbe?: { requestCalls: () => number };
    }).__getPulledNativeFullscreenProbe;
    return {
      browserFullscreen: Boolean(document.fullscreenElement),
      requestCalls: probe?.requestCalls() ?? -1,
      userAgent: navigator.userAgent,
    };
  })).toEqual({
    browserFullscreen: false,
    requestCalls: 0,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) TrackLabBMX-iOS',
  });

  await pull.getByRole('button', { name: 'Cancel sprint', exact: true }).click();
  await expect(page.locator('.platform-shell')).not.toHaveClass(/utility-fullscreen/);
});
