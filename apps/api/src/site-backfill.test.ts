import { afterAll, beforeEach, expect, test } from 'bun:test';
import { cleanDatabase } from '../test/helpers';
import { getPrisma } from './db';

const prisma = getPrisma();

const MIGRATION_PATH = `${import.meta.dir}/../prisma/migrations/20261001010000_site_foundation/migration.sql`;
const CHECK_SQL =
  'ALTER TABLE "Organization" ADD CONSTRAINT organization_slug_format ' +
  `CHECK ("slug" ~ '^[a-z0-9]([a-z0-9]|-(?!-))*[a-z0-9]$' AND char_length("slug") BETWEEN 3 AND 30)`;

/** Pulls the backfill statements (everything up to and including the CHECK) from the migration file. */
const backfillStatements = async (): Promise<string[]> => {
  const sql = await Bun.file(MIGRATION_PATH).text();
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .filter(
      (statement) =>
        statement.startsWith('INSERT INTO "SiteAddressHistory"') ||
        statement.startsWith('UPDATE "Organization"') ||
        statement.startsWith('INSERT INTO "WorkspaceSite"'),
    );
};

const runBackfill = async () => {
  for (const statement of await backfillStatements()) {
    await prisma.$executeRawUnsafe(statement);
  }
};

const orgId = (label: string) => `site-backfill-${label}-${crypto.randomUUID()}`;

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

test('backfill gives every organization a WorkspaceSite, fixes invalid/reserved slugs, and is idempotent', async () => {
  await prisma.$executeRawUnsafe('ALTER TABLE "Organization" DROP CONSTRAINT organization_slug_format');

  const validId = orgId('valid');
  const invalidId = orgId('invalid');
  const reservedId = orgId('reserved');

  try {
    await prisma.organization.create({ data: { id: validId, name: 'Valid Org', slug: 'valid-slug' } });
    await prisma.organization.create({ data: { id: invalidId, name: 'Invalid Org', slug: 'A_b' } });
    await prisma.organization.create({ data: { id: reservedId, name: 'Reserved Org', slug: 'admin' } });

    await runBackfill();

    const valid = await prisma.organization.findUniqueOrThrow({ where: { id: validId } });
    expect(valid.slug).toBe('valid-slug');

    const invalid = await prisma.organization.findUniqueOrThrow({ where: { id: invalidId } });
    expect(invalid.slug).toMatch(/^ws-[0-9a-f]{8}$/);
    const invalidHistory = await prisma.siteAddressHistory.findUniqueOrThrow({ where: { slug: 'a_b' } });
    expect(invalidHistory.organizationId).toBe(invalidId);

    const reservedOrg = await prisma.organization.findUniqueOrThrow({ where: { id: reservedId } });
    expect(reservedOrg.slug).toMatch(/^ws-[0-9a-f]{8}$/);
    const reservedHistory = await prisma.siteAddressHistory.findUniqueOrThrow({ where: { slug: 'admin' } });
    expect(reservedHistory.organizationId).toBe(reservedId);

    for (const id of [validId, invalidId, reservedId]) {
      const site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: id } });
      expect(site.siteTitle).toBeTruthy();
    }

    const slugsAfterFirstRun = {
      valid: (await prisma.organization.findUniqueOrThrow({ where: { id: validId } })).slug,
      invalid: (await prisma.organization.findUniqueOrThrow({ where: { id: invalidId } })).slug,
      reserved: (await prisma.organization.findUniqueOrThrow({ where: { id: reservedId } })).slug,
    };

    await runBackfill();

    expect((await prisma.organization.findUniqueOrThrow({ where: { id: validId } })).slug).toBe(
      slugsAfterFirstRun.valid,
    );
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: invalidId } })).slug).toBe(
      slugsAfterFirstRun.invalid,
    );
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: reservedId } })).slug).toBe(
      slugsAfterFirstRun.reserved,
    );
    expect(await prisma.workspaceSite.count()).toBe(3);
  } finally {
    await cleanDatabase();
    await prisma.$executeRawUnsafe(CHECK_SQL);
  }
});
