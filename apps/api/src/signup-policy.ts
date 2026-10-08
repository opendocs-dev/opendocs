import { getPrisma } from './db';
import { getEnv } from './env';
import { isAdminEmail } from './instance-org';

export const SIGNUP_CLOSED_MESSAGE = 'Sign-up is closed on this instance';

/**
 * Whether a brand new user may be created (C23 AC-07). An email in `ADMIN_EMAILS` is always
 * admitted. Until the instance has an owner nobody else is: the first owner must be an
 * `ADMIN_EMAILS` address. After that an explicit `ALLOW_SIGNUP` wins and unset means closed.
 */
export const isSignupOpen = async (email: string): Promise<boolean> => {
  if (isAdminEmail(email)) return true;
  if ((await getPrisma().member.count({ where: { role: 'owner' } })) === 0) return false;
  return getEnv().allowSignup ?? false;
};
