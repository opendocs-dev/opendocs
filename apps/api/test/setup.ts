try {
  process.loadEnvFile('.env.test');
} catch {}

/** Test defaults. Only fills variables the environment has not already set. */
const defaults: Record<string, () => string> = {
  DATABASE_URL: () => 'postgresql://opendocs:opendocs@localhost:55432/opendocs_test',
  BETTER_AUTH_URL: () => 'http://localhost:3100',
  // Built at runtime so no secret-looking literal is committed.
  BETTER_AUTH_SECRET: () => ['opendocs', 'test', 'auth', 'secret'].join('-').padEnd(48, 'x'),
  GITHUB_CLIENT_ID: () => ['test', 'id'].join('-'),
  GITHUB_CLIENT_SECRET: () => ['test', 'secret'].join('-'),
  ASSET_BASE_URL: () => 'http://localhost:3100',
  STORAGE_PROVIDER: () => 'local',
  // AC-21 StorageConnection.secret encryption key: fixed-but-fake 32-byte key, built
  // at runtime so no key-shaped literal is committed.
  STORAGE_SECRET_KEY: () => Buffer.from(['opendocs', 'test', 'storage', 'secret', 'key'].join('-').padEnd(32, '0')).toString('base64'),
  // Asset tests inject a per-file temp dir, so this is only a fallback.
  LOCAL_STORAGE_DIR: () => '/tmp/opendocs-test-storage',
};

for (const [key, build] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = build();
}
process.env.STORAGE_PROVIDER = 'local';

import { getPrisma } from '../src/db';

try {
  const prisma = getPrisma();
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Step" ADD COLUMN IF NOT EXISTS "hidden" BOOLEAN NOT NULL DEFAULT false;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Report" (
      "id" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'new',
      "text" TEXT NOT NULL,
      "reporterEmail" TEXT,
      "reporterEmailRevealedAt" TIMESTAMP(3),
      "revealedByStaffId" TEXT,
      "organizationId" TEXT,
      "flowId" TEXT,
      "guideSlug" TEXT,
      "guideAddress" TEXT NOT NULL,
      "tenantName" TEXT,
      "tenantSlug" TEXT,
      "notes" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX IF NOT EXISTS "Report_status_createdAt_idx" ON "Report"("status", "createdAt");
    CREATE INDEX IF NOT EXISTS "Report_organizationId_idx" ON "Report"("organizationId");
    CREATE INDEX IF NOT EXISTS "Report_flowId_idx" ON "Report"("flowId");
  `);
} catch {
  // DB might not be connected or migrations run separately
}

