'use client';

import { useState } from 'react';

export function SignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider: 'github',
          callbackURL: '/dashboard',
          errorCallbackURL: '/sign-in?error=cancelled',
        }),
      });

      const body = (await response.json()) as { url?: string };

      if (!response.ok || !body.url) throw new Error('no redirect url');

      window.location.href = body.url;
    } catch {
      setError('Could not start sign-in. Please try again.');
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="btn b" onClick={signIn} disabled={pending}>
        Continue with GitHub
      </button>
      {error ? (
        <p role="alert" className="callout bad">
          {error}
        </p>
      ) : null}
    </>
  );
}
