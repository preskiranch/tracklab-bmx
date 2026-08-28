import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AccountDeletionPanel,
  accountDeletionReady,
  appleSubscriptionManagementUrl,
} from '../../src/components/AccountProfileView';
import { deleteAuthAccount } from '../../src/lib/auth';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('self-service account deletion', () => {
  it('requires a password, exact typed confirmation, and permanent-deletion acknowledgement', () => {
    expect(accountDeletionReady({ password: '', confirmation: 'DELETE', acknowledged: true })).toBe(false);
    expect(accountDeletionReady({ password: 'password', confirmation: 'delete', acknowledged: true })).toBe(false);
    expect(accountDeletionReady({ password: 'password', confirmation: 'DELETE', acknowledged: false })).toBe(false);
    expect(accountDeletionReady({ password: 'password', confirmation: 'DELETE', acknowledged: true })).toBe(true);
  });

  it('renders the deletion path and the complete Apple subscription consequence in My Profile', () => {
    const markup = renderToStaticMarkup(createElement(AccountDeletionPanel, {
      email: 'rider@example.com',
    }));

    expect(markup).toContain('Delete Account');
    expect(markup).toContain('Current password');
    expect(markup).toContain('Type DELETE to confirm');
    expect(markup).toContain('does not cancel an Apple subscription');
    expect(markup).toContain('use <strong>Manage Apple Subscription</strong> above and cancel it before deleting');
    expect(markup).toContain('retains a one-way, pseudonymous Apple transaction-lineage proof with no email or name');
    expect(markup).toContain('create a new TrackLab account and deliberately choose <strong>Restore Purchases</strong>');
    expect(markup).toContain('Cancellation is recommended first if you do not want renewal, but it is not required');
    expect(markup).toContain('Apple billing continues unless I cancel it');
    expect(markup).toContain('requires the same Apple Account, an active subscription');
    expect(markup).toContain('Permanently Delete Account');
    expect(markup).toContain(appleSubscriptionManagementUrl);
  });

  it('does not require Apple-subscription cancellation before account deletion', () => {
    expect(accountDeletionReady({
      password: 'current password',
      confirmation: 'DELETE',
      acknowledged: true,
    })).toBe(true);
  });

  it('sends password reauthentication and exact confirmation to the authenticated deletion endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ deleted: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteAuthAccount('correct horse battery staple', 'DELETE')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/account', expect.objectContaining({
      method: 'DELETE',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        password: 'correct horse battery staple',
        confirmation: 'DELETE',
      }),
    }));
  });

  it('surfaces the server reauthentication error without claiming deletion succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'Current password is incorrect.',
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(deleteAuthAccount('wrong password', 'DELETE'))
      .rejects.toThrow('Current password is incorrect.');
  });
});
