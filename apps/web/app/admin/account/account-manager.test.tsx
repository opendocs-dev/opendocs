import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccountInfo } from '@/lib/server-api';

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const { AccountManager } = await import('./account-manager');

const sampleAccount: AccountInfo = {
  name: 'Alex Developer',
  email: 'alex@example.com',
  image: 'https://avatars.example.com/u/1234',
  email_notifications: true,
  notify_weekly_digest: true,
  github_handle: 'alexdev',
};

describe('AccountManager', () => {
  test('renders header with title, subtitle, and primary Save button (UI-A15 Finding 7)', () => {
    const html = renderToStaticMarkup(
      <AccountManager
        account={sampleAccount}
      />,
    );

    expect(html).toContain('<h1>Account settings</h1>');
    expect(html).toContain('Your profile on this instance');
    expect(html).toContain('class="btn btn-primary"');
    expect(html).toContain('Save');
  });

  test('renders profile card with avatar image, editable name, and read-only email (UI-A15 Finding 3)', () => {
    const html = renderToStaticMarkup(
      <AccountManager
        account={sampleAccount}
      />,
    );

    expect(html).toContain('<h3>Profile</h3>');
    expect(html).toContain('src="https://avatars.example.com/u/1234"');
    expect(html).toContain('value="Alex Developer"');
    expect(html).toContain('value="alex@example.com"');
    expect(html).toContain('Comes from your GitHub account.');
  });

  test('renders profile avatar fallback when image is null', () => {
    const accountWithoutImage: AccountInfo = {
      ...sampleAccount,
      image: null,
    };
    const html = renderToStaticMarkup(
      <AccountManager
        account={accountWithoutImage}
      />,
    );

    expect(html).toContain('class="av"');
    expect(html).toContain('AD'); // Initials for Alex Developer
  });

  test('renders sign-in card with GitHub handle and connected badge (UI-A15 Finding 4)', () => {
    const html = renderToStaticMarkup(
      <AccountManager
        account={sampleAccount}
      />,
    );

    expect(html).toContain('<h3>Sign-in</h3>');
    expect(html).toContain('GitHub');
    expect(html).toContain('Connected as @alexdev');
    expect(html).toContain('badge badge-ok');
    expect(html).toContain('Connected');
  });

  test('renders the weekly digest toggle only', () => {
    const html = renderToStaticMarkup(
      <AccountManager
        account={sampleAccount}
      />,
    );

    expect(html).toContain('<h3>Email notifications</h3>');
    const toggleCount = (html.match(/class="toggle"/g) || []).length;
    expect(toggleCount).toBe(1);
    expect(html).toContain('Weekly summary of views and searches');
    expect(html).not.toContain('AI credits');
  });
});
