import { expect, test } from '@playwright/test';

test('student room microphone pauses through the final tone and preserves manual mute', async ({ page }) => {
  test.setTimeout(120000);
  page.on('pageerror', error => console.log('PAGE ERROR', error.message));
  page.on('requestfailed', request => console.log('FAILED REQUEST', request.url(), request.failure()));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => {
    const track = { requested: false, enabled: true, stopped: false, stop() { this.stopped = true; } };
    Object.assign(window, { testMicrophoneTrack: track });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { track.requested = true; return { getTracks: () => [track], getAudioTracks: () => [track] }; } } });
  });
  await page.goto('/tests/e2e/fixtures/student-room.html');
  await page.getByRole('button', { name: 'Join club Race Intervals room' }).click();
  await expect(page.getByRole('button', { name: 'Enable microphone' })).toBeVisible();
  await page.getByRole('button', { name: 'Enable microphone' }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible({ timeout: 45000 });
  const micEnabled = () => page.evaluate(() => (window as any).testMicrophoneTrack.enabled);
  await expect.poll(micEnabled).toBe(true);
  await page.getByRole('button', { name: 'Test cadence', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect.poll(micEnabled).toBe(false);
  await page.getByRole('button', { name: 'Test final tone', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await page.waitForTimeout(500); // Green UI ends earlier than the actual 2.25-second tone.
  expect(await micEnabled()).toBe(false);
  await expect.poll(micEnabled).toBe(true);
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await page.getByRole('button', { name: 'Test cadence', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await page.getByRole('button', { name: 'Test final tone', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.getByText('Microphone muted · you can still hear the room.', { exact: false })).toBeVisible();
  expect(await micEnabled()).toBe(false);
  await page.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
  await expect.poll(micEnabled).toBe(true);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => el.tagName + '.' + el.className) }))).toMatchObject({ width: viewport.width, scroll: viewport.width });
    await page.screenshot({ path: `/tmp/student-room-${viewport.width}.png` });
  }
  await page.getByRole('button', { name: 'Race solo', exact: true }).click();
  expect(await page.evaluate(() => (window as any).testMicrophoneTrack.stopped)).toBe(true);
});
