import { afterAll, beforeEach, expect, test } from 'bun:test';
import { cleanDatabase } from '../test/helpers';
import { getPrisma } from './db';
import { newPublicId } from './ids';

const prisma = getPrisma();

const MIGRATION_PATH = `${import.meta.dir}/../prisma/migrations/20261001030000_reader_site/migration.sql`;

/** Pulls the slug and search backfill statements from the migration file, exactly as a deploy would run them. */
const backfillStatements = async (): Promise<string[]> => {
  const text = await Bun.file(MIGRATION_PATH).text();
  const stripped = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const doBlock = stripped.match(/DO \$\$[\s\S]*?END \$\$;/)?.[0];
  const update = stripped.match(/UPDATE "Flow" f SET "search"[\s\S]*?;\n/)?.[0];

  if (!doBlock) throw new Error('DO block not found in migration');
  if (!update) throw new Error('search UPDATE not found in migration');

  return [doBlock.replace(/;\s*$/, ''), update.trim().replace(/;\s*$/, '')];
};

const runBackfill = async () => {
  for (const statement of await backfillStatements()) {
    await prisma.$executeRawUnsafe(statement);
  }
};

const orgId = (label: string) => `reader-backfill-${label}-${newPublicId()}`;

const createOrg = async (label: string) =>
  prisma.organization.create({
    data: { id: orgId(label), name: label, slug: `rb-${label}-${newPublicId().slice(0, 8).toLowerCase()}` },
  });

/** Creates a flow with a null slug/search and a specific createdAt, so backfill order is deterministic. */
const createFlow = async (organizationId: string, title: string, createdAt: Date) => {
  const flow = await prisma.flow.create({
    data: { publicId: newPublicId(), organizationId, title, createdAt },
  });
  await prisma.$executeRaw`UPDATE "Flow" SET "slug" = NULL, "search" = NULL WHERE id = ${flow.id}`;
  return flow;
};

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

test('backfill slugs same-title flows in one workspace oldest-first, a second workspace independently, empty titles to "guide", and fills search; rerunning changes nothing', async () => {
  const orgA = await createOrg('a');
  const orgB = await createOrg('b');

  const now = Date.now();
  const older = await createFlow(orgA.id, 'Reset a password', new Date(now));
  const newer = await createFlow(orgA.id, 'Reset a password', new Date(now + 1000));
  const otherWorkspace = await createFlow(orgB.id, 'Reset a password', new Date(now));
  const emptyTitle = await createFlow(orgA.id, '   ', new Date(now + 2000));

  await runBackfill();

  const olderAfter = await prisma.flow.findUniqueOrThrow({ where: { id: older.id } });
  const newerAfter = await prisma.flow.findUniqueOrThrow({ where: { id: newer.id } });
  const otherAfter = await prisma.flow.findUniqueOrThrow({ where: { id: otherWorkspace.id } });
  const emptyAfter = await prisma.flow.findUniqueOrThrow({ where: { id: emptyTitle.id } });

  expect(olderAfter.slug).toBe('reset-a-password');
  expect(newerAfter.slug).toBe('reset-a-password-2');
  expect(otherAfter.slug).toBe('reset-a-password');
  expect(emptyAfter.slug).toBe('guide');

  const searchRows = await prisma.$queryRaw<{ id: string; nonNull: boolean }[]>`
    SELECT id, search IS NOT NULL AS "nonNull" FROM "Flow" WHERE id IN (${older.id}, ${newer.id}, ${otherWorkspace.id}, ${emptyTitle.id})
  `;
  for (const row of searchRows) expect(row.nonNull).toBe(true);

  await runBackfill();

  const olderSecond = await prisma.flow.findUniqueOrThrow({ where: { id: older.id } });
  const newerSecond = await prisma.flow.findUniqueOrThrow({ where: { id: newer.id } });
  const otherSecond = await prisma.flow.findUniqueOrThrow({ where: { id: otherWorkspace.id } });
  const emptySecond = await prisma.flow.findUniqueOrThrow({ where: { id: emptyTitle.id } });

  expect(olderSecond.slug).toBe(olderAfter.slug);
  expect(newerSecond.slug).toBe(newerAfter.slug);
  expect(otherSecond.slug).toBe(otherAfter.slug);
  expect(emptySecond.slug).toBe(emptyAfter.slug);
});

test('titles "Setup", "Setup" and "Setup 2" in one workspace get distinct slugs', async () => {
  const org = await createOrg('c');
  const now = Date.now();
  const flow1 = await createFlow(org.id, 'Setup', new Date(now));
  const flow2 = await createFlow(org.id, 'Setup', new Date(now + 1000));
  const flow3 = await createFlow(org.id, 'Setup 2', new Date(now + 2000));

  await runBackfill();

  const loaded1 = await prisma.flow.findUniqueOrThrow({ where: { id: flow1.id } });
  const loaded2 = await prisma.flow.findUniqueOrThrow({ where: { id: flow2.id } });
  const loaded3 = await prisma.flow.findUniqueOrThrow({ where: { id: flow3.id } });

  const slugs = [loaded1.slug, loaded2.slug, loaded3.slug];
  expect(slugs).toEqual(['setup', 'setup-2', 'setup-2-2']);
  expect(new Set(slugs).size).toBe(3);
});
