import { test, expect } from '@playwright/test';
for (const viewport of [{ width:390, height:844 }, { width:844, height:390 }, { width:820, height:1180 }]) {
  test(`More menu scrolls independently and opens its destination at ${viewport.width}x${viewport.height}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/auth/me', route => route.fulfill({json:{user:{id:'menu-fixture',profileKey:'user:menu-fixture',email:'menu@tracklab.test',name:'Menu Admin',admin:true,membership:{tier:'racer',bikeSeats:4,updatedAt:Date.now()}}}}));
    await page.route('**/api/admin/analytics?*', route => route.fulfill({status:503,json:{error:'Test database unavailable'}}));
    await page.goto('/');
    await page.getByRole('button',{name:'Open App',exact:true}).click();
    await page.getByRole('navigation',{name:'Primary'}).getByRole('button',{name:'More',exact:true}).click();
    const menu=page.locator('.side-nav-more');
    await expect(menu).toBeVisible();
    const measurements=await menu.evaluate(element=>({height:element.clientHeight,content:element.scrollHeight,overflow:getComputedStyle(element).overflowY,chain:getComputedStyle(element).overscrollBehaviorY}));
    expect(measurements.overflow).toBe('auto');expect(measurements.chain).toBe('contain');expect(measurements.height).toBeLessThan(viewport.height);
    if (viewport.width <= 720) {
      const bounds = await menu.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    }
    const pageY=await page.evaluate(()=>scrollY);
    await menu.evaluate(element=>{element.scrollTop=element.scrollHeight;});
    expect(await page.evaluate(()=>scrollY)).toBe(pageY);
    await menu.getByRole('button',{name:'Developer Tools',exact:true}).click();
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'Your app at a glance'})).toBeVisible();
    await expect(page.locator('.platform-main')).toBeFocused();
    const position=await page.locator('.platform-main').boundingBox();
    expect(position!.y).toBeGreaterThanOrEqual(-2);expect(position!.y).toBeLessThan(viewport.height);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}
