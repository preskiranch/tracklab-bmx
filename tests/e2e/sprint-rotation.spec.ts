import { test, expect } from '@playwright/test';
test('sprint course remains separate from rider cards while rotating mid-race', async ({page}) => {
  await page.goto('/tests/e2e/fixtures/sprint-rotation.html');
  for (const viewport of [{width:390,height:844},{width:844,height:390},{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => page.evaluate(() => {
      const course = document.querySelector('[data-arena-adaptive-viewport]')!.getBoundingClientRect();
      const hud = document.querySelector('.game-arena-hud')!.getBoundingClientRect();
      return course.height > 100 && course.bottom <= hud.top + 1 && Math.abs(hud.bottom - innerHeight) <= 1 && hud.left >= 0 && hud.right <= innerWidth + 1;
    })).toBe(true);
    await page.screenshot({path:`/tmp/sprint-rotation-${viewport.width}.png`});
  }
});
