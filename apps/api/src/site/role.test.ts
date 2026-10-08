import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { cleanDatabase } from '../../test/helpers';
import { getPrisma } from '../db';
import { normalizeRole, roleFor } from './role';

const prisma = getPrisma();

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

test('normalizeRole: owner stays owner', () => {
  expect(normalizeRole('owner')).toBe('owner');
});

test('normalizeRole: admin stays admin', () => {
  expect(normalizeRole('admin')).toBe('admin');
});

test('normalizeRole: editor stays editor', () => {
  expect(normalizeRole('editor')).toBe('editor');
});

test('normalizeRole: member becomes editor', () => {
  expect(normalizeRole('member')).toBe('editor');
});

test('normalizeRole: unknown becomes editor', () => {
  expect(normalizeRole('unknown')).toBe('editor');
});

test('roleFor: returns owner when member has owner role', async () => {
  const user = await prisma.user.create({
    data: { id: 'user1', email: 'user@example.com', name: 'User' },
  });

  const organization = await prisma.organization.create({
    data: { id: 'org1', name: 'Org', slug: 'org' },
  });

  await prisma.member.create({
    data: { id: 'member1', organizationId: organization.id, userId: user.id, role: 'owner' },
  });

  const role = await roleFor(user.id, organization.id);
  expect(role).toBe('owner');
});

test('roleFor: returns null when user is not a member', async () => {
  const user = await prisma.user.create({
    data: { id: 'user1', email: 'user@example.com', name: 'User' },
  });

  const organization = await prisma.organization.create({
    data: { id: 'org1', name: 'Org', slug: 'org' },
  });

  const role = await roleFor(user.id, organization.id);
  expect(role).toBeNull();
});

test('roleFor: normalizes member role to editor', async () => {
  const user = await prisma.user.create({
    data: { id: 'user1', email: 'user@example.com', name: 'User' },
  });

  const organization = await prisma.organization.create({
    data: { id: 'org1', name: 'Org', slug: 'org' },
  });

  await prisma.member.create({
    data: { id: 'member1', organizationId: organization.id, userId: user.id, role: 'member' },
  });

  const role = await roleFor(user.id, organization.id);
  expect(role).toBe('editor');
});
