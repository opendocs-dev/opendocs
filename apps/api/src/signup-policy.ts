import { getPrisma } from './db';
import { getEnv } from './env';
import { isAdminEmail } from './instance-org';

export const SIGNUP_CLOSED_MESSAGE = 'Sign-up is closed on this instance';

/**
 * Whether a brand new user may be created (C23 AC-07). An email in `ADMIN_EMAILS` is always
 * admitted; otherwise an explicit `ALLOW_SIGNUP` wins, and unset means open until the first user exists.
 */
export const isSignupOpen = async (email: string): Promise<boolean> => {
  if (isAdminEmail(email)) return true;
  const { allowSignup } = getEnv();
  if (allowSignup !== undefined) return allowSignup;
  return (await getPrisma().user.count()) === 0;
};
