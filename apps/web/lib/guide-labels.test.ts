import { expect, test } from 'bun:test';
import { categoryOption, publicLink, visibilityLabel, visibilityTone } from './guide-labels';

test('visibilityLabel', () => {
  expect(visibilityLabel('published')).toBe('Published');
  expect(visibilityLabel('unlisted')).toBe('Unlisted');
  expect(visibilityLabel('draft')).toBe('Draft');
  expect(visibilityLabel('unknown')).toBe('Published');
  expect(visibilityLabel(undefined)).toBe('Published');
});

test('visibilityTone', () => {
  expect(visibilityTone('published')).toBe('ok');
  expect(visibilityTone('unlisted')).toBe('muted');
  expect(visibilityTone('draft')).toBe('warn');
  expect(visibilityTone('unknown')).toBe('ok');
  expect(visibilityTone(undefined)).toBe('ok');
});

test('publicLink published with slug and siteHost', () => {
  const guide = {
    public_id: 'id1',
    slug: 'my-guide',
    visibility: 'published',
    url: 'http://example.com/doc',
  };
  expect(publicLink(guide, 'example.com')).toBe('https://example.com/g/my-guide');
});

test('publicLink unlisted with slug and siteHost', () => {
  const guide = {
    public_id: 'id1',
    slug: 'my-guide',
    visibility: 'unlisted',
  };
  expect(publicLink(guide, 'example.com')).toBe('https://example.com/g/my-guide');
});

test('publicLink draft falls back to url', () => {
  const guide = {
    public_id: 'id1',
    slug: 'my-guide',
    visibility: 'draft',
    url: 'https://example.com/doc/id1',
  };
  expect(publicLink(guide, 'example.com')).toBe('https://example.com/doc/id1');
});

test('publicLink no slug returns url', () => {
  const guide = {
    public_id: 'id1',
    visibility: 'published',
    url: 'https://example.com/doc/id1',
  };
  expect(publicLink(guide, 'example.com')).toBe('https://example.com/doc/id1');
});

test('publicLink no siteHost returns url', () => {
  const guide = {
    public_id: 'id1',
    slug: 'my-guide',
    visibility: 'published',
    url: 'https://example.com/doc/id1',
  };
  expect(publicLink(guide, null)).toBe('https://example.com/doc/id1');
});

test('publicLink no url returns null', () => {
  const guide = {
    public_id: 'id1',
    slug: 'my-guide',
    visibility: 'draft',
  };
  expect(publicLink(guide, 'example.com')).toBeNull();
});

test('publicLink rejects non-http url', () => {
  const guide = {
    public_id: 'id1',
    url: 'javascript:alert("xss")',
  };
  expect(publicLink(guide, null)).toBeNull();
});

test('categoryOption active status', () => {
  const cat = { id: 'c1', slug: 'billing', name: 'Billing', status: 'active' as const };
  expect(categoryOption(cat)).toBe('Billing');
});

test('categoryOption suggested status returns clean category name', () => {
  const cat = { id: 'c1', slug: 'billing', name: 'Billing', status: 'suggested' as const };
  expect(categoryOption(cat)).toBe('Billing');
});
