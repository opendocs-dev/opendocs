import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  callback,
  cleanDatabase,
  GITHUB_ACCOUNT,
  OTHER_GITHUB_ACCOUNT,
  realFetch,
  signIn,
  startSignIn,
  stubGitHub,
} from '../test/helpers';
import { restoreEnv, setEnv } from '../test/env';
import { getPrisma } from './db';
import { createApp } from './index';
import { isSignupOpen, SIGNUP_CLOSED_MESSAGE } from './signup-policy';

const prisma = getPrisma();

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  restoreEnv();
});

afterAll(async () => {
  await cleanDatabase();
});

const roleOf = async (email: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return (await prisma.member.findFirstOrThrow({ where: { userId: user.id } })).role;
};

test('first user is owner regardless of ADMIN_EMAILS', async () => {
  setEnv({ ADMIN_EMAILS: 'someone-else@example.com', ALLOW_SIGNUP: undefined });
  const app = createApp(async () => {});

  await signIn(app);

  expect(await roleOf(GITHUB_ACCOUNT.email!)).toBe('owner');
});

test('admin email becomes admin (case-insensitive)', async () => {
  setEnv({ ADMIN_EMAILS: OTHER_GITHUB_ACCOUNT.email!.toUpperCase() });
  const app = createApp(async () => {});

  await signIn(app);
  await signIn(app, OTHER_GITHUB_ACCOUNT);

  expect(await roleOf(GITHUB_ACCOUNT.email!)).toBe('owner');
  expect(await roleOf(OTHER_GITHUB_ACCOUNT.email!)).toBe('admin');
});

test('closed signup refuses a stranger with a clear message', async () => {
  setEnv({ ALLOW_SIGNUP: 'false', ADMIN_EMAILS: GITHUB_ACCOUNT.email! });
  const app = createApp(async () => {});
  await signIn(app); // listed in ADMIN_EMAILS, so admitted

  stubGitHub(OTHER_GITHUB_ACCOUNT);
  const { state, cookie } = await startSignIn(app);
  const response = await callback(app, `code=${crypto.randomUUID()}&state=${state}`, cookie);

  expect(response.status).toBe(302);
  const location = new URL(response.headers.get('location')!, 'http://localhost');
  expect(location.searchParams.get('error')).toBe('signup_closed');
  expect(location.searchParams.get('error_description')).toBe(SIGNUP_CLOSED_MESSAGE);
  expect(response.headers.getSetCookie().some((entry) => entry.includes('session_token='))).toBe(false);
  expect(await prisma.user.count()).toBe(1);
  expect(await prisma.member.count()).toBe(1);
});

test('unset ALLOW_SIGNUP is open until the first user exists, then closed', async () => {
  setEnv({ ALLOW_SIGNUP: undefined });
  const app = createApp(async () => {});

  expect(await isSignupOpen('anyone@example.com')).toBe(true);
  await signIn(app);
  expect(await isSignupOpen('anyone@example.com')).toBe(false);
  expect(await isSignupOpen('admin@example.com')).toBe(true);

  stubGitHub(OTHER_GITHUB_ACCOUNT);
  const { state, cookie } = await startSignIn(app);
  const response = await callback(app, `code=${crypto.randomUUID()}&state=${state}`, cookie);
  expect(new URL(response.headers.get('location')!, 'http://localhost').searchParams.get('error')).toBe('signup_closed');
  expect(await prisma.user.count()).toBe(1);
});

test('an existing user can still sign in after signup closed', async () => {
  setEnv({ ALLOW_SIGNUP: undefined });
  const app = createApp(async () => {});
  await signIn(app);

  const cookie = await signIn(app);
  expect(cookie).toContain('session_token=');
  expect(await prisma.user.count()).toBe(1);
});

test('explicit ALLOW_SIGNUP=true admits', async () => {
  setEnv({ ALLOW_SIGNUP: 'true' });
  const app = createApp(async () => {});

  await signIn(app);
  await signIn(app, OTHER_GITHUB_ACCOUNT);

  expect(await prisma.user.count()).toBe(2);
  expect(await roleOf(OTHER_GITHUB_ACCOUNT.email!)).toBe('editor');
});
