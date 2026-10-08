import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession } from '@/lib/server-api';

import { SignInButton } from './sign-in-button';

import '../dashboard/admin.css';

export const metadata = { title: 'Sign in — OpenDocs' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);

  if (session) redirect('/dashboard');

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
              Sign-in was cancelled
            </p>
          ) : null}
          <div className="adm-auth-actions">
            <SignInButton />
          </div>
        </div>
      </main>
    </div>
  );
}
