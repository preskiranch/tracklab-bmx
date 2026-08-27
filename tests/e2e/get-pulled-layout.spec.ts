import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const viewports = [
  { width: 390, height: 844 },
  { width: 834, height: 1_194 },
  { width: 944, height: 656 },
  { width: 1_024, height: 768 },
  { width: 1_194, height: 834 },
  { width: 1_366, height: 1_024 },
  { width: 1_440, height: 900 },
] as const;

// Keep this as a pure CSS/DOM geometry test. The full studio-kiosk smoke test
// separately covers authentication, bike binding, and the live pull lifecycle.
test('keeps Get Pulled setup text and controls contained at phone, iPad, and desktop widths', async ({ page }) => {
  const [globalStyles, getPulledStyles] = await Promise.all([
    readFile(new URL('../../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/GetPulledView.css', import.meta.url), 'utf8'),
  ]);

  await page.setContent(`
    <div class="platform-shell">
      <aside class="sidebar" aria-hidden="true"></aside>
      <main class="platform-main">
        <main class="get-pulled-view" aria-label="Get Pulled timed Wattbike test">
          <section class="get-pulled-config">
            <div class="get-pulled-panel">
              <h3>Pull time</h3>
              <div class="get-pulled-options">
                <button class="selected" type="button">3s</button>
                <button type="button">6s</button>
                <button type="button">30s</button>
                <button type="button">Custom</button>
              </div>
            </div>
            <div class="get-pulled-panel get-pulled-air-panel">
              <h3>Wattbike Air setting</h3>
              <p>Select the physical Wattbike Air setting used for this pull. Records are compared only within the same time and Air setting.</p>
              <div class="get-pulled-air-options" aria-label="Wattbike Air setting">
                ${Array.from({ length: 10 }, (_, index) => (
                  `<button${index === 0 ? ' class="selected"' : ''} type="button">${index + 1}</button>`
                )).join('')}
              </div>
            </div>
            <div class="get-pulled-panel">
              <h3>Bike and athlete</h3>
              <p>Choose the Wattbike for this pull, then assign the athlete riding it.</p>
              <div class="get-pulled-riders">
                <div class="get-pulled-bike-row selected">
                  <button class="get-pulled-bike-choice selected" type="button" aria-pressed="true">
                    <span><strong>Wattbike Trainer</strong><small>P1 · WattbikePM25058701</small></span>
                    <span>Selected bike</span>
                  </button>
                  <label class="get-pulled-athlete-select">
                    <span>Athlete</span>
                    <select aria-label="Athlete assigned to Wattbike Trainer">
                      <option>Rasheen Hicks (The Machine)</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
            <p class="get-pulled-privacy">Watts and power results are saved privately to the selected athlete. They are visible on the athlete’s records and authorized club monitors, never public leaderboards or shared ghosts.</p>
            <div class="get-pulled-actions">
              <button class="primary" type="button">Start 3 seconds pull · Air 1</button>
            </div>
          </section>
        </main>
      </main>
    </div>
  `);
  await page.addStyleTag({ content: globalStyles });
  await page.addStyleTag({ content: getPulledStyles });

  const getPulled = page.getByRole('main', { name: 'Get Pulled timed Wattbike test' });
  const readLayout = () => getPulled.evaluate((view) => {
      const config = view.querySelector<HTMLElement>('.get-pulled-config');
      const panels = [...view.querySelectorAll<HTMLElement>('.get-pulled-panel')];
      const descriptions = panels.flatMap((panel) => (
        [...panel.querySelectorAll<HTMLElement>('p')].map((description) => ({ description, panel }))
      ));
      const airOptions = view.querySelector<HTMLElement>('.get-pulled-air-options');
      const airButtons = [...(airOptions?.querySelectorAll<HTMLElement>('button') ?? [])];
      const bikeRow = view.querySelector<HTMLElement>('.get-pulled-bike-row');
      const bikeChoice = view.querySelector<HTMLElement>('.get-pulled-bike-choice');
      const athleteSelect = view.querySelector<HTMLElement>('.get-pulled-athlete-select');
      const select = athleteSelect?.querySelector<HTMLElement>('select');
      const bikeIdentity = bikeChoice?.querySelector<HTMLElement>('span:first-child');
      const bikeName = bikeIdentity?.querySelector<HTMLElement>('strong');
      const deviceLabel = bikeIdentity?.querySelector<HTMLElement>('small');
      const bikeStatus = bikeChoice?.querySelector<HTMLElement>('span:last-child');
      const athleteLabel = athleteSelect?.querySelector<HTMLElement>('span');
      if (
        !config
        || panels.length !== 3
        || !airOptions
        || airButtons.length !== 10
        || !bikeRow
        || !bikeChoice
        || !athleteSelect
        || !select
        || !bikeIdentity
        || !bikeName
        || !deviceLabel
        || !bikeStatus
        || !athleteLabel
      ) {
        throw new Error('Get Pulled setup fixture is incomplete.');
      }

      const inside = (child: DOMRect, parent: DOMRect) => (
        child.left >= parent.left - 1
        && child.top >= parent.top - 1
        && child.right <= parent.right + 1
        && child.bottom <= parent.bottom + 1
      );
      const clears = (left: DOMRect, right: DOMRect) => (
        left.bottom <= right.top + 1
        || left.right <= right.left + 1
        || right.bottom <= left.top + 1
        || right.right <= left.left + 1
      );
      const contentFits = (element: HTMLElement) => (
        element.scrollWidth <= element.clientWidth + 1
        && element.scrollHeight <= element.clientHeight + 1
      );

      const viewRect = view.getBoundingClientRect();
      const configRect = config.getBoundingClientRect();
      const airRect = airOptions.getBoundingClientRect();
      const rowRect = bikeRow.getBoundingClientRect();
      const choiceRect = bikeChoice.getBoundingClientRect();
      const athleteRect = athleteSelect.getBoundingClientRect();
      const identityRect = bikeIdentity.getBoundingClientRect();
      const statusRect = bikeStatus.getBoundingClientRect();
      const athleteLabelRect = athleteLabel.getBoundingClientRect();

      return {
        airColumnCount: getComputedStyle(airOptions).gridTemplateColumns.split(' ').length,
        airControlsFit: contentFits(airOptions)
          && airButtons.every((button) => inside(button.getBoundingClientRect(), airRect)),
        athleteControlFits: inside(athleteRect, rowRect)
          && inside(select.getBoundingClientRect(), athleteRect)
          && contentFits(athleteSelect),
        bikeChoiceFits: inside(choiceRect, rowRect) && contentFits(bikeChoice),
        bikeIdentityFits: inside(identityRect, choiceRect)
          && contentFits(bikeIdentity)
          && contentFits(bikeName)
          && contentFits(deviceLabel),
        bikeStatusClearsAthlete: clears(statusRect, athleteLabelRect),
        bikeStatusFits: inside(statusRect, choiceRect) && contentFits(bikeStatus),
        configColumnCount: getComputedStyle(config).gridTemplateColumns.split(' ').length,
        controlsDoNotOverlap: clears(choiceRect, athleteRect),
        descriptionsFit: descriptions.every(({ description, panel }) => (
          inside(description.getBoundingClientRect(), panel.getBoundingClientRect())
          && contentFits(description)
        )),
        documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        panelsFit: panels.every((panel) => (
          inside(panel.getBoundingClientRect(), configRect)
          && inside(panel.getBoundingClientRect(), viewRect)
        )),
        rowColumnCount: getComputedStyle(bikeRow).gridTemplateColumns.split(' ').length,
        rowFits: contentFits(bikeRow),
        viewFits: contentFits(view),
      };
    });
  const expectedLayout = (compact: boolean) => ({
    airColumnCount: compact ? 5 : 10,
    airControlsFit: true,
    athleteControlFits: true,
    bikeChoiceFits: true,
    bikeIdentityFits: true,
    bikeStatusClearsAthlete: true,
    bikeStatusFits: true,
    configColumnCount: compact ? 1 : 2,
    controlsDoNotOverlap: true,
    descriptionsFit: true,
    documentFits: true,
    panelsFit: true,
    rowColumnCount: compact ? 1 : 2,
    rowFits: true,
    viewFits: true,
  });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(getPulled).toBeVisible();

    const compact = viewport.width <= 1_180;
    expect(await readLayout(), `${viewport.width}x${viewport.height}`).toEqual(expectedLayout(compact));
  }

  // A narrow Get Pulled panel can exist inside a wide desktop viewport. This
  // isolates the container-query path because the viewport media fallback is off.
  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.locator('.platform-shell').evaluate((shell) => {
    shell.style.width = '1000px';
  });
  await expect.poll(() => getPulled.evaluate((view) => getComputedStyle(view).containerType))
    .toBe('inline-size');
  expect(await readLayout(), 'wide viewport with a narrow Get Pulled container')
    .toEqual(expectedLayout(true));

  // iPadOS 15 ignores container queries. Disable them explicitly and prove the
  // viewport fallback still supplies the same safe tablet layout.
  await page.addStyleTag({
    content: '.get-pulled-view{container-name:none!important;container-type:normal!important}',
  });
  await page.locator('.platform-shell').evaluate((shell) => {
    shell.style.removeProperty('width');
  });
  await page.setViewportSize({ width: 1_024, height: 768 });
  await expect.poll(() => getPulled.evaluate((view) => getComputedStyle(view).containerType))
    .toBe('normal');
  expect(await readLayout(), 'iPadOS 15 viewport fallback without container queries')
    .toEqual(expectedLayout(true));
});
