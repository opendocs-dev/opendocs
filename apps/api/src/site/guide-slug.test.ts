import { afterAll, beforeEach, expect, test } from 'bun:test';
import { cleanDatabase } from '../../test/helpers';
import { getPrisma } from '../db';
import { newPublicId } from '../ids';
import { makeGuideSlug, uniqueGuideSlug } from './guide-slug';

const prisma = getPrisma();

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

test('makeGuideSlug lowercases, collapses non-alphanumerics and trims', () => {
  expect(makeGuideSlug('Create a WhatsApp template!')).toBe('create-a-whatsapp-template');
});

test('makeGuideSlug falls back to "guide" for empty or symbol-only titles', () => {
  expect(makeGuideSlug('')).toBe('guide');
  expect(makeGuideSlug('!!!')).toBe('guide');
  expect(makeGuideSlug('   ')).toBe('guide');
});

test('makeGuideSlug cuts to 60 chars without a trailing hyphen', () => {
  const title = 'a'.repeat(58) + ' b c d e';
  const slug = makeGuideSlug(title);
  expect(slug.length).toBeLessThanOrEqual(60);
  expect(slug.endsWith('-')).toBe(false);
});

const orgId = () => `guide-slug-org-${newPublicId()}`;
const createOrg = () =>
  prisma.organization.create({
    data: { id: orgId(), name: 'Org', slug: `guide-slug-${newPublicId().toLowerCase()}` },
  });

const createFlow = (organizationId: string, slug: string | null) =>
  prisma.flow.create({
    data: { publicId: newPublicId(), organizationId, title: 'Untitled flow', slug },
  });

test('uniqueGuideSlug returns the base when free', async () => {
  const org = await createOrg();
  const flow = await createFlow(org.id, null);

  const slug = await prisma.$transaction((tx) =>
    uniqueGuideSlug(tx, org.id, 'create-a-template', flow.id),
  );

  expect(slug).toBe('create-a-template');
});

test('uniqueGuideSlug appends -2, -3 on repeated clashes within one workspace', async () => {
  const org = await createOrg();
  await createFlow(org.id, 'create-a-template');
  await createFlow(org.id, 'create-a-template-2');
  const flow = await createFlow(org.id, null);

  const slug = await prisma.$transaction((tx) =>
    uniqueGuideSlug(tx, org.id, 'create-a-template', flow.id),
  );

  expect(slug).toBe('create-a-template-3');
});
