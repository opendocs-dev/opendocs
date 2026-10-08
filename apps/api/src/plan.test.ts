import { afterAll, beforeEach, expect, test } from 'bun:test';
import { cleanDatabase } from '../test/helpers';
import { getPrisma } from './db';
import { newPublicId } from './ids';
import { capabilitiesFor, getPlan } from './plan';

const prisma = getPrisma();

const organizationId = () => `plan-gate-org-${newPublicId()}`;

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

test('getPlan returns free for a workspace with no WorkspaceBilling row', async () => {
  const orgId = organizationId();
  await prisma.organization.create({ data: { id: orgId, name: 'No Billing', slug: `no-billing-${newPublicId().toLowerCase()}` } });

  expect(await getPlan(orgId)).toBe('free');
});

test('getPlan returns the stored plan when it is a known value', async () => {
  const orgId = organizationId();
  await prisma.organization.create({ data: { id: orgId, name: 'Enterprise Org', slug: `ent-${newPublicId().toLowerCase()}` } });
  await prisma.workspaceBilling.create({ data: { organizationId: orgId, plan: 'enterprise' } });

  expect(await getPlan(orgId)).toBe('enterprise');
});

test('getPlan falls back to free for an unknown stored value (e.g. a retired "team" row before backfill)', async () => {
  const orgId = organizationId();
  await prisma.organization.create({ data: { id: orgId, name: 'Legacy Org', slug: `legacy-${newPublicId().toLowerCase()}` } });
  await prisma.workspaceBilling.create({ data: { organizationId: orgId, plan: 'team' } });

  expect(await getPlan(orgId)).toBe('free');
});

test('capabilitiesFor(free) matches C14 Decisions: 1 preset, no storage connection, footer credit shown', () => {
  const capabilities = capabilitiesFor('free');

  expect(capabilities.presetCount).toBe(1);
  expect(capabilities.customPreset).toBe(false);
  expect(capabilities.storageKinds).toEqual([]);
  expect(capabilities.footerCredit).toBe(true);
  expect(capabilities.aiAssistant).toBe(false);
  expect(capabilities.customDomain).toBe(false);
});

test('capabilitiesFor(pro) matches C14 Decisions: 3 presets, Drive only, no footer credit', () => {
  const capabilities = capabilitiesFor('pro');

  expect(capabilities.presetCount).toBe(3);
  expect(capabilities.customPreset).toBe(false);
  expect(capabilities.storageKinds).toEqual(['gdrive']);
  expect(capabilities.footerCredit).toBe(false);
  expect(capabilities.aiAssistant).toBe(true);
  expect(capabilities.customDomain).toBe(false);
});

test('capabilitiesFor(enterprise) matches C14 Decisions: 3 presets plus custom, Drive or S3, custom domain', () => {
  const capabilities = capabilitiesFor('enterprise');

  expect(capabilities.presetCount).toBe(3);
  expect(capabilities.customPreset).toBe(true);
  expect(capabilities.storageKinds).toEqual(['gdrive', 's3']);
  expect(capabilities.footerCredit).toBe(false);
  expect(capabilities.aiAssistant).toBe(true);
  expect(capabilities.customDomain).toBe(true);
});
