import { test, expect, type BrowserContext } from '@playwright/test';

async function register(context: BrowserContext, name: string, email: string) {
  const response = await context.request.post('/api/auth/register', { data: { name, email, password: 'OnboardingTestPassword123' } });
  if (response.status() === 409) {
    const login = await context.request.post('/api/auth/login', { data: { email, password: 'OnboardingTestPassword123' } });
    expect(login.status(), await login.text()).toBe(200); return (await login.json()).user;
  }
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).user;
}

test('a parent claims the existing studio record and sets up a child-only phone', async ({ browser, baseURL }, testInfo) => {
  const owner = await browser.newContext({ baseURL });
  const parent = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const child = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    await register(owner, 'Onboarding Club', 'onboarding-club@tracklab.test');
    const now = Date.now();
    expect((await owner.request.patch('/api/user-data', { data: { studioRiders: [{ id: 'onboarding-child', name: 'Avery Rider', createdAt: now, updatedAt: now }] } })).status()).toBe(200);
    const issued = await owner.request.post('/api/club-connect/invites', { data: { studioRiderId: 'onboarding-child' } });
    expect(issued.status()).toBe(201);
    const token = (await issued.json()).token;
    const page = await parent.newPage();
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/#clubInvite=${token}`);
    await expect(page.getByRole('heading', { name: 'Your studio profile is ready.' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('onboarding-choice.png'), fullPage: true });
    await page.getByRole('button', { name: /I’m the parent or guardian/ }).click();
    await register(parent, 'Avery’s Parent', `onboarding-parent-${now}@tracklab.test`);
    await page.reload();
    const claim = page.getByRole('region', { name: 'Parent athlete claim' });
    await expect(claim).toBeVisible();
    await claim.getByLabel('Child’s name', { exact: true }).fill('Avery Rider');
    await claim.getByRole('checkbox').check();
    await claim.getByRole('button', { name: 'Claim child’s profile', exact: true }).click();
    const setup = page.getByRole('region', { name: 'Avery Rider phone setup' });
    await expect(setup).toBeVisible();
    await setup.getByRole('button', { name: 'Create child-phone setup link' }).click();
    const link = await setup.getByLabel('Private child-phone setup link').inputValue();
    expect(link).toContain('#childDevice=');
    await page.screenshot({ path: testInfo.outputPath('parent-phone-setup.png'), fullPage: true });
    const childPage = await child.newPage();
    childPage.on('pageerror', (error) => errors.push(error.message));
    await childPage.goto(link);
    await expect(childPage.getByRole('heading', { name: 'Set up Avery Rider’s phone' })).toBeVisible();
    await childPage.getByRole('button', { name: 'This is Avery Rider’s phone — continue' }).click();
    await expect(childPage.getByRole('heading', { name: 'Avery Rider', exact: true })).toBeVisible();
    await expect(childPage.getByRole('button', { name: 'Family', exact: true })).toHaveCount(0);
    const identity = (await (await child.request.get('/api/auth/me')).json()).user;
    expect(identity).toMatchObject({ managedChild: true, name: 'Avery Rider', email: '' });
    expect((await (await parent.request.get('/api/auth/me')).json()).user.name).toBe('Avery’s Parent');
    await childPage.screenshot({ path: testInfo.outputPath('child-profile.png'), fullPage: true });
    expect(await childPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await owner.close(); await parent.close(); await child.close(); }
});

test('the same invite onboarding clearly supports an adult claiming their own account', async ({ page, context }) => {
  await page.goto(`/#clubInvite=${'a'.repeat(43)}`);
  await page.getByRole('button', { name: /I’m the athlete/ }).click();
  await register(context, 'Adult Racer', `adult-onboarding-${Date.now()}@tracklab.test`);
  await page.reload();
  await expect(page.getByText('Complete your Club Athlete profile', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete profile and connect' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Parent athlete claim' })).toHaveCount(0);
});
