// Must stay the first import: a bad env stops the process before anything reads it.
import './env-check';
import { Elysia, NotFoundError } from 'elysia';
import { auth } from './auth';
import { getEnv } from './env';
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
import { activityLogRoute } from './routes/activity-log';
import { runsRoute } from './routes/runs';
import { keyGuard } from './site/key-guard';
import { publicRoute } from './site/public';
import { siteRoute } from './site/routes';
import { bootCheck, e2eLoginRoute } from './e2e-login';
import { getInstanceOrg } from './instance-org';
import { type Storage, warnIfStorageUnreachable } from './storage/provider';

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
  // Test-only: substitutes a fake Storage for uploads and image reads.
  storage?: Storage,
) => {
  bootCheck();
  return new Elysia()
    .use(errorPlugin)
    .use(meRoute)
    .use(assetsRoute(storage))
    .use(runsRoute)
    .use(flowsRoute)
    .use(flowsAdminRoute)
    .use(recordingStatusRoute)
    .use(stepsAdminRoute)
    .use(analyticsRoute)
    .use(docsRoute)
    .use(siteRoute)
    .use(categoriesRoute)
    .use(membersRoute)
    .use(accountRoute)
    .use(activityLogRoute)
    .use(publicRoute)
    // Public image delivery under /api; it must be registered before the catch-all auth mount.
    .use(imagesRoute(storage))
    .use(e2eLoginRoute())
    .use(keyGuard)
    .mount(authHandler)
    .use(healthRoute(checkDb));
};

export const app = createApp();

if (import.meta.main) {
  const env = getEnv();
  app.listen({
    port: env.port,
    // Headroom over the upload limit so the route itself answers 413 rather than Bun
    // dropping the connection at exactly MAX_UPLOAD_BYTES.
    maxRequestBodySize: env.limits.maxUploadBytes + 64 * 1024,
  });
  startTtlJob();
  console.log(`opendocs api listening on :${env.port} (${env.publicUrl})`);

  if (!env.github && process.env.E2E_LOGIN_ENABLED !== 'true') {
    console.warn('warning: no sign-in method configured (set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET)');
  }
  // Both are non-blocking: an unreachable bucket or a cold database only logs.
  void warnIfStorageUnreachable();
  void getInstanceOrg().catch((error) => console.warn(`warning: could not create the instance workspace (${error})`));
}
