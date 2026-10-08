import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

const NewWorkspacePage = (await import('./page')).default;

describe('NewWorkspacePage', () => {
  test('renders heading, workspace name input, and buttons', () => {
    const html = renderToStaticMarkup(<NewWorkspacePage />);

    expect(html).toContain('<h1>Create workspace</h1>');
    expect(html).toContain('Create a new workspace for your documentation.');
    expect(html).toContain('label for="ws-name">Workspace name</label>');
    expect(html).toContain('id="ws-name"');
    expect(html).toContain('Cancel');
    expect(html).toContain('Create workspace');
  });
});
