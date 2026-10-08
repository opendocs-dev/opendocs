import { describe, expect, test } from 'bun:test';
import { apiRewrites } from './rewrites';

describe('apiRewrites', () => {
  test('forwards /api/* to API_ORIGIN', () => {
    expect(apiRewrites('https://api.example.test')).toEqual([
      {
        source: '/d/:id.md',
        destination: 'https://api.example.test/api/v1/docs/:id/markdown',
      },
      {
        source: '/api/:path*',
        destination: 'https://api.example.test/api/:path*',
      },
    ]);
  });

  test('defaults API_ORIGIN to localhost:4000', () => {
    expect(apiRewrites(undefined)).toEqual([
      {
        source: '/d/:id.md',
        destination: 'http://localhost:4000/api/v1/docs/:id/markdown',
      },
      {
        source: '/api/:path*',
        destination: 'http://localhost:4000/api/:path*',
      },
    ]);
  });

  test('strips trailing slash from API_ORIGIN', () => {
    expect(apiRewrites('https://api.example.test/')).toEqual([
      {
        source: '/d/:id.md',
        destination: 'https://api.example.test/api/v1/docs/:id/markdown',
      },
      {
        source: '/api/:path*',
        destination: 'https://api.example.test/api/:path*',
      },
    ]);
  });

  test('forwards /d/{id}.md to the markdown route', () => {
    const rules = apiRewrites('https://api.example.test');
    const markdownRule = rules.find((rule) => rule.source === '/d/:id.md');

    expect(markdownRule).toEqual({
      source: '/d/:id.md',
      destination: 'https://api.example.test/api/v1/docs/:id/markdown',
    });
  });
});
