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
  notify_ai_credits: true,
  notify_content_gaps: false,
  notify_invite_accepted: true,
  github_handle: 'alexdev',
};

describe('AccountManager', () => {
  test('renders header with title, subtitle, and primary Save button (UI-A15 Finding 7)', () => {
    const html = renderToStaticMarkup(
      <AccountManager
        account={sampleAccount}
        currentUserRole="owner"
        organizationId="org_1"
        workspaceName="Acmeco Help"
      />,
    );

    expect(html).toContain('<h1>Account settings</h1>');
    expect(html).toContain('Applies to you in every workspace');
    expect(html).toContain('class="btn btn-primary"');
    expect(html).toContain('Save');
  });

  test('renders profile card with avatar image, editable name, and read-only email (UI-A15 Finding 3)', () => {
    const html = renderToStaticMarkup(
      <AccountManager
        account={sampleAccount}
        currentUserRole="owner"
        organizationId="org_1"
        workspaceName="Acmeco Help"
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
        currentUserRole="owner"
        organizationId="org_1"
      />,
    );

    expect(html).toContain('class="av"');
    expect(html).toContain('AD'); // Initials for Alex Developer
  });

  test('renders sign-in card with GitHub handle and connected badge (UI-A15 Finding 4)', () => {
    const html = renderToStaticMarkup(
      <AccountManager
        account={sampleAccount}
        currentUserRole="owner"
        organizationId="org_1"
      />,
    );

    expect(html).toContain('<h3>Sign-in</h3>');
    expect(html).toContain('GitHub');
    expect(html).toContain('Connected as @alexdev');
    expect(html).toContain('badge badge-ok');
    expect(html).toContain('Connected');
  });

  test('renders 4 notification toggles matching prototype (UI-A15 Finding 5 & 10)', () => {
    const html = renderToStaticMarkup(
      <AccountManager
        account={sampleAccount}
        currentUserRole="owner"
        organizationId="org_1"
      />,
    );

    expect(html).toContain('<h3>Email notifications</h3>');
    const toggleCount = (html.match(/class="toggle"/g) || []).length;
    expect(toggleCount).toBe(4);
    expect(html).toContain('Weekly summary of views and searches');
    expect(html).toContain('AI credits reach 80% and 100%');
    expect(html).toContain('New content gaps found');
    expect(html).toContain('A teammate accepts an invite');
  });

  test('renders leave workspace card with owner copy and workspace name button (UI-A15 Finding 6)', () => {
    const html = renderToStaticMarkup(
      <AccountManager
        account={sampleAccount}
        currentUserRole="owner"
        organizationId="org_1"
        workspaceName="Acmeco Help"
      />,
    );

    expect(html).toContain('<h3>Leave this workspace</h3>');
    expect(html).toContain('Owners must transfer ownership first.');
    expect(html).toContain('Leave Acmeco Help');
  });
});
