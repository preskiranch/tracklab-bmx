import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const invitationToken = 'f'.repeat(43);
const clubToken = 'c'.repeat(43);
type FixtureChild = { id: string; kind: 'managed' | 'linked'; name: string; createdAt: number; updatedAt: number; permissions: { activity: true; health: false } };
const child = (id: string, name: string, kind: FixtureChild['kind'] = 'managed'): FixtureChild => ({
  id, name, kind, createdAt: 100, updatedAt: 200, permissions: { activity: true, health: false },
});

async function fixture(page: Page, { signedIn = true, initialChildren = true } = {}) {
  let user: any = signedIn ? {
    id: 'family-parent-fixture', profileKey: 'user:family-parent-fixture',
    email: 'family-parent@example.com', name: 'Family Parent', admin: false,
    membership: { tier: 'spectator', bikeSeats: 1, updatedAt: Date.now() },
  } : null;
  let children = initialChildren ? [child('child-one', 'Avery'), child('child-two', 'Elliot')] : [];
  let archivedChildren: FixtureChild[] = [];
  let invitations: any[] = [];
  let sharedWith: any[] = [];
  const blocked = new Set<string>();
  let rejectAcceptance = false;
  let sparseCappedChild: string | null = null;
  let heldChild: string | null = null;
  let releaseHistory: (() => void) | null = null;
  const writes: Array<{ path: string; body: any; method: string }> = [];
  const reads: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { (window as any).__copiedFamilyLink = value; },
    } });
  });
  await page.context().routeWebSocket(/.*/, (socket) => socket.close());
  // All API reads and writes are local fixtures. No real accounts, invitations,
  // athlete records, or permissions are created or modified by these tests.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = ['GET', 'HEAD'].includes(method) ? null : request.postDataJSON();
    if (method === 'GET') reads.push(`${path}${url.search}`);
    else writes.push({ path, body, method });
    let result: unknown = { ok: true };
    let status = 200;
    if (path === '/api/auth/me') result = { user };
    else if (path === '/api/auth/login' || path === '/api/auth/register') {
      user = { id: 'family-athlete-fixture', profileKey: 'user:family-athlete-fixture', email: body.email,
        name: 'Linked Athlete', admin: false, membership: { tier: 'spectator', bikeSeats: 1, updatedAt: Date.now() } };
      result = { user };
    } else if (path === '/api/family') result = { children, archivedChildren, invitations, sharedWith };
    else if (path === '/api/family/children' && method === 'POST') {
      const created = child(`child-${children.length + 1}`, body.name);
      children.push(created); result = { child: created }; status = 201;
    } else if (path === '/api/family/link-invites' && method === 'POST') {
      const invite = { id: 'family-invite-fixture', expiresAt: Date.now() + 604_800_000, claimedAt: null, revokedAt: null };
      invitations = [invite];
      result = { invite, claimUrl: `${url.origin}/#familyInvite=${invitationToken}` }; status = 201;
    } else if (path === '/api/family/link-invites/preview') result = {
      invite: { id: 'family-invite-fixture', expiresAt: Date.now() + 604_800_000, claimedAt: null, revokedAt: null },
      parentName: 'Parent Guardian', canAccept: true,
    };
    else if (path === '/api/family/link-invites/accept') {
      if (rejectAcceptance) { status = 409; result = { error: 'This invitation has been revoked.' }; }
      else {
        sharedWith = [{ id: 'shared-family-fixture', parentName: 'Parent Guardian', createdAt: 200, permissions: { activity: true, health: false } }];
        result = { ok: true, parentName: 'Parent Guardian' };
      }
    } else if (/^\/api\/family\/(shared-with|link-invites)\//.test(path) && method === 'DELETE') {
      sharedWith = []; invitations = invitations.map((invite) => ({ ...invite, revokedAt: Date.now() }));
    } else if (path.startsWith('/api/family/children/')) {
      const childId = path.split('/')[4];
      const subject = children.find((candidate) => candidate.id === childId);
      const archived = archivedChildren.find((candidate) => candidate.id === childId);
      if (path.endsWith('/restore') && method === 'POST' && archived) {
        children.push(archived); archivedChildren = archivedChildren.filter((candidate) => candidate.id !== childId); result = { child: archived };
      } else if (!subject || blocked.has(childId)) { status = 404; result = { error: 'Family access ended. Refresh the family list.' }; }
      else if (method === 'DELETE') {
        if (subject.kind === 'managed') archivedChildren.push(subject);
        children = children.filter((candidate) => candidate.id !== childId);
      }
      else if (path.endsWith('/profile') || path.endsWith('/club-claim')) result = {
        child: subject, healthAvailable: false,
        accountProfile: { updatedAt: 200, personalRecords: { reactionTestBestMs: childId === 'child-one' ? 180 : 260, getPulledMaxWatts: childId === 'child-one' ? 720 : 530 } },
        memberships: [{ clubId: 'club-fixture', clubName: 'Training Club', studioRiderId: `studio-${childId}`, riderName: subject.name, claimedAt: 100 }],
      };
      else if (path.endsWith('/training-sessions')) {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        const startedAt = date.getTime();
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        const sessions = startedAt >= from && startedAt <= to ? ['bmx-race', 'straight-sprint', 'explore', 'get-pulled', 'monitor-sprint'].map((activityType, index) => ({
          id: `${childId}-${activityType}`, activityType, title: `${subject.name} ${activityType} fixture`,
          startedAt: startedAt + index * 60_000, endedAt: startedAt + index * 60_000 + 6_000,
          durationMs: 6_000, distanceMeters: 100, source: 'live', createdAt: startedAt, updatedAt: startedAt,
          details: { durationSeconds: 6, airSetting: 5,
            summaries: [{ playerId: 1, riderId: `studio-${childId}`, riderName: subject.name, rank: 1, finishTimeMs: 6_000, averageWatts: 300, topWatts: 500, averageCadence: 100, topCadence: 130 }],
            riders: [{ playerId: 1, riderId: `studio-${childId}`, riderName: subject.name, resultStatus: 'finished', distanceMeters: 100, averageWatts: 300, peakWatts: 500, averageCadence: 100, peakCadence: 130 }],
            healthKit: { bpm: 199, device: 'Private health fixture must not appear' } },
        })) : [];
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() - 1;
        const rangeComplete = !(sparseCappedChild === childId && from <= monthStart && to >= monthEnd);
        result = { child: subject, sessions: rangeComplete ? sessions : [], rangeComplete, healthAvailable: false, totals: { sessions: 999 } };
        if (heldChild === childId) {
          heldChild = null;
          await new Promise<void>((resolve) => { releaseHistory = resolve; });
        }
      }
    } else if (path === '/api/beta-access') result = { beta: null };
    else if (path.startsWith('/api/user-data')) result = { trackMappings: {}, customRoutes: [], bikeProfiles: [], studioRiders: [], accountProfile: { updatedAt: Date.now() } };
    else if (path === '/api/public-track-mappings') result = { trackMappings: {}, count: 0 };
    else if (path.startsWith('/api/club-connect')) result = { memberships: [], ownedClub: null, canManageClub: false };
    else if (path.startsWith('/api/friends')) result = path.endsWith('/privacy')
      ? { privacy: { discoverable: false, profile: { id: user?.id, handle: 'family.parent', displayName: user?.name } } }
      : { items: [], nextCursor: null, total: 0, incomingTotal: 0, outgoingTotal: 0 };
    else if (path.startsWith('/api/ghosts')) result = { ghosts: [] };
    else if (path === '/api/commentary/config') result = { aiAvailable: false };
    else if (path === '/api/auth/websocket-ticket') { status = 401; result = { error: 'Isolated fixture has no live socket.' }; }
    else if (path.startsWith('/api/recovery-alert')) result = {
      accountId: `recacct_${'a'.repeat(32)}`, episode: null,
      preference: { mode: 'off', timerSeconds: 300, targetBpm: 115, minimumSeconds: 60, maximumSeconds: 600, updatedAt: Date.now() },
    };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) }).catch(() => undefined);
  });
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());
  return {
    writes, reads, errors,
    deny: (id: string) => { blocked.add(id); children = children.filter((candidate) => candidate.id !== id); },
    hold: (id: string) => { heldChild = id; },
    historyIsHeld: () => releaseHistory != null,
    release: () => { releaseHistory?.(); releaseHistory = null; },
    rejectAcceptance: (value: boolean) => { rejectAcceptance = value; },
    sparseCappedMonth: (id: string) => { sparseCappedChild = id; },
  };
}

async function openFamily(page: Page) {
  const openApp = page.getByRole('button', { name: 'Open App', exact: true });
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(openApp.or(nav).first()).toBeVisible();
  if (await openApp.isVisible()) await openApp.click();
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: 'More', exact: true }).click();
  await nav.getByRole('button', { name: 'Family', exact: true }).click();
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => (
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth + 1
  ))).toBe(true);
}

for (const viewport of [
  { name: 'iPhone', width: 390, height: 844 },
  { name: 'iPad', width: 1024, height: 1366 },
  { name: 'desktop', width: 1440, height: 1000 },
]) {
  test(`a free parent can switch separate athlete records and activities on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = await fixture(page);
    await page.goto('/');
    await openFamily(page);
    await expect(page.getByRole('heading', { name: 'Their progress. One place.', exact: true })).toBeVisible();
    const profiles = page.getByRole('group', { name: 'Family profiles' });
    await profiles.getByRole('button', { name: /Avery/ }).click();
    const avery = page.getByRole('region', { name: "Avery's activity history", exact: true });
    await expect(avery).toContainText('0.180 sec');
    await expect(avery).toContainText('720 W');
    await expect(avery.getByRole('region', { name: "Avery's monthly statistics" })).toContainText('5');
    await expect(avery.getByRole('region', { name: 'Training results spreadsheet' })).toContainText('5 saved sessions');
    for (const activity of ['BMX Race', 'Straight Sprint', 'Explore', 'Get Pulled', 'Monitor Sprint']) {
      await expect(avery.getByRole('cell', { name: activity, exact: true })).toBeVisible();
    }
    await expect(avery).not.toContainText('Private health fixture must not appear');
    await expect(avery).toContainText('Apple Watch and other health data are not shared');
    await expectNoHorizontalOverflow(page);
    await avery.getByRole('heading', { name: 'Avery', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`family-${viewport.name}.png`) });

    await profiles.getByRole('button', { name: /Elliot/ }).click();
    const elliot = page.getByRole('region', { name: "Elliot's activity history", exact: true });
    await expect(avery).toHaveCount(0);
    await expect(elliot).toContainText('0.260 sec');
    await expect(elliot).toContainText('530 W');
    await expect(elliot.getByRole('region', { name: 'Training results spreadsheet' })).toContainText('5 saved sessions');
    await expect(elliot).not.toContainText('Avery');
    await expect(profiles.getByRole('button', { name: /Elliot/ })).toHaveAttribute('aria-pressed', 'true');
    await expectNoHorizontalOverflow(page);

    await elliot.getByRole('button', { name: 'Previous month', exact: true }).click();
    await expect(elliot).toContainText('No saved activity records for this child in this month.');
    await expect(elliot.getByRole('button', { name: 'Numbers / Excel', exact: true })).toBeDisabled();
    await elliot.getByRole('button', { name: 'Next month', exact: true }).click();
    await expect(elliot.getByRole('region', { name: "Elliot's monthly statistics" })).toContainText('5');
    expect(state.writes.filter((write) => write.path.startsWith('/api/family'))).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test('a delayed sibling response cannot replace the currently selected child', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/');
  await openFamily(page);
  state.hold('child-one');
  const profiles = page.getByRole('group', { name: 'Family profiles' });
  await profiles.getByRole('button', { name: /Avery/ }).click();
  await expect.poll(state.historyIsHeld).toBe(true);
  await profiles.getByRole('button', { name: /Elliot/ }).click();
  const current = page.getByRole('region', { name: "Elliot's activity history", exact: true });
  await expect(current.getByRole('region', { name: 'Training results spreadsheet' })).toContainText('5 saved sessions');
  state.release();
  await expect(current).toContainText('0.260 sec');
  await expect(current).not.toContainText('Avery');
  await expect(page.getByRole('region', { name: "Avery's activity history", exact: true })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('an export rechecks permission and clears a revoked child instead of downloading stale records', async ({ page }) => {
  const state = await fixture(page);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.goto('/');
  await openFamily(page);
  await page.getByRole('group', { name: 'Family profiles' }).getByRole('button', { name: /Avery/ }).click();
  const history = page.getByRole('region', { name: "Avery's activity history", exact: true });
  const download = history.getByRole('button', { name: 'Numbers / Excel', exact: true });
  await expect(download).toBeEnabled();
  const readsBefore = state.reads.filter((path) => path.includes('/child-one/training-sessions')).length;
  state.deny('child-one');
  await download.click();
  await expect(history).toHaveCount(0);
  await expect(page.getByText('Family access changed. These records have been cleared.', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Family profiles' }).getByRole('button', { name: /Avery/ })).toHaveCount(0);
  expect(state.reads.filter((path) => path.includes('/child-one/training-sessions')).length).toBeGreaterThan(readsBefore);
  expect(downloads).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('a parent creates a child without an email and connects only that child’s studio invitation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, { initialChildren: false });
  await page.goto('/');
  await openFamily(page);
  const create = page.getByRole('region', { name: 'Create a child profile', exact: true });
  await create.getByLabel('Child’s name', { exact: true }).fill('Rowan');
  await create.getByRole('checkbox').check();
  await create.getByRole('button', { name: 'Create child profile', exact: true }).click();
  const history = page.getByRole('region', { name: "Rowan's activity history", exact: true });
  await expect(history).toBeVisible();
  expect(state.writes.find((write) => write.path === '/api/family/children')).toMatchObject({ method: 'POST', body: { name: 'Rowan' } });
  const creation = state.writes.find((write) => write.path === '/api/family/children')!;
  expect(creation.body).not.toHaveProperty('email');
  expect(creation.body).not.toHaveProperty('password');
  await history.getByLabel('Child’s Club Connect invitation', { exact: true }).fill(`https://tracklab-bmx.onrender.com/#clubInvite=${clubToken}`);
  await history.getByRole('button', { name: 'Connect studio record', exact: true }).click();
  await expect(history).toContainText('Studio records connected to Rowan. Your parent profile is unchanged.');
  expect(state.writes.filter((write) => write.path.endsWith('/club-claim'))).toEqual([
    { path: '/api/family/children/child-1/club-claim', method: 'POST', body: { token: clubToken } },
  ]);
  expect(state.writes.filter((write) => /\/api\/club-connect\/.*claim/.test(write.path))).toEqual([]);
  await expect(history).toContainText('Viewing Family alone does not save home workouts to a child.');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('managed-child-phone.png') });
  expect(state.errors).toEqual([]);
});

test('a parent can copy and revoke a one-use permission link without granting access automatically', async ({ page }) => {
  const state = await fixture(page, { initialChildren: false });
  await page.goto('/');
  await openFamily(page);
  await page.getByRole('button', { name: 'Create permission link', exact: true }).click();
  await expect(page.getByLabel('Private permission link', { exact: true })).toHaveValue(new RegExp(`#familyInvite=${invitationToken}$`));
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__copiedFamilyLink)).toMatch(new RegExp(`#familyInvite=${invitationToken}$`));
  await expect(page.getByRole('group', { name: 'Family profiles' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel permission link 1', exact: true }).click();
  await expect(page.getByLabel('Private permission link', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pending permission links', exact: true })).toHaveCount(0);
  expect(state.writes.filter((write) => write.path.startsWith('/api/family'))).toEqual([
    { path: '/api/family/link-invites', method: 'POST', body: {} },
    { path: '/api/family/link-invites/family-invite-fixture', method: 'DELETE', body: null },
  ]);
  expect(state.errors).toEqual([]);
});

test('an athlete reviews and explicitly approves activity-only sharing, then can revoke it', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, { initialChildren: false });
  await page.goto(`/#familyInvite=${invitationToken}`);
  const dialog = page.getByRole('dialog', { name: 'Family permission', exact: true });
  const approve = dialog.getByRole('button', { name: 'Approve activity sharing', exact: true });
  await expect(approve).toBeDisabled();
  await expect(dialog).toContainText('Apple Watch heart rate, is excluded');
  expect(state.writes.filter((write) => write.path.endsWith('/accept'))).toEqual([]);
  await dialog.getByRole('checkbox', { name: 'I allow Parent Guardian to view my activity records and cycling power.', exact: true }).check();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('family-permission-phone.png') });
  await approve.click();
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/familyInvite/);
  const sharing = page.getByRole('region', { name: 'Who can view my records', exact: true });
  await expect(sharing).toContainText('Parent Guardian');
  expect(state.writes.find((write) => write.path === '/api/family/link-invites/accept')).toEqual({
    path: '/api/family/link-invites/accept', method: 'POST', body: { token: invitationToken, activityConsent: true },
  });
  await sharing.getByRole('button', { name: 'Stop sharing with Parent Guardian', exact: true }).click();
  const confirmation = page.getByRole('region', { name: 'Confirm stop sharing', exact: true });
  await expect(confirmation).toContainText('Your account and activity records will stay intact.');
  await confirmation.getByRole('button', { name: 'Confirm stop sharing', exact: true }).click();
  await expect(sharing).toHaveCount(0);
  await expect(page.getByText('Parent Guardian can no longer access your records through Family. Your records remain in your account.', { exact: true })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('a revoked invitation shows the denial and cannot leave the approval control active', async ({ page }) => {
  const state = await fixture(page);
  state.rejectAcceptance(true);
  await page.goto(`/#familyInvite=${invitationToken}`);
  const dialog = page.getByRole('dialog', { name: 'Family permission', exact: true });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Approve activity sharing', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('This invitation has been revoked.');
  await expect(dialog.getByRole('button', { name: 'Approve activity sharing', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/familyInvite/);
  expect(state.errors).toEqual([]);
});

test('a managed child can be archived and restored with the same identity and records', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/');
  await openFamily(page);
  const profiles = page.getByRole('group', { name: 'Family profiles' });
  await profiles.getByRole('button', { name: /Avery/ }).click();
  const history = page.getByRole('region', { name: "Avery's activity history", exact: true });
  await expect(history).toContainText('0.180 sec');
  await page.getByRole('button', { name: 'Archive Avery’s profile', exact: true }).click();
  const confirmation = page.getByRole('region', { name: 'Confirm removal from family', exact: true });
  await expect(confirmation).toContainText('stored records will not be erased');
  await confirmation.getByRole('button', { name: 'Confirm archive', exact: true }).click();
  await expect(history).toHaveCount(0);
  await expect(profiles.getByRole('button', { name: /Avery/ })).toHaveCount(0);
  await page.getByText('Archived child profiles (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Restore Avery', exact: true }).click();
  await expect(history).toContainText('0.180 sec');
  await expect(history.getByRole('region', { name: 'Training results spreadsheet' })).toContainText('5 saved sessions');
  await expect(profiles.getByRole('button', { name: /Avery/ })).toHaveAttribute('aria-pressed', 'true');
  expect(state.writes.filter((write) => write.path.startsWith('/api/family'))).toEqual([
    { path: '/api/family/children/child-one', method: 'DELETE', body: null },
    { path: '/api/family/children/child-one/restore', method: 'POST', body: {} },
  ]);
  expect(state.errors).toEqual([]);
});

test('a family invitation survives athlete sign-in and still requires explicit approval', async ({ page }) => {
  const state = await fixture(page, { signedIn: false, initialChildren: false });
  await page.goto(`/#familyInvite=${invitationToken}`);
  const dialog = page.getByRole('dialog', { name: 'Family permission', exact: true });
  await expect(dialog).toContainText('Use the athlete’s account, not the parent’s account.');
  expect(state.reads.filter((path) => path.includes('/family/link-invites/preview'))).toEqual([]);
  await dialog.getByRole('button', { name: 'Sign in to review permission', exact: true }).click();
  const account = page.getByRole('region', { name: 'Required profile', exact: true });
  await account.getByLabel('Email', { exact: true }).fill('linked-athlete@example.com');
  await account.getByLabel('Password', { exact: true }).fill('FamilyFixturePassword123');
  await account.locator('button[type="submit"]').click();
  await expect(dialog).toContainText('Linked Athlete');
  await expect(dialog.getByRole('button', { name: 'Approve activity sharing', exact: true })).toBeDisabled();
  expect(state.writes.filter((write) => write.path === '/api/family/link-invites/accept')).toEqual([]);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Approve activity sharing', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Who can view my records', exact: true })).toContainText('Parent Guardian');
  expect(state.errors).toEqual([]);
});

test('a sparse child response marked incomplete loads both date windows before showing or exporting records', async ({ page }, testInfo) => {
  const state = await fixture(page);
  state.sparseCappedMonth('child-one');
  await page.goto('/');
  await openFamily(page);
  await page.getByRole('group', { name: 'Family profiles' }).getByRole('button', { name: /Avery/ }).click();
  const history = page.getByRole('region', { name: "Avery's activity history", exact: true });
  await expect(history.getByRole('region', { name: 'Training results spreadsheet' })).toContainText('5 saved sessions');
  const windows = () => state.reads.filter((path) => path.includes('/child-one/training-sessions')).map((path) => {
    const query = new URL(path, 'https://tracklab.test').searchParams;
    return { from: Number(query.get('from')), to: Number(query.get('to')) };
  });
  const [whole, earlier, later] = windows();
  expect(earlier.from).toBe(whole.from);
  expect(earlier.to).toBe(later.from);
  expect(later.to).toBe(whole.to);
  expect(earlier.to).toBeLessThan(whole.to);
  await history.getByRole('button', { name: 'View details', exact: true }).first().click();
  const readsBeforeExport = windows().length;
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    history.getByRole('button', { name: 'JSON', exact: true }).click(),
  ]);
  expect(windows().length).toBeGreaterThanOrEqual(readsBeforeExport + 3);
  const path = testInfo.outputPath('complete-family-record.json');
  await download.saveAs(path);
  const exported = JSON.parse(await readFile(path, 'utf8'));
  expect(exported.id).toMatch(/^child-one-/);
  expect(exported.title).toContain('Avery');
  expect(JSON.stringify(exported)).not.toContain('Elliot');
  expect(JSON.stringify(exported)).not.toContain('healthKit');
  expect(JSON.stringify(exported)).not.toContain('Private health fixture');
  expect(state.errors).toEqual([]);
});
