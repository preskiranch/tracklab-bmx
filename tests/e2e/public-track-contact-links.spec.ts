import { expect, test } from '@playwright/test';

const contactTrack = {
  id: 'contact-link-test-track',
  name: 'Clean Links BMX',
  country: 'United States',
  countryCode: 'US',
  state: 'California',
  region: 'California',
  source: 'Verified test directory',
  address: '123 Start Hill, Napa, CA 94558',
  city: 'Napa',
  postalCode: '94558',
  latitude: 38.2975,
  longitude: -122.2869,
  facebookUrl: 'https://www.facebook.com/cleanlinksbmx',
  instagramUrl: 'https://www.instagram.com/cleanlinksbmx',
  tiktokUrl: 'https://www.tiktok.com/@cleanlinksbmx',
  youtubeUrl: 'https://www.youtube.com/@cleanlinksbmx',
  phoneNumber: '+1 (555) 123-4567',
  federationName: 'USA BMX',
  federationUrl: 'https://www.usabmx.com/',
};

const noContactTrack = {
  ...contactTrack,
  id: 'no-contact-test-track',
  name: 'No Contact BMX',
  latitude: 38.31,
  longitude: -122.3,
  facebookUrl: undefined,
  instagramUrl: undefined,
  tiktokUrl: undefined,
  youtubeUrl: undefined,
  phoneNumber: undefined,
  federationName: undefined,
  federationUrl: undefined,
};

test('track contacts and map actions stay clear, callable, and responsive', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: null }) });
  });
  await page.route('**/data/track-locator.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-23T00:00:00.000Z',
        tracks: [contactTrack, noContactTrack],
      }),
    });
  });

  await page.goto(`/?locator=${contactTrack.id}`);

  const locator = page.locator('#track-locator');
  await locator.getByLabel('Search tracks').fill(contactTrack.name);
  await expect(locator.getByText('1 found', { exact: true })).toBeVisible();
  const contacts = locator.getByRole('navigation', {
    name: `Social and contact links for ${contactTrack.name}`,
  });
  await expect(contacts).toBeVisible();
  await expect(contacts.getByRole('link', { name: 'Facebook' })).toHaveAttribute(
    'href',
    contactTrack.facebookUrl,
  );
  await expect(contacts.getByRole('link', { name: 'Instagram' })).toHaveAttribute(
    'href',
    contactTrack.instagramUrl,
  );
  await expect(contacts.getByRole('link', { name: 'TikTok' })).toHaveAttribute('href', /tiktok\.com\/\@cleanlinksbmx/);
  await expect(contacts.getByRole('link', { name: 'YouTube' })).toHaveAttribute('href', /youtube\.com\/\@cleanlinksbmx/);
  await expect(contacts.getByRole('link', { name: 'Facebook' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(contacts.getByRole('link', { name: 'Instagram' })).toHaveAttribute('rel', 'noopener noreferrer');
  const phoneLink = contacts.getByRole('link', { name: `Call ${contactTrack.name} at ${contactTrack.phoneNumber}` });
  await expect(phoneLink).toHaveAttribute('href', 'tel:+15551234567');
  await expect(phoneLink).not.toHaveAttribute('target', '_blank');

  const directions = locator.getByRole('group', { name: `Directions to ${contactTrack.name}` });
  await expect(directions.getByText('Directions', { exact: true })).toBeVisible();
  await expect(directions.getByRole('link', { name: 'Google Maps' })).toHaveAttribute('href', /google\.com\/maps\/dir\/.*destination=/);
  await expect(directions.getByRole('link')).toHaveCount(1);

  const earth = locator.getByRole('group', { name: 'Explore in 3D—not directions' });
  await expect(earth.getByText('Explore in 3D', { exact: true })).toBeVisible();
  await expect(earth.getByRole('link', { name: /Google Earth—not turn-by-turn directions/ })).toHaveAttribute(
    'href',
    /earth\.google\.com/,
  );
  await expect(earth.getByText('3D exploration—not turn-by-turn directions.')).toBeVisible();
  await expect(directions.getByRole('link', { name: /Google Earth/ })).toHaveCount(0);

  const actionTargets = locator.locator(
    '.public-track-official-links a, .public-track-actions a, .public-track-actions button',
  );
  const desktopTargetHeights = await actionTargets.evaluateAll((links) => (
    links.map((link) => Math.round(link.getBoundingClientRect().height))
  ));
  expect(desktopTargetHeights.every((height) => height >= 44)).toBe(true);
  const desktopGeometry = await locator.evaluate((element) => {
    const layout = element.querySelector<HTMLElement>('.public-locator-layout');
    const map = element.querySelector<HTMLElement>('.public-track-map');
    const preview = element.querySelector<HTMLElement>('.public-locator-preview');
    const details = element.querySelector<HTMLElement>('.public-track-details');
    if (!layout || !map || !preview || !details) throw new Error('Public locator layout is incomplete');
    return {
      actionControlRows: [...element.querySelectorAll<HTMLElement>('.public-track-link-group')]
        .map((group) => new Set([...group.querySelectorAll<HTMLElement>('.public-track-actions > *')]
          .map((control) => Math.round(control.getBoundingClientRect().top))).size),
      detailsBottom: details.getBoundingClientRect().bottom,
      layoutHeight: layout.getBoundingClientRect().height,
      layoutFits: layout.scrollWidth <= layout.clientWidth + 1 && layout.scrollHeight <= layout.clientHeight + 1,
      mapHeight: map.getBoundingClientRect().height,
      officialLinkHeights: [...element.querySelectorAll<HTMLElement>('.public-track-official-links a')]
        .map((link) => Math.round(link.getBoundingClientRect().height)),
      officialLinkRows: new Set([...element.querySelectorAll<HTMLElement>('.public-track-official-links a')]
        .map((link) => Math.round(link.getBoundingClientRect().top))).size,
      previewBottom: preview.getBoundingClientRect().bottom,
      previewFits: preview.scrollWidth <= preview.clientWidth + 1,
    };
  });
  expect(desktopGeometry.mapHeight).toBeGreaterThanOrEqual(460);
  expect(desktopGeometry.layoutHeight).toBeLessThanOrEqual(820);
  expect(desktopGeometry.layoutFits).toBe(true);
  expect(desktopGeometry.previewFits).toBe(true);
  expect(desktopGeometry.officialLinkRows).toBe(2);
  expect(desktopGeometry.officialLinkHeights.every((height) => height === 44)).toBe(true);
  expect(desktopGeometry.actionControlRows.every((rows) => rows === 1)).toBe(true);
  expect(desktopGeometry.detailsBottom).toBeLessThanOrEqual(desktopGeometry.previewBottom + 1);

  for (const viewport of [
    { width: 560, height: 900 },
    { width: 561, height: 900 },
    { width: 721, height: 900 },
    { width: 768, height: 1024 },
    { width: 900, height: 700 },
    { width: 1024, height: 768 },
    { width: 1200, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await locator.scrollIntoViewIfNeeded();
    await expect(earth.getByRole('link', { name: /Google Earth—not turn-by-turn directions/ })).toBeVisible();
    const [layoutBox, earthBox] = await Promise.all([
      locator.locator('.public-locator-layout').boundingBox(),
      earth.boundingBox(),
    ]);
    expect(layoutBox).not.toBeNull();
    expect(earthBox).not.toBeNull();
    expect(earthBox!.y + earthBox!.height).toBeLessThanOrEqual(layoutBox!.y + layoutBox!.height + 1);
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      preview: (() => {
        const element = document.querySelector('.public-locator-preview');
        return element ? element.scrollWidth - element.clientWidth : 1;
      })(),
    }));
    expect(overflow).toEqual({ document: 0, preview: 0 });
    const responsiveTargets = await actionTargets.evaluateAll((controls) => controls.map((control) => ({
      controlHeight: control.getBoundingClientRect().height,
      iconWidths: [...control.querySelectorAll('svg')].map((icon) => icon.getBoundingClientRect().width),
    })));
    expect(responsiveTargets.every(({ controlHeight }) => controlHeight >= 44)).toBe(true);
    if ([561, 768, 1024].includes(viewport.width)) {
      expect(responsiveTargets.every(({ iconWidths }) => (
        iconWidths.length > 0 && iconWidths.every((width) => width >= 15)
      ))).toBe(true);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await locator.scrollIntoViewIfNeeded();
  for (const selector of ['.public-track-official-links', '.public-track-link-groups']) {
    const fits = await locator.locator(selector).evaluate((element) => element.scrollWidth <= element.clientWidth);
    expect(fits).toBe(true);
  }
  const mobileTargetHeights = await actionTargets.evaluateAll((links) => (
    links.map((link) => Math.round(link.getBoundingClientRect().height))
  ));
  expect(mobileTargetHeights.every((height) => height >= 44)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await locator.getByLabel('Search tracks').fill(noContactTrack.name);
  await locator.getByRole('button', { name: new RegExp(noContactTrack.name) }).click();
  await expect(locator.getByRole('heading', { name: noContactTrack.name })).toBeVisible();
  await expect(locator.getByRole('navigation', { name: /Social and contact links/ })).toHaveCount(0);
  await expect(locator.getByRole('link', { name: 'Facebook' })).toHaveCount(0);
  await expect(locator.getByRole('link', { name: 'Instagram' })).toHaveCount(0);
  await expect(locator.getByRole('link', { name: 'TikTok' })).toHaveCount(0);
  await expect(locator.getByRole('link', { name: 'YouTube' })).toHaveCount(0);
  await expect(locator.getByRole('link', { name: /^Call / })).toHaveCount(0);
  await expect(locator.getByRole('group', { name: `Directions to ${noContactTrack.name}` })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`locator=${noContactTrack.id}`));
});
