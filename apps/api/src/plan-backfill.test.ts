import { afterAll, beforeEach, expect, test } from 'bun:test';
import { cleanDatabase } from '../test/helpers';
import { getPrisma } from './db';
import { newPublicId } from './ids';

const prisma = getPrisma();

const MIGRATION_PATH = `${import.meta.dir}/../prisma/migrations/20261002033000_plan_team_to_pro/migration.sql`;

/** Strips `--` comment lines and runs each non-empty statement, exactly as a deploy would. */
const runBackfill = async () => {
  const sql = await Bun.file(MIGRATION_PATH).text();
  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
};

const organizationId = () => `plan-backfill-org-${newPublicId()}`;

const seedWorkspace = async (plan: string | null) => {
  const orgId = organizationId();
  await prisma.organization.create({
    data: { id: orgId, name: 'Plan Backfill Org', slug: `plan-backfill-${newPublicId().toLowerCase()}` },
  });
  if (plan !== null) {
    await prisma.workspaceBilling.create({ data: { organizationId: orgId, plan } });
  }
  return orgId;
};

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

test('moves a team workspace to pro, leaves free and pro alone, and is idempotent', async () => {
  const teamOrgId = await seedWorkspace('team');
  const proOrgId = await seedWorkspace('pro');
  const freeOrgId = await seedWorkspace('free');
  const noRowOrgId = await seedWorkspace(null);

  await runBackfill();

  const teamAfter = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: teamOrgId } });
  expect(teamAfter.plan).toBe('pro');

  const proAfter = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: proOrgId } });
  expect(proAfter.plan).toBe('pro');

  const freeAfter = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: freeOrgId } });
  expect(freeAfter.plan).toBe('free');

  const noRowAfter = await prisma.workspaceBilling.findUnique({ where: { organizationId: noRowOrgId } });
  expect(noRowAfter).toBeNull();

  await runBackfill();

  const teamSecond = await prisma.workspaceBilling.findUniqueOrThrow({ where: { organizationId: teamOrgId } });
  expect(teamSecond.plan).toBe('pro');
});
