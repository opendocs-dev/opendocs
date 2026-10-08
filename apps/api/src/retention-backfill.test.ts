import { afterAll, beforeEach, expect, test } from 'bun:test';
import { cleanDatabase } from '../test/helpers';
import { getPrisma } from './db';
import { newPublicId } from './ids';

const prisma = getPrisma();

const MIGRATION_PATH = `${import.meta.dir}/../prisma/migrations/20260930040000_retention_backfill/migration.sql`;

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

const organizationId = () => `retention-backfill-org-${newPublicId()}`;

const seedAsset = (organizationId: string, kind: 'step' | 'snap', expiresAt: Date) =>
  prisma.asset.create({
    data: {
      publicId: newPublicId(),
      organizationId,
      kind,
      provider: 'local',
      providerAccount: 'local',
      providerFileId: newPublicId(),
      mime: 'image/png',
      bytes: 100,
      width: 4,
      height: 4,
      sha256: 'a'.repeat(64),
      expiresAt,
    },
  });

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

test('makes a compiled flow permanent, grace-windows an orphan draft, leaves a snap alone', async () => {
  const orgId = organizationId();
  await prisma.organization.create({
    data: { id: orgId, name: 'Retention Org', slug: `retention-${newPublicId().toLowerCase()}` },
  });

  const now = new Date();
  const plus30Days = new Date(now.getTime() + 30 * 86_400_000);
  const plus1Hour = new Date(now.getTime() + 3_600_000);

  const compiledAsset = await seedAsset(orgId, 'step', plus30Days);
  const compiledFlow = await prisma.flow.create({
    data: { publicId: newPublicId(), organizationId: orgId, title: 'Compiled flow' },
  });
  const compiledRun = await prisma.run.create({
    data: {
      publicId: newPublicId(),
      flowId: compiledFlow.id,
      status: 'compiled',
      compiledAt: now,
    },
  });
  await prisma.step.create({
    data: {
      runId: compiledRun.id,
      order: 1,
      action: 'click',
      instruction: 'Click',
      assetId: compiledAsset.id,
    },
  });
  await prisma.flow.update({ where: { id: compiledFlow.id }, data: { latestRunId: compiledRun.id } });

  const orphanAsset = await seedAsset(orgId, 'step', plus30Days);
  const orphanFlow = await prisma.flow.create({
    data: { publicId: newPublicId(), organizationId: orgId, title: 'Draft flow' },
  });
  const orphanRun = await prisma.run.create({
    data: { publicId: newPublicId(), flowId: orphanFlow.id },
  });
  await prisma.step.create({
    data: {
      runId: orphanRun.id,
      order: 1,
      action: 'click',
      instruction: 'Click',
      assetId: orphanAsset.id,
    },
  });

  const snapAsset = await seedAsset(orgId, 'snap', plus1Hour);

  await runBackfill();

  const compiledAfter = await prisma.asset.findUniqueOrThrow({ where: { id: compiledAsset.id } });
  expect(compiledAfter.expiresAt).toBeNull();

  const orphanAfter = await prisma.asset.findUniqueOrThrow({ where: { id: orphanAsset.id } });
  expect(orphanAfter.expiresAt).not.toBeNull();
  const graceMs = orphanAfter.expiresAt!.getTime() - now.getTime();
  expect(graceMs).toBeGreaterThan(6 * 86_400_000);
  expect(graceMs).toBeLessThan(8 * 86_400_000);

  const snapAfter = await prisma.asset.findUniqueOrThrow({ where: { id: snapAsset.id } });
  expect(snapAfter.expiresAt?.getTime()).toBe(plus1Hour.getTime());

  const orphanExpiresAfterFirstRun = orphanAfter.expiresAt!.getTime();

  await runBackfill();

  const compiledSecond = await prisma.asset.findUniqueOrThrow({ where: { id: compiledAsset.id } });
  expect(compiledSecond.expiresAt).toBeNull();

  const orphanSecond = await prisma.asset.findUniqueOrThrow({ where: { id: orphanAsset.id } });
  expect(orphanSecond.expiresAt!.getTime()).toBe(orphanExpiresAfterFirstRun);

  const snapSecond = await prisma.asset.findUniqueOrThrow({ where: { id: snapAsset.id } });
  expect(snapSecond.expiresAt?.getTime()).toBe(plus1Hour.getTime());
});
