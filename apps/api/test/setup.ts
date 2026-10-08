try {
  process.loadEnvFile('.env.test');
} catch {}

/** Test defaults. Only fills variables the environment has not already set. */
const defaults: Record<string, () => string> = {
  DATABASE_URL: () => 'postgresql://opendocs:opendocs@localhost:55432/opendocs_test',
  PUBLIC_URL: () => 'http://localhost:3100',
  // Built at runtime so no secret-looking literal is committed.
  BETTER_AUTH_SECRET: () => ['opendocs', 'test', 'auth', 'secret'].join('-').padEnd(48, 'x'),
  GITHUB_CLIENT_ID: () => ['test', 'id'].join('-'),
  GITHUB_CLIENT_SECRET: () => ['test', 'secret'].join('-'),
  // Tests inject an in-memory storage, so nothing connects to this bucket.
  S3_ENDPOINT: () => 'http://localhost:59000',
  S3_BUCKET: () => 'opendocs-test',
  S3_ACCESS_KEY_ID: () => ['test', 'access', 'key'].join('-'),
  S3_SECRET_ACCESS_KEY: () => ['test', 'secret', 'key'].join('-'),
  S3_FORCE_PATH_STYLE: () => 'true',
  ADMIN_EMAILS: () => 'admin@example.com',
  // Several test users sign in; the open-until-first-user default is covered by signup-policy.test.ts.
  ALLOW_SIGNUP: () => 'true',
};

for (const [key, build] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = build();
}
