import { MAX_BYTES } from '@opendocs/core';
import { Elysia, NotFoundError } from 'elysia';
import { auth } from './auth';
import { accountRoute } from './routes/account';
import { analyticsRoute } from './routes/analytics';
import { categoriesRoute } from './categories/routes';
import { errorPlugin } from './errors';
import { assetsRoute } from './routes/assets';
import { docsRoute } from './routes/docs';
import { flowsRoute } from './routes/flows';
import { flowsAdminRoute } from './routes/flows-admin';
import { recordingStatusRoute } from './routes/recording-status';
import { stepsAdminRoute } from './routes/steps-admin';
import { startTtlJob } from './jobs/ttl';
import { healthRoute, type DatabaseCheck } from './routes/health';
import { imagesRoute } from './routes/images';
import { meRoute } from './routes/me';
import { membersRoute } from './routes/members';
import { planRoute } from './routes/plan';
import { billingRoute } from './routes/billing';
import { platformReservedNamesRoute } from './platform/reserved-names';
import { platformStaffRoute } from './platform/staff';
import { platformAuditLogRoute } from './platform/audit-log';
import { platformDomainsRoute } from './platform/domains';
import { platformTenantsRoute } from './platform/tenants';
import { platformReportsRoute } from './platform/reports';
import { platformAiModelsRoute } from './platform/ai-models';
import { platformAiLimitsRoute } from './platform/ai-limits';
import { activityLogRoute } from './routes/activity-log';
import { runsRoute } from './routes/runs';
import { assistantRoute } from './routes/assistant';
import { storageRoute } from './routes/storage';
import { workspacesRoute } from './routes/workspaces';
import { keyGuard } from './site/key-guard';
import { publicRoute } from './site/public';
import { siteRoute } from './site/routes';
import { bootCheck, e2eLoginRoute } from './e2e-login';
import type { StorageConnection } from '../generated/prisma/client';
import type { StorageProvider, Storage } from './storage/provider';

/**
 * Better-Auth needs the untouched `/api/auth/*` path, so it is mounted at the root
 * rather than under a prefix (Elysia strips a mount prefix before calling the handler).
 * A root mount is a catch-all, so anything outside the auth base path is handed back
 * to the error plugin to keep the shared 404 error shape.
 */
const authHandler = (request: Request) => {
  if (!new URL(request.url).pathname.startsWith('/api/auth/')) throw new NotFoundError();
  return auth.handler(request);
};

export const createApp = (
  checkDb?: DatabaseCheck,
  storage?: Storage,
  // Test-only: substitutes a fake StorageProvider for the storage connect/test route,
  // the same seam `storage` is for uploads and image reads.
  storageConnectionProvider?: (connection: StorageConnection) => StorageProvider,
) => {
  bootCheck();
  return new Elysia()
    .use(errorPlugin)
    .use(meRoute)
    .use(planRoute)
    .use(billingRoute)
    .use(assetsRoute(storage, storageConnectionProvider))
    .use(runsRoute)
    .use(flowsRoute)
    .use(flowsAdminRoute)
    .use(recordingStatusRoute)
    .use(stepsAdminRoute)
    .use(analyticsRoute)
    .use(docsRoute)
    .use(siteRoute)
    .use(categoriesRoute)
    .use(storageRoute(storageConnectionProvider))
    .use(workspacesRoute)
    .use(platformReservedNamesRoute)
    .use(membersRoute)
    .use(accountRoute)
    .use(platformStaffRoute)
    .use(platformAuditLogRoute)
    .use(platformDomainsRoute)
    .use(platformTenantsRoute)
    .use(platformReportsRoute)
    .use(platformAiModelsRoute)
    .use(platformAiLimitsRoute)
    .use(activityLogRoute)
    .use(assistantRoute)
    .use(publicRoute)
    // Public and at the root (not under /api), so it must be registered before the
    // catch-all auth mount.
    .use(imagesRoute(storage))
    .use(e2eLoginRoute())
    .use(keyGuard)
    .mount(authHandler)
    .use(healthRoute(checkDb));
};

export const app = createApp();

if (import.meta.main) {
  app.listen({
    port: Number(process.env.PORT ?? 4000),
    // Headroom over the asset limit so the route itself answers 413 rather than Bun
    // dropping the connection at exactly MAX_BYTES.
    maxRequestBodySize: MAX_BYTES + 64 * 1024,
  });
  startTtlJob();
}
