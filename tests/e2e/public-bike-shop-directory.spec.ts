import { expect, test } from '@playwright/test';

const searchPoint = { latitude: 38.5816, longitude: -121.4944 };

const nearbyTrack = {
  id: 'river-city-bmx-test-track',
  name: 'River City BMX',
  country: 'United States',
  countryCode: 'US',
  state: 'California',
  region: 'California',
  source: 'Playwright fixture',
  sourceUrl: 'https://example.test/river-city-bmx',
  address: '200 Track Way, Sacramento, CA 95814',
  city: 'Sacramento',
  postalCode: '95814',
  latitude: 38.5892,
  longitude: -121.4760,
  lengthMeters: 350,
  elevationMeters: 0,
  surface: 'Dirt',
  outline: [
    { lat: 38.5891, lng: -121.4761 },
    { lat: 38.5893, lng: -121.4759 },
    { lat: 38.5891, lng: -121.4761 },
  ],
  centerline: [
    { lat: 38.5891, lng: -121.4761 },
    { lat: 38.5893, lng: -121.4759 },
  ],
  startGate: { lat: 38.5891, lng: -121.4761 },
  finishLine: { lat: 38.5893, lng: -121.4759 },
  routeStatus: 'locator-only',
  zones: [],
  leaderboards: { rpm: [], speed: [] },
};

const nearestShop = {
  id: 'osm:node:101',
  name: 'Pedal First Bike Shop',
  latitude: 38.5850,
  longitude: -121.4890,
  distanceMiles: 1.2,
  address: {
    line1: '101 Chainring Avenue',
    locality: 'Sacramento',
    region: 'CA',
    postalCode: '95814',
    countryCode: 'US',
    formatted: '101 Chainring Avenue, Sacramento, CA 95814',
  },
  phone: '+1 (916) 555-0101',
  website: 'https://pedal-first.example/',
  openingHours: 'Mo-Sa 09:00-18:00',
  services: { sales: true, repair: true, rental: false, ebike: true },
  source: {
    provider: 'OpenStreetMap',
    elementType: 'node',
    elementId: '101',
    url: 'https://www.openstreetmap.org/node/101',
  },
  links: {
    maps: 'https://www.google.com/maps/search/?api=1&query=Pedal+First',
    directions: 'https://www.google.com/maps/dir/?api=1&destination=38.585%2C-121.489',
    streetView: 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=38.585%2C-121.489',
  },
};

const fartherShop = {
  ...nearestShop,
  id: 'osm:way:202',
  name: 'Capitol Cycling Works',
  latitude: 38.6300,
  longitude: -121.4400,
  distanceMiles: 6.8,
  phone: 'Ask at the front desk',
  address: {
    ...nearestShop.address,
    line1: '202 Crank Street',
    formatted: '202 Crank Street, Sacramento, CA 95816',
  },
  source: {
    ...nearestShop.source,
    elementType: 'way',
    elementId: '202',
    url: 'https://www.openstreetmap.org/way/202',
  },
};

test.use({
  geolocation: searchPoint,
  permissions: ['geolocation'],
});

test('public bike shop search is useful and contained on phone, tablet, and desktop', async ({ page }) => {
  let authRequests = 0;
  let nearbyRequestCount = 0;
  let nearbyRequest: { method: string; url: string; body: Record<string, unknown> | null } | null = null;

  await page.route('**/api/auth/me', async (route) => {
    authRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: null }),
    });
  });
  await page.route('**/data/track-database.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tracks: [nearbyTrack] }),
    });
  });
  await page.route('**/data/track-locator.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-31T00:00:00.000Z',
        tracks: [nearbyTrack],
      }),
    });
  });
  await page.route('**/api/bike-shops/nearby*', async (route) => {
    nearbyRequestCount += 1;
    const request = route.request();
    const rawBody = request.postData();
    let body: Record<string, unknown> | null = null;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        body = null;
      }
    }
    nearbyRequest = { method: request.method(), url: request.url(), body };
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        origin: { ...searchPoint, radiusMiles: 25 },
        // The server owns exact-distance ordering; the client preserves it
        // even when displayed one-decimal distances happen to tie.
        shops: [nearestShop, fartherShop],
        attribution: {
          text: '© OpenStreetMap contributors',
          url: 'https://www.openstreetmap.org/copyright',
          license: 'ODbL',
        },
      }),
    });
  });

  await page.goto('/#bike-shop-directory');

  const directory = page.locator('#bike-shop-directory');
  await expect(directory).toBeVisible();
  await expect(directory.getByRole('heading', { name: 'Find a bike shop near you' })).toBeVisible();
  await expect(directory.getByText('No TrackLab account is needed to search.')).toBeVisible();
  expect(authRequests).toBeGreaterThan(0);

  const radiusField = directory.locator('.public-bike-shop-directory__radius');
  await expect(radiusField.getByText('Map area', { exact: true })).toBeVisible();
  const radius = radiusField.locator('select');
  await expect(radius.locator('option')).toHaveCount(10);
  expect(await radius.locator('option').evaluateAll((options) => options.map((option) => ({
    label: option.textContent?.trim(),
    value: (option as HTMLOptionElement).value,
  })))).toEqual(Array.from({ length: 10 }, (_, index) => {
    const miles = String((index + 1) * 5);
    return { label: `${miles} miles`, value: miles };
  }));
  await expect(radius).toHaveValue('25');

  await directory.getByRole('button', { name: 'Use current location' }).click();
  await expect(directory.getByText('Loading this map area', { exact: true })).toBeVisible();
  await directory.locator('form').dispatchEvent('submit');
  await expect(directory.getByText('2 mapped bike shops', { exact: true })).toBeVisible();
  expect(nearbyRequestCount, 'Enter/submit while busy does not duplicate the search').toBe(1);
  await expect(directory.getByText('Near Current location · within 25 miles', { exact: true })).toBeVisible();

  expect(nearbyRequest).not.toBeNull();
  expect.soft(nearbyRequest!.method, 'nearby coordinates use the POST contract').toBe('POST');
  expect.soft(new URL(nearbyRequest!.url).search, 'coordinates stay out of the request URL').toBe('');
  const requestBody = nearbyRequest!.body ?? {};
  expect.soft(Number(requestBody.latitude ?? requestBody.lat)).toBeCloseTo(searchPoint.latitude, 4);
  expect.soft(Number(requestBody.longitude ?? requestBody.lng)).toBeCloseTo(searchPoint.longitude, 4);
  expect.soft(requestBody.radiusMiles).toBe(25);

  await radius.selectOption('50');
  await expect(directory.getByText('Near Current location · within 25 miles', { exact: true })).toBeVisible();

  const results = directory.getByRole('list', { name: 'Loaded bike shop listings' }).getByRole('button');
  await expect(results).toHaveCount(2);
  await expect(results.nth(0)).toContainText(nearestShop.name);
  await expect(results.nth(0)).toContainText('1.2 mi');
  await expect(results.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(results.nth(1)).toContainText(fartherShop.name);

  const detail = directory.locator('.public-bike-shop-directory__detail');
  await expect(detail.getByRole('heading', { name: nearestShop.name, exact: true })).toBeVisible();
  await expect(detail.getByText(nearestShop.address.formatted, { exact: true })).toBeVisible();
  await expect(detail.getByText(nearestShop.openingHours, { exact: true })).toBeVisible();
  await expect(detail.getByRole('link', { name: nearestShop.phone })).toHaveAttribute('href', 'tel:+19165550101');
  await expect(detail.getByRole('link', { name: 'Visit shop website' })).toHaveAttribute('href', nearestShop.website);
  await expect(detail.getByText('Bike sales', { exact: true })).toBeVisible();
  await expect(detail.getByText('Repairs', { exact: true })).toBeVisible();
  await expect(detail.getByText('E-bike service', { exact: true })).toBeVisible();

  const mapLinks = directory.getByRole('navigation', { name: `Map links for ${nearestShop.name}` });
  for (const [name, href] of [
    ['Google Maps', nearestShop.links.maps],
    ['Directions', nearestShop.links.directions],
    ['Street View', nearestShop.links.streetView],
  ] as const) {
    const link = mapLinks.getByRole('link', { name });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }

  const nearbyTrackLink = directory.getByRole('link', { name: new RegExp(nearbyTrack.name) });
  await expect(nearbyTrackLink).toBeVisible();
  await expect(nearbyTrackLink).toHaveAttribute(
    'href',
    `/?locator=${nearbyTrack.id}#track-locator`,
  );
  await expect(nearbyTrackLink).not.toHaveAttribute('target', '_blank');

  await results.nth(1).click();
  await expect(detail.getByText(fartherShop.phone, { exact: true })).toBeVisible();
  await expect(detail.getByRole('link', { name: fartherShop.phone, exact: true })).toHaveCount(0);
  await results.nth(0).click();

  for (const viewport of [
    { label: 'iPhone portrait', width: 390, height: 844 },
    { label: 'iPad landscape', width: 1024, height: 768 },
    { label: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await directory.scrollIntoViewIfNeeded();
    const overflowing = await directory.evaluate((element) => {
      const selectors = [
        '.public-bike-shop-directory__inner',
        '.public-bike-shop-directory__search',
        '.public-bike-shop-directory__layout',
        '.public-bike-shop-directory__results',
        '.public-bike-shop-directory__detail',
        '.public-bike-shop-directory__shop-card',
        '.public-bike-shop-directory__map-links',
        '.public-bike-shop-directory__tracks',
      ];
      const targets = [
        { name: 'document', node: document.documentElement },
        { name: 'directory', node: element },
        ...selectors.map((selector) => ({ name: selector, node: element.querySelector(selector) })),
      ];
      return targets.flatMap(({ name, node }) => (
        node && node.scrollWidth > node.clientWidth + 1
          ? [{ name, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }]
          : []
      ));
    });
    expect(overflowing, `${viewport.label} has no horizontal overflow`).toEqual([]);
  }

  const originBeforeTrackNavigation = new URL(page.url()).origin;
  await nearbyTrackLink.click();
  await expect(page).toHaveURL(new RegExp(`\\?locator=${nearbyTrack.id}#track-locator$`));
  expect(new URL(page.url()).origin).toBe(originBeforeTrackNavigation);
  await expect(page.locator('#track-locator').getByRole('heading', {
    name: nearbyTrack.name,
    exact: true,
  })).toBeVisible();
});

test('administrator claim review exposes canonical sources and paginates the full queue', async ({ page }) => {
  const authUser = {
    id: 'bike-shop-review-admin',
    profileKey: 'user:bike-shop-review-admin',
    email: 'directory-admin@example.com',
    name: 'Directory Admin',
    admin: true,
    membership: { tier: 'spectator', bikeSeats: 1, updatedAt: Date.now() },
  };
  const claims = Array.from({ length: 28 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    source: 'openstreetmap',
    osmElementType: 'node',
    osmElementId: String(index + 101),
    shopName: `Review Shop ${String(index + 1).padStart(2, '0')}`,
    latitude: 38.5,
    longitude: -121.5,
    claimantRole: 'owner',
    verificationMethod: 'business-email',
    businessEmail: `owner${index + 1}@example.com`,
    businessPhone: '',
    verificationNote: '',
    status: 'pending',
    reviewNote: '',
    reviewedAt: null,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    claimant: { displayName: `Owner ${index + 1}`, email: `owner${index + 1}@example.com` },
  }));
  const requestedOffsets: number[] = [];

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/data/track-database.json', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tracks: [] }) });
  });
  await page.route('**/data/track-locator.json', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tracks: [] }) });
  });
  await page.route('**/api/bike-shops/claim-requests', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ claims: [] }) });
  });
  await page.route('**/api/admin/bike-shop-claims?*', async (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 25);
    requestedOffsets.push(offset);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: claims.slice(offset, offset + limit),
        total: claims.length,
        offset,
        limit,
        status: 'pending',
      }),
    });
  });

  await page.goto('/#bike-shop-directory');
  const review = page.locator('section[aria-labelledby="bike-shop-review-queue-title"]');
  await expect(review).toBeVisible();
  await expect(review.getByText('Showing 1–25 of 28', { exact: true })).toBeVisible();
  await expect(review.getByRole('listitem')).toHaveCount(25);
  const firstSource = review.getByRole('link', { name: 'OpenStreetMap node 101' });
  await expect(firstSource).toHaveAttribute('href', 'https://www.openstreetmap.org/node/101');
  await expect(firstSource).toHaveAttribute('target', '_blank');

  await page.setViewportSize({ width: 390, height: 844 });
  await review.scrollIntoViewIfNeeded();
  const reviewWidths = await review.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(reviewWidths.scrollWidth, 'administrator review stays within an iPhone portrait viewport')
    .toBeLessThanOrEqual(reviewWidths.clientWidth + 1);

  await review.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(review.getByText('Showing 26–28 of 28', { exact: true })).toBeVisible();
  await expect(review.getByRole('listitem')).toHaveCount(3);
  await expect(review.getByText('Review Shop 26', { exact: true })).toBeVisible();
  expect(requestedOffsets).toContain(25);

  await review.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(review.getByText('Showing 1–25 of 28', { exact: true })).toBeVisible();
});
