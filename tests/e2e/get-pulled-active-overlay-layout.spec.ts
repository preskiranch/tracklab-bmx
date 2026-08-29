import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { getPulledFullscreenStyles } from '../../src/lib/getPulledFullscreenLayout';

const viewports = [
  { columns: 3, label: 'small iPhone portrait', width: 320, height: 568 },
  { columns: 6, label: 'small iPhone landscape', width: 568, height: 320 },
  { columns: 3, label: 'iPhone portrait', width: 375, height: 667 },
  { columns: 6, label: 'iPhone landscape', width: 844, height: 390 },
  { columns: 6, label: 'iPad mini portrait', width: 744, height: 1_133 },
  { columns: 6, label: 'iPad mini landscape', width: 1_133, height: 744 },
  { columns: 6, label: 'studio iPad landscape', width: 1_024, height: 768 },
  { columns: 6, label: 'iPad Pro landscape', width: 1_366, height: 1_024 },
] as const;

// Keep this fixture independent of authentication, Bluetooth, and pull timing.
// The lifecycle smoke tests exercise those behaviors; this test owns the exact
// fullscreen geometry that can otherwise regress without causing page overflow.
test('keeps active Get Pulled status and session actions clear at every supported screen size', async ({ page }, testInfo) => {
  const [globalStyles, getPulledStyles, heartRateStyles] = await Promise.all([
    readFile(new URL('../../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/GetPulledView.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/HeartRateMetric.css', import.meta.url), 'utf8'),
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
            <div class="get-pulled-metric"><svg aria-hidden="true" width="20" height="20"></svg><strong>400</strong><small>Live watts</small></div>
            <div class="get-pulled-metric"><svg aria-hidden="true" width="20" height="20"></svg><strong>433</strong><small>Peak watts</small></div>
            <div class="get-pulled-metric"><svg aria-hidden="true" width="20" height="20"></svg><strong>65</strong><small>Cadence RPM</small></div>
            <div class="get-pulled-metric"><svg aria-hidden="true" width="20" height="20"></svg><strong>66</strong><small>Peak cadence</small></div>
            <div class="get-pulled-metric"><svg aria-hidden="true" width="20" height="20"></svg><strong>10.6</strong><small>MPH</small></div>
            <div class="heart-rate-metric compact live" role="status"><svg aria-hidden="true" width="17" height="17"></svg><span><strong>76</strong><small>Simulated BPM</small></span></div>
          </section>
        </main>
      </main>
    </div>
  `);
  await page.addStyleTag({ content: globalStyles });
  await page.addStyleTag({ content: getPulledStyles });
  await page.addStyleTag({ content: heartRateStyles });
  await page.addStyleTag({ content: getPulledFullscreenStyles });
  await page.addStyleTag({ content: `
    html,body,.platform-shell{width:100%;height:100%;margin:0;overflow:hidden}
    .platform-shell.utility-fullscreen{position:fixed;inset:0;z-index:2147480000;display:block;width:100vw;height:100vh;height:100dvh;min-height:0;overflow:hidden;background:#07100b}
    .utility-fullscreen .platform-main{width:100%;height:100%;min-height:0;padding:0;overflow:auto}
    .utility-fullscreen .pull-sled-scene{position:relative;width:100%;height:420px;min-height:420px;overflow:hidden;border-radius:22px;background:#425d45}
  ` });

  const fullscreen = page.locator('.platform-shell.utility-fullscreen');
  const readOverlayLayout = () => fullscreen.evaluate((shell) => {
    const timer = shell.querySelector<HTMLElement>('.get-pulled-timer');
    const phase = shell.querySelector<HTMLElement>('.get-pulled-phase');
    const actions = shell.querySelector<HTMLElement>('.get-pulled-fullscreen-actions');
    const cancel = shell.querySelector<HTMLElement>('.get-pulled-exit-fullscreen');
    const endAthlete = shell.querySelector<HTMLElement>('.get-pulled-end-session-fullscreen');
    const main = shell.querySelector<HTMLElement>('.platform-main');
    const view = shell.querySelector<HTMLElement>('.get-pulled-view');
    const hero = shell.querySelector<HTMLElement>('.get-pulled-hero');
    const scene = shell.querySelector<HTMLElement>('.pull-sled-scene');
    const metrics = shell.querySelector<HTMLElement>('.get-pulled-metrics');
    if (!timer || !phase || !actions || !cancel || !endAthlete || !main || !view || !hero || !scene || !metrics) {
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
    const inside = (parent: DOMRect, child: DOMRect) => (
      child.left >= parent.left - 1
      && child.top >= parent.top - 1
      && child.right <= parent.right + 1
      && child.bottom <= parent.bottom + 1
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
    const viewRect = view.getBoundingClientRect();
    const heroRect = hero.getBoundingClientRect();
    const sceneRect = scene.getBoundingClientRect();
    const metricsRect = metrics.getBoundingClientRect();
    const resultActions = view.querySelector<HTMLElement>(':scope > .get-pulled-actions');
    const dashboardBottom = resultActions?.getBoundingClientRect().bottom ?? metricsRect.bottom;
    const metricCards = [...metrics.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
    const metricRects = metricCards.map((card) => card.getBoundingClientRect());
    const metricRows = metricRects.reduce<number[]>((rows, rect) => {
      if (!rows.some((top) => Math.abs(top - rect.top) <= 1)) rows.push(rect.top);
      return rows;
    }, []).length;
    const metricOverlaps: string[] = [];
    for (let leftIndex = 0; leftIndex < metricRects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < metricRects.length; rightIndex += 1) {
        const left = metricRects[leftIndex];
        const right = metricRects[rightIndex];
        if (left && right && !clears(left, right, 0)) metricOverlaps.push(`${leftIndex}:${rightIndex}`);
      }
    }

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
      dashboardBottomGap: viewRect.bottom - dashboardBottom,
      dashboardHeightRatio: (dashboardBottom - metricsRect.top) / viewRect.height,
      documentContained: document.documentElement.scrollWidth <= innerWidth + 1
        && document.documentElement.scrollHeight <= innerHeight + 1,
      endAthleteHasTouchTarget: endAthleteRect.height >= 44 && endAthleteRect.width >= 44,
      heroClearsMetrics: heroRect.bottom <= metricsRect.top + 1,
      mainContained: contentFits(main),
      metricBandRatio: metricsRect.height / viewRect.height,
      metricCardsContained: metricCards.length === 6
        && metricRects.every((rect) => inside(metricsRect, rect) && insideViewport(rect)),
      metricCardOverflows: metricCards.flatMap((card, cardIndex) => (
        contentFits(card)
          ? []
          : [`${cardIndex}:${card.clientWidth}x${card.clientHeight}/${card.scrollWidth}x${card.scrollHeight}`]
      )),
      metricColumns: getComputedStyle(metrics).gridTemplateColumns.split(' ').filter(Boolean).length,
      metricOverlaps,
      metricRows,
      metricTextOverflows: metricCards.flatMap((card, cardIndex) => (
        [...card.querySelectorAll<HTMLElement>('strong,small')]
          .filter((element) => !contentFits(element))
          .map((element) => (
            `${cardIndex}:${element.tagName.toLowerCase()}:${element.textContent?.trim() ?? ''}`
            + `:${element.clientWidth}x${element.clientHeight}/${element.scrollWidth}x${element.scrollHeight}`
          ))
      )),
      phaseHandled: !visible(phase)
        || (insideViewport(phase.getBoundingClientRect())
          && phase.scrollHeight <= phase.clientHeight + 1),
      phaseVisible: visible(phase),
      sceneDominatesMetrics: sceneRect.height >= metricsRect.height * 2,
      sceneRatio: sceneRect.height / viewRect.height,
      sceneWithinView: inside(viewRect, sceneRect) && insideViewport(sceneRect),
      timerTextContained: contentFits(timer),
      viewContained: contentFits(view),
    };
  });

  const assertResponsivePlayfield = async (resultPhase: boolean) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(fullscreen).toBeVisible();
      const layout = await readOverlayLayout();
      const context = `${viewport.label} (${viewport.width}x${viewport.height})${resultPhase ? ' results' : ' active'}`;
      expect(layout, context).toMatchObject({
        actionButtonsClear: true,
        actionButtonsFit: true,
        allControlsInsideViewport: true,
        cancelHasTouchTarget: true,
        collisions: [],
        documentContained: true,
        endAthleteHasTouchTarget: true,
        heroClearsMetrics: true,
        mainContained: true,
        metricCardsContained: true,
        metricCardOverflows: [],
        metricColumns: viewport.columns,
        metricOverlaps: [],
        metricRows: Math.ceil(6 / viewport.columns),
        metricTextOverflows: [],
        phaseHandled: true,
        sceneDominatesMetrics: true,
        sceneWithinView: true,
        timerTextContained: true,
        viewContained: true,
      });
      expect(layout.dashboardBottomGap, `${context} keeps the dashboard bottom-anchored`).toBeLessThanOrEqual(12.5);
      const phone = Math.min(viewport.width, viewport.height) <= 430;
      expect(layout.metricBandRatio, `${context} keeps metrics compact`).toBeLessThanOrEqual(phone ? 0.25 : 0.18);
      expect(layout.dashboardHeightRatio, `${context} reserves most of the screen for play`).toBeLessThanOrEqual(
        resultPhase ? (phone ? 0.36 : 0.26) : (phone ? 0.25 : 0.18),
      );
      expect(layout.sceneRatio, `${context} keeps the playable map dominant`).toBeGreaterThanOrEqual(phone ? 0.62 : 0.70);
      if (viewport.width > 1_180) {
        expect(layout.phaseVisible, `${context} keeps the rider/status overlay available`).toBe(true);
      }
      if (!resultPhase && (viewport.label === 'iPhone portrait' || viewport.label === 'studio iPad landscape')) {
        await fullscreen.screenshot({
          path: testInfo.outputPath(`get-pulled-${viewport.label.replaceAll(' ', '-')}.png`),
        });
      }
    }
  };

  await assertResponsivePlayfield(false);

  await page.locator('.get-pulled-metrics').evaluate((metrics) => {
    metrics.classList.add('get-pulled-results');
    const heartRate = metrics.lastElementChild;
    if (heartRate) {
      heartRate.outerHTML = '<div class="get-pulled-metric get-pulled-heart-rate-summary" aria-label="Average heart rate 76 BPM, peak 88 BPM, 100% coverage"><svg aria-hidden="true" width="20" height="20"></svg><strong>76</strong><small>Peak 88 · 100% data</small></div>';
    }
  });
  await page.locator('.get-pulled-view').evaluate((view) => {
    const resultActions = document.createElement('div');
    resultActions.className = 'get-pulled-actions';
    resultActions.setAttribute('aria-label', 'Result recorded at Wattbike Air 1');
    resultActions.innerHTML = '<button class="primary" type="button">Run another pull</button>';
    view.append(resultActions);
  });
  await assertResponsivePlayfield(true);

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

test('native TrackLab tablets use CSS utility fullscreen without requesting browser fullscreen', async ({ page }, testInfo) => {
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

  expect(await pull.evaluate((view) => {
    const main = view.closest<HTMLElement>('.platform-main');
    const hero = view.querySelector<HTMLElement>('.get-pulled-hero');
    const scene = view.querySelector<HTMLElement>('.pull-sled-scene');
    const metrics = view.querySelector<HTMLElement>('.get-pulled-metrics');
    if (!main || !hero || !scene || !metrics) throw new Error('Native Get Pulled geometry is incomplete.');
    const viewRect = view.getBoundingClientRect();
    const sceneRect = scene.getBoundingClientRect();
    const metricsRect = metrics.getBoundingClientRect();
    const cardRects = [...metrics.children].map((card) => card.getBoundingClientRect());
    const rows = cardRects.reduce<number[]>((tops, rect) => {
      if (!tops.some((top) => Math.abs(top - rect.top) <= 1)) tops.push(rect.top);
      return tops;
    }, []);
    return {
      cardsContained: cardRects.length === 6 && cardRects.every((rect) => (
        rect.left >= metricsRect.left - 1
        && rect.top >= metricsRect.top - 1
        && rect.right <= metricsRect.right + 1
        && rect.bottom <= metricsRect.bottom + 1
      )),
      columns: getComputedStyle(metrics).gridTemplateColumns.split(' ').filter(Boolean).length,
      heroClearsMetrics: sceneRect.bottom <= metricsRect.top + 1,
      mainContained: main.scrollHeight <= main.clientHeight + 1 && main.scrollWidth <= main.clientWidth + 1,
      metricBandRatio: metricsRect.height / viewRect.height,
      rows: rows.length,
      sceneRatio: sceneRect.height / viewRect.height,
      viewContained: view.scrollHeight <= view.clientHeight + 1 && view.scrollWidth <= view.clientWidth + 1,
    };
  })).toMatchObject({
    cardsContained: true,
    columns: 6,
    heroClearsMetrics: true,
    mainContained: true,
    rows: 1,
    viewContained: true,
  });

  const nativeGeometry = await pull.evaluate((view) => {
    const scene = view.querySelector<HTMLElement>('.pull-sled-scene');
    const metrics = view.querySelector<HTMLElement>('.get-pulled-metrics');
    if (!scene || !metrics) throw new Error('Native Get Pulled geometry is incomplete.');
    return {
      metricBandRatio: metrics.getBoundingClientRect().height / view.getBoundingClientRect().height,
      sceneRatio: scene.getBoundingClientRect().height / view.getBoundingClientRect().height,
    };
  });
  expect(nativeGeometry.metricBandRatio).toBeLessThanOrEqual(0.18);
  expect(nativeGeometry.sceneRatio).toBeGreaterThanOrEqual(0.70);
  await pull.screenshot({ path: testInfo.outputPath('native-studio-ipad-get-pulled.png') });

  await pull.getByRole('button', { name: 'Cancel sprint', exact: true }).click();
  await expect(page.locator('.platform-shell')).not.toHaveClass(/utility-fullscreen/);
});
