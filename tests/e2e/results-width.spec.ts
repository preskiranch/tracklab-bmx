import { test, expect } from '@playwright/test';
test('results use the full viewport and keep session and rider frozen during scrolling', async ({page})=>{
 await page.goto('/tests/e2e/fixtures/results-width.html');
 for(const viewport of [{width:1194,height:834},{width:1440,height:900},{width:390,height:844}]) {
  await page.setViewportSize(viewport);
  const sheet=page.locator('#training-results-outlet .training-results-sheet');
  await expect(sheet).toBeVisible();
  await expect.poll(async()=>sheet.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(viewport.width-40);
  const grid=sheet.locator('.training-results-grid');
  await grid.evaluate(el=>{el.scrollLeft=0;el.scrollTop=0});
  const session=grid.locator('tbody tr').first().locator('[data-column="session"]');
  const rider=grid.locator('tbody tr').first().locator('[data-column="rider"]');
  const before=await rider.boundingBox();
  await grid.evaluate(el=>{el.scrollLeft=650});
  await expect.poll(async()=>Math.abs((await rider.boundingBox())!.x-before!.x)).toBeLessThan(1);
  const s=await session.boundingBox(),r=await rider.boundingBox();
  expect(Math.abs(s!.x+s!.width-r!.x)).toBeLessThan(1);
  await page.screenshot({path:`/tmp/results-width-${viewport.width}.png`,fullPage:true});
 }
});
