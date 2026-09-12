import { test, expect } from '@playwright/test';
test('private stadium keeps fixed camera and separates cards through race rotation', async ({page}) => {
  await page.goto('/tests/e2e/fixtures/sprint-rotation.html?stadium');
  await page.waitForSelector('canvas[data-painted="true"]');
  for (const viewport of [{width:1024,height:768},{width:390,height:844},{width:844,height:390},{width:1440,height:900}]) {
    await page.setViewportSize(viewport);
    await expect(page.getByLabel('Private Sprint Stadium')).toHaveAttribute('data-camera','fixed');
    await expect.poll(async()=>page.evaluate(()=>{
      const canvas=document.querySelector('canvas')!;
      const a=canvas.getBoundingClientRect();
      const b=document.querySelector('.private-sprint-scoreboard')!.getBoundingClientRect();
      return a.height>100 && a.bottom<=b.top+1 && b.bottom<=innerHeight+1 && b.right<=innerWidth+1 && canvas.dataset.painted==='true' && canvas.width>0 && Number(canvas.dataset.triangles)>1000;
    })).toBe(true);
    await page.screenshot({path:`/tmp/private-stadium-${viewport.width}.png`});
  }
  await expect(page.locator('[data-arena-adaptive-viewport]')).toHaveCount(0);
});


test('private stadium survives ready, race, finish, reset and a graphics-context loss without resetting race state',async({page})=>{
  await page.goto('/tests/e2e/fixtures/sprint-rotation.html?stadium&ready');
  await page.waitForSelector('canvas[data-painted="true"]');
  const control=async(state:'ready'|'racing'|'finished',distance:number)=>page.evaluate(({state,distance})=>window.dispatchEvent(new CustomEvent('tracklab-test-race',{detail:{state,distance}})),{state,distance});
  await page.getByRole('button',{name:'Inspect rider'}).click();
  await expect(page.getByRole('button',{name:'Course view'})).toBeVisible();
  await control('racing',30);
  await expect(page.getByRole('button',{name:'Course view'})).toHaveCount(0);
  await control('finished',100);
  await expect(page.getByText('P1 · Place 1',{exact:true})).toBeVisible();
  await control('ready',0);
  await expect(page.getByRole('button',{name:'Inspect rider'})).toBeVisible();
  await control('racing',40);
  await page.locator('canvas').dispatchEvent('webglcontextlost');
  await expect(page.getByRole('status')).toContainText('3D graphics paused');
  await expect(page.locator('[data-test-race-state]')).toHaveAttribute('data-test-race-state','racing');
});

test('a missing model reports a graphics error without replacing the active race',async({page})=>{
  await page.route('**/rider.glb*',route=>route.abort());
  await page.goto('/tests/e2e/fixtures/sprint-rotation.html?stadium');
  await expect(page.getByRole('status')).toContainText('could not load');
  await expect(page.locator('[data-test-race-state]')).toHaveAttribute('data-test-race-state','racing');
});
