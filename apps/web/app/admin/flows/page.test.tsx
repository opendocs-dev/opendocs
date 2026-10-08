import { describe, expect, test } from 'bun:test';

import FlowsPage from './page';

describe('FlowsPage (C18 AC-17)', () => {
  test('/admin/flows redirects to /admin/guides', () => {
    expect(() => FlowsPage()).toThrowError(
      expect.objectContaining({ digest: expect.stringContaining('NEXT_REDIRECT;replace;/admin/guides') }),
    );
  });
});
