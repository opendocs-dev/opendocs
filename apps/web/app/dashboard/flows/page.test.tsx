import { describe, expect, test } from 'bun:test';

import FlowsPage from './page';

describe('FlowsPage (C18 AC-17)', () => {
  test('/dashboard/flows redirects to /dashboard/guides', () => {
    expect(() => FlowsPage()).toThrowError(
      expect.objectContaining({ digest: expect.stringContaining('NEXT_REDIRECT;replace;/dashboard/guides') }),
    );
  });
});
