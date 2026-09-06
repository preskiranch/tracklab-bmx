import { expect, test, type Page } from '@playwright/test';

const token = 'testBetaInvitationToken'.repeat(2);
const invite = {
  id: 'beta-invite-fixture', email: 'tester@example.com', bikeSeats: 4, durationDays: 90,
  createdAt: Date.now(), expiresAt: Date.now() + 604800000, revokedAt: null, claimedAt: null,
};
const grant = { id: 'beta-grant-fixture', active: true, bikeSeats: 4, revokedAt: null, expiresAt: Date.now() + 7776000000 };

async function fixture(page: Page, { admin = false, signedIn = true } = {}) {
  let user: any = signedIn ? {
    id: 'beta-user-fixture', profileKey: 'user:beta-user-fixture', email: admin ? 'owner@example.com' : invite.email,
    name: admin ? 'Beta Owner Preview' : 'Beta Tester Preview', admin,
    membership: { tier: admin ? 'racer' : 'spectator', bikeSeats: admin ? 4 : 1, updatedAt: Date.now() },
  } : null;
  let active = false;
  let invites: any[] = [];
  let rejectClaim = false;
  const writes: Array<{ path: string; body: any }> = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { (window as any).__copiedBetaLink = value; },
    } });
  });
  await page.context().routeWebSocket(/.*/, (socket) => socket.close());
  await page.route('**/api/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const method = request.method();
    const body = ['GET', 'HEAD'].includes(method) ? null : request.postDataJSON();
    if (body) writes.push({ path, body });
    let result: unknown = { ok: true };
    let status = 200;
    if (path === '/api/auth/me') result = { user };
    else if (path === '/api/auth/register') {
      user = { id: 'beta-user-fixture', profileKey: 'user:beta-user-fixture', email: body.email,
        name: body.name, admin: false, membership: { tier: 'spectator', bikeSeats: 1, updatedAt: Date.now() } };
      result = { user };
    } else if (path === '/api/beta-access') result = { beta: active ? grant : null };
    else if (path === '/api/admin/beta-access') result = { invites, grants: [] };
    else if (path === '/api/admin/beta-access/invites') {
      const created = { ...invite, ...body };
      invites = [created];
      result = { invite: created, claimUrl: `${new URL(request.url()).origin}/#betaInvite=${token}` };
      status = 201;
    } else if (path === '/api/admin/beta-access/revoke') {
      invites = invites.map((item) => ({ ...item, revokedAt: Date.now() }));
    } else if (path === '/api/beta-access/accept') {
      if (rejectClaim) { status = 403; result = { error: 'Use the email address on your invitation.' }; }
      else {
        active = true;
        user = { ...user, membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() } };
        result = { beta: grant, user };
      }
    } else if (path.startsWith('/api/user-data')) result = { trackMappings: {}, customRoutes: [], bikeProfiles: [], studioRiders: [], accountProfile: { updatedAt: Date.now() } };
    else if (path === '/api/public-track-mappings') result = { trackMappings: {}, count: 0 };
    else if (path.startsWith('/api/club-connect')) result = { memberships: [], ownedClub: null, canManageClub: false };
    else if (path.startsWith('/api/friends')) result = path.endsWith('/privacy') ? { privacy: { discoverable: false, profile: { id: user?.id, handle: 'beta.preview', displayName: user?.name } } } : { items: [], nextCursor: null, total: 0, incomingTotal: 0, outgoingTotal: 0 };
    else if (path.startsWith('/api/ghosts')) result = { ghosts: [] };
    else if (path === '/api/commentary/config') result = { aiAvailable: false };
    else if (path === '/api/auth/websocket-ticket') { status = 401; result = { error: 'Isolated fixture has no live socket.' }; }
    else if (path.startsWith('/api/recovery-alert')) result = { accountId: `recacct_${'a'.repeat(32)}`, episode: null, preference: { mode: 'off', timerSeconds: 300, targetBpm: 115, minimumSeconds: 60, maximumSeconds: 600, updatedAt: Date.now() } };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());
  return { writes, errors, rejectClaim: (reject: boolean) => { rejectClaim = reject; } };
}

async function openBetaSettings(page: Page) {
  const openApp = page.getByRole('button', { name: 'Open App', exact: true });
  if (await openApp.isVisible()) await openApp.click();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: 'More', exact: true }).click();
  await nav.getByRole('button', { name: 'Beta Testing', exact: true }).click();
  await expect(page.locator('#beta-testing')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Beta Testing', exact: true })).toBeInViewport();
}

for (const viewport of [{ name: 'iPad', width: 1280, height: 960 }, { name: 'iPhone', width: 390, height: 844 }]) {
  test(`beta owner creates and revokes a personal invite on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = await fixture(page, { admin: true });
    await page.goto('/?room=old-public-room');
    await expect(page.getByRole('region', { name: 'Race Together: Coming soon' })).toBeVisible();
    await openBetaSettings(page);
    const panel = page.locator('#beta-testing');
    await panel.getByLabel('Tester email', { exact: true }).fill(invite.email);
    await panel.getByRole('button', { name: 'Create invitation', exact: true }).click();
    await expect(panel.getByLabel('Personal invitation link')).toHaveValue(new RegExp(`#betaInvite=${token}$`));
    await panel.getByRole('button', { name: 'Copy link', exact: true }).click();
    expect(await page.evaluate(() => (window as any).__copiedBetaLink)).toMatch(new RegExp(`#betaInvite=${token}$`));
    expect(state.writes.filter((write) => write.path === '/api/admin/beta-access/invites')).toEqual([
      { path: '/api/admin/beta-access/invites', body: { email: invite.email, bikeSeats: 4, durationDays: 90 } },
    ]);
    await expect(panel.getByRole('link', { name: 'Send beta feedback' })).toHaveAttribute('href', /^mailto:preskiranch@gmail.com\?subject=/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`beta-admin-${viewport.name}.png`) });
    await panel.getByRole('button', { name: `Revoke invitation for ${invite.email}` }).click();
    await expect(panel.getByText(/Revoked · 4 bikes/)).toBeVisible();
    expect(state.writes.filter((write) => write.path === '/api/admin/beta-access/revoke')).toEqual([
      { path: '/api/admin/beta-access/revoke', body: { inviteId: invite.id } },
    ]);
    expect(state.errors).toEqual([]);
  });
}

test('beta invitation survives account creation, handles denial, and activates solo racer access', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, { signedIn: false });
  await page.goto(`/#betaInvite=${token}`);
  const dialog = page.getByRole('dialog', { name: 'Test TrackLab BMX' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Create account or sign in' }).click();
  const profile = page.getByRole('region', { name: 'Required profile' });
  await profile.getByLabel('Name', { exact: true }).fill('Beta Tester Preview');
  await profile.getByLabel('Email', { exact: true }).fill(invite.email);
  await profile.getByLabel('Password', { exact: true }).fill('BetaTestPassword123');
  await profile.locator('button[type="submit"]').click();
  await expect(dialog.getByText(invite.email, { exact: true })).toBeVisible();
  state.rejectClaim(true);
  await dialog.getByRole('button', { name: 'Activate beta access' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Use the email address on your invitation.');
  state.rejectClaim(false);
  await dialog.screenshot({ path: testInfo.outputPath('beta-invitation-phone.png') });
  await dialog.getByRole('button', { name: 'Activate beta access' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/betaInvite/);
  await expect(page.getByRole('region', { name: 'Race Together: Coming soon' })).toBeVisible();
  await expect(page.locator('.analytics-panel')).toContainText('Post-race analysis');
  await openBetaSettings(page);
  await expect(page.getByText('4 Wattbike connections included', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Invite a tester', exact: true })).toHaveCount(0);
  await page.locator('#beta-testing').screenshot({ path: testInfo.outputPath('beta-tester-phone.png') });
  expect(state.errors).toEqual([]);
});
