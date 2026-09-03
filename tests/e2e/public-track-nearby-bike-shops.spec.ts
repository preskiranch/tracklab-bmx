import { expect, test, type Page } from '@playwright/test';

const selectedTrack = {
  id: 'trackside-nearby-shops-bmx',
  name: 'Trackside Nearby Shops BMX',
  country: 'United States',
  countryCode: 'US',
  state: 'California',
  region: 'California',
  source: 'Playwright fixture',
  address: '700 Start Hill Road, Sacramento, CA 95814',
  city: 'Sacramento',
  postalCode: '95814',
  latitude: 38.5816,
  longitude: -121.4944,
};

const otherTrack = {
  ...selectedTrack,
  id: 'another-california-bmx',
  name: 'Another California BMX',
  address: '800 Finish Line, Roseville, CA 95678',
  city: 'Roseville',
  latitude: 38.7521,
  longitude: -121.2880,
};

const foreignTrack = {
  ...selectedTrack,
  id: 'victoria-filter-fixture-bmx',
  name: 'Victoria Filter Fixture BMX',
  country: 'Australia',
  countryCode: 'AU',
  state: 'Victoria',
  region: 'Victoria',
  address: '1 Test Track, Melbourne VIC 3000',
  city: 'Melbourne',
  postalCode: '3000',
  latitude: -37.8136,
  longitude: 144.9631,
};

function bikeShop(
  id: string,
  name: string,
  distanceMiles: number,
  latitude: number,
  longitude: number,
) {
  return {
    id,
    name,
    latitude,
    longitude,
    distanceMiles,
    address: {
      line1: `${id.replace(/\D/g, '') || '1'} Gear Street`,
      locality: 'Sacramento',
      region: 'CA',
      postalCode: '95814',
      countryCode: 'US',
      formatted: `${id.replace(/\D/g, '') || '1'} Gear Street, Sacramento, CA 95814`,
    },
    phone: '',
    website: '',
    openingHours: '',
    services: { sales: true, repair: true, rental: false, ebike: false },
    source: {
      provider: 'OpenStreetMap',
      elementType: 'node',
      elementId: id.replace(/\D/g, '') || '1',
      url: `https://www.openstreetmap.org/node/${id.replace(/\D/g, '') || '1'}`,
    },
    links: {
      maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`,
      directions: `https://www.google.com/maps/dir/?api=1&destination=${latitude}%2C${longitude}`,
      streetView: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latitude}%2C${longitude}`,
    },
  };
}

const nearbyShops = [
  bikeShop('osm:node:101', 'Starting Gate Cycles', 1.2, 38.5890, -121.4890),
  bikeShop('osm:node:202', 'Capital City Bike Works', 3.4, 38.6100, -121.4700),
  bikeShop('osm:node:303', 'River Trail Bicycles', 7.8, 38.6400, -121.4300),
  bikeShop('osm:node:404', 'Fourth Shop Outside Preview', 13.1, 38.7000, -121.3900),
];

type NearbyRequest = {
  method: string;
  body: Record<string, unknown>;
};

async function installDirectoryMocks(page: Page, nearbyRequests: NearbyRequest[] = []) {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: null }) });
  });
  await page.route('**/data/track-locator.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-09-02T00:00:00.000Z',
        tracks: [selectedTrack, otherTrack, foreignTrack],
      }),
    });
  });
  await page.route('**/api/bike-shops/nearby*', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as Record<string, unknown>;
    nearbyRequests.push({ method: request.method(), body });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        origin: {
          latitude: Number(body.latitude),
          longitude: Number(body.longitude),
          radiusMiles: Number(body.radiusMiles),
        },
        shops: nearbyShops,
        attribution: {
          text: '© OpenStreetMap contributors',
          url: 'https://www.openstreetmap.org/copyright',
          license: 'ODbL',
        },
      }),
    });
  });
  await page.route('**/api/bike-shops/hierarchy*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ level: 'country', items: [], attributions: [] }),
    });
  });
  await page.route('**/api/bike-shops/browse*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        location: {},
        shops: [],
        total: 0,
        truncated: false,
        bounds: null,
        attributions: [],
      }),
    });
  });
}

async function selectTrackWithFilters(page: Page) {
  await page.goto('/#track-locator');
  const locator = page.locator('#track-locator');
  await expect(locator).toBeVisible();
  await locator.getByLabel('Country').selectOption('United States');
  await locator.getByLabel('State / region').selectOption('California');
  await locator.getByLabel('Search tracks').fill('Trackside Nearby');
  await expect(locator.getByText('1 found', { exact: true })).toBeVisible();
  await locator.locator('.public-track-results')
    .getByRole('button', { name: new RegExp(selectedTrack.name) })
    .click();
  await expect(locator.getByRole('heading', { name: selectedTrack.name, exact: true })).toBeVisible();
  return locator;
}

function nearbyShopControl(region: ReturnType<Page['locator']>, name: string) {
  return region.locator('a, button').filter({ hasText: name });
}

test('selected track previews nearby shops and hands its context to the bike shop directory', async ({ page }) => {
  const nearbyRequests: NearbyRequest[] = [];
  await installDirectoryMocks(page, nearbyRequests);
  let locator = await selectTrackWithFilters(page);

  let nearbyRegion = locator.getByRole('region', { name: 'Bike shops within 25 miles' });
  await expect(nearbyRegion).toBeVisible();
  for (const shop of nearbyShops.slice(0, 3)) {
    const control = nearbyShopControl(nearbyRegion, shop.name);
    await expect(control).toHaveCount(1);
    await expect(control).toContainText(`${shop.distanceMiles.toFixed(1)} mi`);
  }
  await expect(nearbyShopControl(nearbyRegion, nearbyShops[3].name)).toHaveCount(0);
  await expect(nearbyRegion.getByRole('button', { name: 'View all nearby bike shops' })).toBeVisible();

  await expect.poll(() => nearbyRequests.some(({ method, body }) => (
    method === 'POST'
    && Number(body.latitude) === selectedTrack.latitude
    && Number(body.longitude) === selectedTrack.longitude
    && Number(body.radiusMiles) === 25
  ))).toBe(true);

  await nearbyShopControl(nearbyRegion, nearbyShops[1].name).click();
  const directory = page.locator('#bike-shop-directory');
  await expect(directory).toBeVisible();
  await expect(directory.getByLabel('Map area', { exact: true })).toHaveValue('25');
  await expect(directory.getByText(
    `Near ${selectedTrack.name} · within 25 miles`,
    { exact: true },
  )).toBeVisible();
  const selectedShopResult = directory
    .getByRole('list', { name: 'Loaded bike shop listings' })
    .getByRole('button', { name: new RegExp(nearbyShops[1].name) });
  await expect(selectedShopResult).toHaveAttribute('aria-pressed', 'true');
  await expect(directory.locator('.public-bike-shop-directory__detail').getByRole('heading', {
    name: nearbyShops[1].name,
    exact: true,
  })).toBeVisible();

  const homeNavigation = page.getByRole('navigation', { name: 'TrackLab home navigation' });
  await homeNavigation.getByRole('button', { name: 'BMX Tracks' }).click();
  locator = page.locator('#track-locator');
  await expect(locator).toBeVisible();
  await expect(locator.getByLabel('Search tracks')).toHaveValue('Trackside Nearby');
  await expect(locator.getByLabel('Country')).toHaveValue('United States');
  await expect(locator.getByLabel('State / region')).toHaveValue('California');
  await expect(locator.getByRole('heading', { name: selectedTrack.name, exact: true })).toBeVisible();

  nearbyRegion = locator.getByRole('region', { name: 'Bike shops within 25 miles' });
  await nearbyRegion.getByRole('button', { name: 'View all nearby bike shops' }).click();
  await expect(directory).toBeVisible();
  await expect(directory.getByLabel('Map area', { exact: true })).toHaveValue('25');
  await expect(directory.getByText(
    `Near ${selectedTrack.name} · within 25 miles`,
    { exact: true },
  )).toBeVisible();
  await expect(directory.getByRole('list', { name: 'Loaded bike shop listings' }).getByRole('button'))
    .toHaveCount(nearbyShops.length);
});

test('nearby bike shop preview remains contained on desktop and phone', async ({ page }) => {
  await installDirectoryMocks(page);
  const locator = await selectTrackWithFilters(page);
  const nearbyRegion = locator.getByRole('region', { name: 'Bike shops within 25 miles' });
  await expect(nearbyRegion).toBeVisible();

  for (const viewport of [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'iPhone portrait', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await nearbyRegion.scrollIntoViewIfNeeded();
    await expect(nearbyRegion).toBeVisible();

    const geometry = await nearbyRegion.evaluate((element) => {
      const parent = element.closest<HTMLElement>('.public-locator-preview');
      if (!parent) throw new Error('Nearby shops must remain inside the selected-track preview.');
      const region = element.getBoundingClientRect();
      const preview = parent.getBoundingClientRect();
      const controls = [...element.querySelectorAll<HTMLElement>('a, button')].map((control) => {
        const box = control.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          scrollWidth: control.scrollWidth,
          clientWidth: control.clientWidth,
        };
      });
      return {
        documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        regionFits: element.scrollWidth <= element.clientWidth + 1,
        regionInsidePreview: region.left >= preview.left - 1 && region.right <= preview.right + 1,
        controlsFit: controls.every((control) => (
          control.left >= region.left - 1
          && control.right <= region.right + 1
          && control.scrollWidth <= control.clientWidth + 1
        )),
      };
    });
    expect(geometry, `${viewport.label} nearby-shop preview is fully contained`).toEqual({
      documentFits: true,
      regionFits: true,
      regionInsidePreview: true,
      controlsFit: true,
    });
  }
});
