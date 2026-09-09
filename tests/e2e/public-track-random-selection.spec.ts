import { expect, test, type Page } from '@playwright/test';

const trackCount = 30;

const tracks = Array.from({ length: trackCount }, (_, index) => ({
  id: `random-fixture-track-${String(index).padStart(2, '0')}`,
  name: `Random Fixture Track ${String(index).padStart(2, '0')}`,
  country: 'United States',
  countryCode: 'US',
  state: 'California',
  region: 'California',
  source: 'Playwright random-selection fixture',
  address: `${100 + index} Starting Gate Road, Fixture City, CA 900${String(index).padStart(2, '0')}`,
  city: 'Fixture City',
  postalCode: `900${String(index).padStart(2, '0')}`,
  latitude: 34 + (index / 1_000),
  longitude: -118 - (index / 1_000),
}));

async function installDirectoryMocks(page: Page, randomValue: number) {
  await page.addInitScript((value) => {
    Object.defineProperty(Math, 'random', {
      configurable: true,
      value: () => value,
    });
  }, randomValue);

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: null }) });
  });
  await page.route('**/data/track-locator.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-09-02T00:00:00.000Z',
        tracks,
      }),
    });
  });
  await page.route('**/api/bike-shops/nearby*', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        origin: {
          latitude: Number(body.latitude),
          longitude: Number(body.longitude),
          radiusMiles: Number(body.radiusMiles),
        },
        shops: [],
        attributions: [],
      }),
    });
  });
  await page.route('https://maps.googleapis.com/**', async (route) => route.abort());
}

async function expectTrackSelectedAndExposed(page: Page, expectedIndex: number) {
  const locator = page.locator('#track-locator');
  const expectedTrack = tracks[expectedIndex];
  await expect(locator.getByRole('heading', { name: expectedTrack.name, exact: true })).toBeVisible();
  await expect(locator.getByRole('button', {
    name: `Open global 3D track explorer starting at ${expectedTrack.name}`,
  })).toBeVisible();

  const resultList = locator.locator('.public-track-results');
  const selectedResult = resultList.locator('button[aria-pressed="true"]');
  await expect(selectedResult).toHaveCount(1);
  await expect(selectedResult).toHaveClass(/selected/);
  await expect(selectedResult).toHaveAttribute('aria-current', 'true');
  await expect(selectedResult).toContainText(expectedTrack.name);
  await expect(selectedResult).toBeVisible();

  const selectedResultIsExposed = await selectedResult.evaluate((button) => {
    const list = button.closest<HTMLElement>('.public-track-results');
    if (!list) return false;
    const buttonBounds = button.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    return buttonBounds.top >= listBounds.top - 1
      && buttonBounds.bottom <= listBounds.bottom + 1;
  });
  expect(selectedResultIsExposed).toBe(true);
}

for (const scenario of [
  { label: 'an early catalog entry', randomValue: 0.1, expectedIndex: 3 },
  { label: 'an entry beyond the first result page', randomValue: 0.9, expectedIndex: 27 },
]) {
  test(`a fresh BMX directory visit randomly selects and exposes ${scenario.label}`, async ({ page }) => {
    await installDirectoryMocks(page, scenario.randomValue);
    await page.goto('/#track-locator');
    await expectTrackSelectedAndExposed(page, scenario.expectedIndex);
  });
}

test('consecutive fresh visits do not repeat the previously randomized track', async ({ page }) => {
  await installDirectoryMocks(page, 0.1);
  await page.goto('/#track-locator');
  await expectTrackSelectedAndExposed(page, 3);

  await page.reload();
  await expectTrackSelectedAndExposed(page, 2);
});
