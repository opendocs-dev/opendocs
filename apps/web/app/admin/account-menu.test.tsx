import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountMenu } from './account-menu';

describe('AccountMenu', () => {
  test('renders user initials, name, and capitalized role (Owner)', () => {
    const html = renderToStaticMarkup(
      <AccountMenu name="Alice Smith" role="owner" workspace="Acme Docs" initials="AS" />
    );

    expect(html).toContain('class="av">AS</div>');
    expect(html).toContain('<b>Alice Smith</b>');
    expect(html).toContain('<small>Owner</small>');
    expect(html).toContain('Acme Docs');
    expect(html).toContain('href="/admin/account"');
  });

  test('capitalizes editor and admin roles', () => {
    const htmlAdmin = renderToStaticMarkup(
      <AccountMenu name="Bob" role="admin" initials="B" />
    );
    expect(htmlAdmin).toContain('<small>Admin</small>');

    const htmlEditor = renderToStaticMarkup(
      <AccountMenu name="Charlie" role="editor" initials="C" />
    );
    expect(htmlEditor).toContain('<small>Editor</small>');
  });

  test('renders up chevron icon for the menu button', () => {
    const html = renderToStaticMarkup(
      <AccountMenu name="Alice" role="owner" initials="A" />
    );

    expect(html).toContain('class="adm-user-icon"');
    expect(html).toContain('d="M6 10l4-4 4 4"');
  });

  test('renders menu button with aria-haspopup="menu" and aria-expanded="false"', () => {
    const html = renderToStaticMarkup(
      <AccountMenu name="Alice" role="owner" initials="A" />
    );

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="umenu" role="menu"');
  });

  test('renders user email in the menu header when provided', () => {
    const html = renderToStaticMarkup(
      <AccountMenu
        name="Alice Smith"
        email="alice@example.com"
        role="owner"
        workspace="Acme Docs"
        initials="AS"
      />
    );

    expect(html).toContain('<small>alice@example.com</small>');
  });

  test('shows the single workspace name without a switcher or create entry', () => {
    const html = renderToStaticMarkup(
      <AccountMenu name="Alice" role="owner" workspace="Solo Docs" initials="A" />
    );

    expect(html).toContain('Solo Docs');
    expect(html).not.toContain('Create workspace');
    expect(html).not.toContain('Current workspace');
    expect(html).toContain('href="/"');
  });

  test('renders Notifications and Help and docs entries', () => {
    const html = renderToStaticMarkup(
      <AccountMenu name="Alice" role="owner" workspace="Acme Docs" initials="A" />
    );

    expect(html).toContain('href="/admin/account#notifications"');
    expect(html).toContain('Notifications');
    expect(html).toContain('href="https://github.com/opendocs-dev/opendocs"');
    expect(html).toContain('Help and docs');
  });
});
