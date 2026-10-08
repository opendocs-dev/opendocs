import { afterAll, beforeEach, expect, test } from 'bun:test';
import { cleanDatabase } from '../../test/helpers';
import { getPrisma } from '../db';
import { newPublicId } from '../ids';
import { categorySlug, fileUnderCategory } from './file';

const prisma = getPrisma();

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

test('categorySlug returns null for symbol-only names', () => {
  expect(categorySlug('!!!')).toBeNull();
  expect(categorySlug('   ')).toBeNull();
  expect(categorySlug('---')).toBeNull();
});

test('categorySlug lowercases and collapses non-alphanumerics', () => {
  expect(categorySlug('WhatsApp')).toBe('whatsapp');
  expect(categorySlug(' whatsapp ')).toBe('whatsapp');
});

test('different names can map to the same slug', () => {
  expect(categorySlug('WhatsApp')).toBe('whatsapp');
  expect(categorySlug('whatsapp')).toBe('whatsapp');
  expect(categorySlug(' whatsapp ')).toBe('whatsapp');
});

test('different slugs are different', () => {
  expect(categorySlug('Whats-App')).toBe('whats-app');
  expect(categorySlug('WhatsApp')).toBe('whatsapp');
  expect(categorySlug('Whats-App')).not.toBe(categorySlug('WhatsApp'));
});

const orgId = () => `file-org-${newPublicId()}`;
const createOrg = () =>
  prisma.organization.create({
    data: { id: orgId(), name: 'Org', slug: `file-${newPublicId().toLowerCase()}` },
  });

test('fileUnderCategory creates a suggested category under default policy', async () => {
  const org = await createOrg();

  const result = await prisma.$transaction((tx) => fileUnderCategory(tx, org.id, 'WhatsApp'));

  expect(result.status).toBe('suggested');
  expect(result.categoryId).toBeTruthy();

  const category = await prisma.category.findUnique({
    where: { id: result.categoryId! },
  });
  expect(category?.name).toBe('WhatsApp');
  expect(category?.slug).toBe('whatsapp');
  expect(category?.status).toBe('suggested');
  expect(category?.source).toBe('agent');
});

test('fileUnderCategory creates an active category under auto policy', async () => {
  const org = await createOrg();
  await prisma.siteSettings.create({
    data: { organizationId: org.id, siteTitle: org.name, categoryPolicy: 'auto' },
  });

  const result = await prisma.$transaction((tx) => fileUnderCategory(tx, org.id, 'WhatsApp'));

  expect(result.status).toBe('filed');
  expect(result.categoryId).toBeTruthy();

  const category = await prisma.category.findUnique({
    where: { id: result.categoryId! },
  });
  expect(category?.status).toBe('active');
});

test('fileUnderCategory reuses an existing matching category', async () => {
  const org = await createOrg();
  const existing = await prisma.category.create({
    data: {
      organizationId: org.id,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'user',
      status: 'active',
    },
  });

  const result = await prisma.$transaction((tx) => fileUnderCategory(tx, org.id, 'WhatsApp'));

  expect(result.categoryId).toBe(existing.id);
  expect(result.status).toBe('filed');
  expect(await prisma.category.count({ where: { organizationId: org.id } })).toBe(1);
});

test('fileUnderCategory matches a name that differs only by hyphens and case', async () => {
  const org = await createOrg();
  const existing = await prisma.category.create({
    data: { organizationId: org.id, slug: 'whatsapp', name: 'WhatsApp', source: 'user', status: 'active' },
  });

  for (const name of ['Whats-App', ' whatsapp ', 'WHATS APP']) {
    const result = await prisma.$transaction((tx) => fileUnderCategory(tx, org.id, name));
    expect(result.categoryId).toBe(existing.id);
    expect(result.status).toBe('filed');
  }
  expect(await prisma.category.count({ where: { organizationId: org.id } })).toBe(1);
});

test('fileUnderCategory reports suggested for an existing suggested category', async () => {
  const org = await createOrg();
  const existing = await prisma.category.create({
    data: {
      organizationId: org.id,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'agent',
      status: 'suggested',
    },
  });

  const result = await prisma.$transaction((tx) => fileUnderCategory(tx, org.id, 'WhatsApp'));

  expect(result.categoryId).toBe(existing.id);
  expect(result.status).toBe('suggested');
});

test('fileUnderCategory returns cap_reached when at 30 categories', async () => {
  const org = await createOrg();

  // Seed 30 categories
  for (let i = 0; i < 30; i += 1) {
    await prisma.category.create({
      data: {
        organizationId: org.id,
        slug: `category-${i}`,
        name: `Category ${i}`,
        source: 'user',
        status: 'active',
      },
    });
  }

  const result = await prisma.$transaction((tx) => fileUnderCategory(tx, org.id, 'NewCategory'));

  expect(result.status).toBe('cap_reached');
  expect(result.categoryId).toBeNull();
  expect(await prisma.category.count({ where: { organizationId: org.id } })).toBe(30);
});

test('fileUnderCategory files a matching name even when at cap', async () => {
  const org = await createOrg();

  // Seed 30 categories, one with slug matching 'WhatsApp'
  for (let i = 0; i < 29; i += 1) {
    await prisma.category.create({
      data: {
        organizationId: org.id,
        slug: `category-${i}`,
        name: `Category ${i}`,
        source: 'user',
        status: 'active',
      },
    });
  }
  const matching = await prisma.category.create({
    data: {
      organizationId: org.id,
      slug: 'whatsapp',
      name: 'WhatsApp',
      source: 'user',
      status: 'active',
    },
  });

  const result = await prisma.$transaction((tx) => fileUnderCategory(tx, org.id, 'WhatsApp'));

  expect(result.categoryId).toBe(matching.id);
  expect(result.status).toBe('filed');
  expect(await prisma.category.count({ where: { organizationId: org.id } })).toBe(30);
});

test('fileUnderCategory returns none for symbol-only names', async () => {
  const org = await createOrg();

  const result = await prisma.$transaction((tx) => fileUnderCategory(tx, org.id, '!!!'));

  expect(result.status).toBe('none');
  expect(result.categoryId).toBeNull();
});

test('fileUnderCategory sets position sequentially', async () => {
  const org = await createOrg();

  const first = await prisma.$transaction((tx) => fileUnderCategory(tx, org.id, 'First'));
  const second = await prisma.$transaction((tx) => fileUnderCategory(tx, org.id, 'Second'));

  const firstCat = await prisma.category.findUnique({
    where: { id: first.categoryId! },
  });
  const secondCat = await prisma.category.findUnique({
    where: { id: second.categoryId! },
  });

  expect(firstCat?.position).toBe(0);
  expect(secondCat?.position).toBe(1);
});

test('fileUnderCategory trims and cuts name to 40 chars', async () => {
  const org = await createOrg();

  const longName = '  A'.repeat(20) + '  ';
  const result = await prisma.$transaction((tx) => fileUnderCategory(tx, org.id, longName));

  const category = await prisma.category.findUnique({
    where: { id: result.categoryId! },
  });
  expect(category?.name.length).toBeLessThanOrEqual(40);
  expect(category?.name).toBe(longName.trim().slice(0, 40));
});
