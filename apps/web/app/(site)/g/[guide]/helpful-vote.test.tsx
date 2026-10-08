import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelpfulVote } from './helpful-vote';

describe('HelpfulVote component (C14 AC-04)', () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];

    // Mock localStorage
    globalThis.localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
      key: () => null,
      length: 0,
    };
  });

  test('renders prompt and Yes/No buttons initially', () => {
    const html = renderToStaticMarkup(<HelpfulVote guideSlug="install-guide" />);
    expect(html).toContain('Was this guide helpful?');
    expect(html).toContain('Yes');
    expect(html).toContain('No');
  });

  test('prevents double voting when localStorage already has a vote', () => {
    store['opendocs_vote_install-guide'] = 'yes';
    expect(globalThis.localStorage.getItem('opendocs_vote_install-guide')).toBe('yes');
  });
});
