import { expect, test, type Page } from '@playwright/test';

const jpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==';

async function openSignedInAppIfNeeded(page: Page) {
  const openApp = page.getByRole('button', { name: 'Open App' });
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary' });
  await openApp.or(primaryNavigation).first().waitFor({ state: 'visible', timeout: 15_000 });
  if (await openApp.isVisible()) await openApp.click();
}

test('club owner sees four exact-aspect athlete screens, can enlarge them, and keeps telemetry fallback', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 820, height: 1_180 });
  const createdAt = Date.now();
  let serveFrames = true;
  const riders = Array.from({ length: 4 }, (_, index) => ({
    id: `studio-rider-${index + 1}`,
    name: `Athlete ${index + 1}`,
    createdAt,
    updatedAt: createdAt,
  }));
  const authUser = {
    id: 'mirror-club-owner',
    profileKey: 'user:mirror-club-owner',
    email: 'mirror-owner@tracklab.test',
    name: 'Mirror Club Owner',
    admin: false,
    membership: { tier: 'racer', bikeSeats: 4, updatedAt: createdAt },
  };

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/api/user-data*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: {},
        customRoutes: [],
        bikeProfiles: [],
        studioRiders: riders,
        accountProfile: { updatedAt: createdAt },
      }),
    });
  });
  await page.route('**/api/club-connect*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        canManageClub: true,
        ownedClub: {
          id: 'club-mirror',
          name: 'Mirror Training Club',
          members: riders.map((rider) => ({
            studioRiderId: rider.id,
            riderName: rider.name,
            status: 'claimed',
          })),
        },
        memberships: [],
      }),
    });
  });
  await page.route('**/api/training-sessions*', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessions: [], totals: {} }) });
  });
  await page.route('**/api/club-events/current', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ event: null, pollAfterMs: 2_000 }) });
  });
  await page.route('**/api/club-tablet/devices', async (route) => {
    const checkedAt = Date.now();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        devices: riders.map((_, index) => ({
          id: `tablet-${index + 1}`,
          name: `Studio Tablet ${index + 1}`,
          clubId: 'club-mirror',
          clubName: 'Mirror Training Club',
          createdAt,
          lastSeenAt: checkedAt,
        })),
      }),
    });
  });
  await page.route('**/api/club-live/sessions', async (route) => {
    const sessionNow = Date.now();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: riders.map((rider, index) => ({
          id: `club-mirror:${rider.id}`,
          clubId: 'club-mirror',
          studioRiderId: rider.id,
          riderName: rider.name,
          athleteName: rider.name,
          sessionId: `session-${index + 1}`,
          deviceId: `tablet-${index + 1}`,
          activityType: index === 0 ? 'bmx-race' : index === 1 ? 'straight-sprint' : index === 2 ? 'get-pulled' : 'explore',
          status: index === 1 || index === 2 ? 'paused' : 'active',
          progress: { fraction: 0.2 + index * 0.15, label: `${20 + index * 15}% complete` },
          metrics: {
            watts: 301 + index,
            cadence: 90 + index,
            speedKph: 30 + index,
            distanceMeters: 300 + index * 100,
            elapsedMs: 10_000 + index * 1_000,
            position: index + 1,
            participantCount: 4,
          },
          trackName: `Track ${index + 1}`,
          multiplayer: true,
          updatedAt: sessionNow,
          expiresAt: sessionNow + 60_000,
        })),
      }),
    });
  });
  await page.route('**/api/club-live/frames', async (route) => {
    const frameNow = Date.now();
    const dimensions = [
      [1_280, 720],
      [1_024, 768],
      [844, 390],
      [1_280, 960],
    ];
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        frames: serveFrames ? riders.map((rider, index) => ({
          clubId: 'club-mirror',
          studioRiderId: rider.id,
          riderName: rider.name,
          sessionId: `session-${index + 1}`,
          deviceId: `tablet-${index + 1}`,
          activityType: index === 0 ? 'bmx-race' : index === 1 ? 'straight-sprint' : index === 2 ? 'get-pulled' : 'explore',
          contentType: 'image/jpeg',
          jpegDataUrl,
          width: dimensions[index][0],
          height: dimensions[index][1],
          capturedAt: index === 2 ? frameNow - 7_000 : frameNow,
          updatedAt: index === 2 ? frameNow - 7_000 : frameNow,
          expiresAt: frameNow + 30_000,
          byteLength: 511,
        })) : [],
      }),
    });
  });

  await page.goto('/?track=black-mountain-bmx');
  await openSignedInAppIfNeeded(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /^(?:Club Live Monitor|Studio Tablet Monitor)$/ }).click();

  const monitor = page.getByLabel('Club Live Monitor');
  const liveScreenButtons = monitor.getByRole('button', { name: /Open full-screen live activity screen for Athlete/ });
  await expect(liveScreenButtons).toHaveCount(4);
  await expect(monitor.getByText('Live activity screen', { exact: true })).toHaveCount(2);
  await expect(monitor.getByText('Screen paused', { exact: true })).toBeVisible();
  await expect(monitor.getByText('Screen reconnecting', { exact: true })).toBeVisible();

  const firstBox = await liveScreenButtons.nth(0).boundingBox();
  const secondBox = await liveScreenButtons.nth(1).boundingBox();
  const thirdBox = await liveScreenButtons.nth(2).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(thirdBox).not.toBeNull();
  expect(Math.abs(firstBox!.width / firstBox!.height - 1_280 / 720)).toBeLessThan(0.04);
  expect(secondBox!.x).toBeGreaterThan(firstBox!.x + firstBox!.width - 2);
  expect(Math.abs(thirdBox!.x - firstBox!.x)).toBeLessThan(2);
  expect(thirdBox!.y).toBeGreaterThan(firstBox!.y + firstBox!.height);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(liveScreenButtons.nth(0).locator('img')).toHaveCSS('object-fit', 'contain');

  await liveScreenButtons.nth(0).click();
  const dialog = page.getByRole('dialog', { name: 'Live activity screen for Athlete 1' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Read-only live activity screen', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Full-screen live TrackLab activity screen for Athlete 1' })).toHaveCSS('object-fit', 'contain');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await liveScreenButtons.nth(1).focus();
  await page.keyboard.press('Enter');
  const pausedDialog = page.getByRole('dialog', { name: 'Live activity screen for Athlete 2' });
  await expect(pausedDialog).toBeVisible();
  await expect(pausedDialog.getByText('Screen paused', { exact: true })).toBeVisible();
  await pausedDialog.getByRole('button', { name: 'Close full-screen live activity screen' }).click();
  await expect(pausedDialog).toHaveCount(0);

  await liveScreenButtons.nth(2).click();
  const stalePausedDialog = page.getByRole('dialog', { name: 'Live activity screen for Athlete 3' });
  await expect(stalePausedDialog.getByText('Screen reconnecting', { exact: true })).toBeVisible();
  await expect(stalePausedDialog.getByText('Screen paused', { exact: true })).toHaveCount(0);
  await stalePausedDialog.getByRole('button', { name: 'Close full-screen live activity screen' }).click();

  serveFrames = false;
  await monitor.getByRole('button', { name: 'Refresh Club Live Monitor' }).click();
  await expect(liveScreenButtons).toHaveCount(0);
  await expect(monitor.getByText('301', { exact: true })).toBeVisible();
  await expect(monitor.getByText('watts', { exact: true })).toHaveCount(4);
  await expect(monitor.getByText('Read-only live feed', { exact: true })).toHaveCount(4);
  await expect(monitor.getByRole('button', { name: /Pause|Resume|Stop|Cancel|Control/i })).toHaveCount(0);
});
