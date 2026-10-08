import { Elysia, NotFoundError } from 'elysia';
import { auth } from './auth';
import { getPrisma } from './db';
import { ApiError } from './errors';
import { joinInstanceOrg } from './instance-org';

const ALLOWED_ROLES = ['owner', 'admin', 'editor'] as const;
type Role = (typeof ALLOWED_ROLES)[number];

const isValidRole = (role: string): role is Role =>
  ALLOWED_ROLES.includes(role as Role);

/**
 * Validates the E2E bypass configuration at boot time if enabled.
 * Throws an Error if enabled in production or without a token of at least 24 chars.
 * Never logs or echoes the token.
 */
export const bootCheck = (): void => {
  if (process.env.E2E_LOGIN_ENABLED === 'true') {
    if (
      process.env.NODE_ENV === 'production' ||
      !process.env.E2E_LOGIN_TOKEN ||
      process.env.E2E_LOGIN_TOKEN.length < 24
    ) {
      throw new Error(
        'E2E login bypass is enabled but misconfigured (refusing to boot in production or with token shorter than 24 chars)',
      );
    }
  }
};

export const checkE2ELoginBoot = bootCheck;

/**
 * Constant-time comparison between input token and configured token.
 * Length mismatch or any byte mismatch throws NotFoundError.
 */
const verifyTokenOrThrow = (inputToken: unknown, expectedToken: string | undefined): void => {
  if (typeof inputToken !== 'string' || !expectedToken) {
    throw new NotFoundError();
  }

  const inputBuf = Buffer.from(inputToken);
  const expectedBuf = Buffer.from(expectedToken);

  if (inputBuf.length !== expectedBuf.length) {
    throw new NotFoundError();
  }

  if (!crypto.timingSafeEqual(inputBuf, expectedBuf)) {
    throw new NotFoundError();
  }
};

interface CookieOptions {
  path?: string;
  httpOnly?: boolean;
  sameSite?: 'lax' | 'strict' | 'none' | boolean;
  secure?: boolean;
  maxAge?: number;
  domain?: string;
}

const serializeCookie = (name: string, value: string, options?: CookieOptions): string => {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options?.path ?? '/'}`);
  if (options?.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  if (options?.sameSite) {
    const s = options.sameSite;
    const sameSiteStr =
      typeof s === 'string'
        ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
        : 'Lax';
    parts.push(`SameSite=${sameSiteStr}`);
  }
  if (options?.secure) {
    parts.push('Secure');
  }
  if (typeof options?.maxAge === 'number') {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options?.domain) {
    parts.push(`Domain=${options.domain}`);
  }
  return parts.join('; ');
};

export const e2eLoginRoute = (app?: Elysia) => {
  const instance = app ?? new Elysia();

  if (process.env.E2E_LOGIN_ENABLED !== 'true') {
    return instance;
  }

  return instance.get('/api/test/login', async ({ query }) => {
    verifyTokenOrThrow(query.token, process.env.E2E_LOGIN_TOKEN);

    const roleParam = query.role ?? 'owner';
    if (typeof roleParam !== 'string' || !isValidRole(roleParam)) {
      throw new ApiError(422, 'validation_failed', 'Invalid role: must be owner, admin, or editor');
    }

    const nextParam = query.next ?? '/admin';
    if (
      typeof nextParam !== 'string' ||
      !nextParam.startsWith('/') ||
      nextParam.startsWith('//') ||
      nextParam.includes('\\')
    ) {
      throw new ApiError(422, 'validation_failed', 'Invalid next URL: must start with / and not contain // or \\');
    }

    const prisma = getPrisma();
    const email = 'e2e@opendocs.test';
    const name = 'E2E Tester';

    // 1. Find or create the test user
    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: crypto.randomUUID(),
          email,
          name,
          emailVerified: true,
        },
      });
    }

    // 2. Ensure the user is a member of the instance workspace
    await joinInstanceOrg(user);

    const member = await prisma.member.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });

    // 3. Create Better-Auth session
    const authContext = await auth.$context;
    const sessionRecord = await authContext.internalAdapter.createSession(user.id);

    // 4. Update member role (after the session exists: creating a session re-syncs roles from ADMIN_EMAILS)
    if (member.role !== roleParam) {
      await prisma.member.update({
        where: { id: member.id },
        data: { role: roleParam },
      });
    }

    // 5. Sign and set session cookie
    const cookieConfig = authContext.authCookies.sessionToken;
    // Same signing as Better-Auth: base64 HMAC-SHA256 of the token, value URI-encoded.
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(authContext.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sessionRecord.token));
    const signedValue = encodeURIComponent(
      `${sessionRecord.token}.${Buffer.from(signature).toString('base64')}`,
    );
    const cookieHeader = serializeCookie(cookieConfig.name, signedValue, cookieConfig.attributes as CookieOptions);

    return new Response(null, {
      status: 302,
      headers: {
        Location: nextParam,
        'Set-Cookie': cookieHeader,
      },
    });
  });
};
