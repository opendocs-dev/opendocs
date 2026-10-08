import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession } from '@/lib/server-api';

import { SignInButton } from './sign-in-button';

import '../admin/admin.css';

export const metadata = { title: 'Sign in — OpenDocs' };

/** Only same-site paths under /admin are honoured, so `next` can never become an open redirect. */
function safeNext(raw: string | undefined): string {
  return raw && /^\/admin(\/|\?|#|$)/.test(raw) && !raw.includes('//') ? raw : '/admin';
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  const next = safeNext(params.next);

  if (session) redirect(next);

  return (
    <div className="adm adm-auth">
      <main className="adm-auth-container">
        <div className="adm-auth-brand">
          <Link href="/" className="adm-nav-brand">
            OpenDocs
          </Link>
        </div>
        <div className="card adm-auth-card">
          <h1>Sign in</h1>
          <p className="sub">Already have an account? Continue with the same GitHub login.</p>
          {params.error ? (
            <p role="alert" className="callout bad">
              {params.error === 'signup_closed'
                ? 'Sign-up is closed on this instance'
                : 'Sign-in was cancelled'}
            </p>
          ) : null}
          <div className="adm-auth-actions">
            <SignInButton next={next} />
          </div>
        </div>
      </main>
    </div>
  );
}
