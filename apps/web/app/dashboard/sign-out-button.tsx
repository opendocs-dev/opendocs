'use client';

import { useState } from 'react';

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);

    try {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: '{}',
      });
    } finally {
      window.location.href = '/sign-in';
    }
  }

  return (
    <button
      type="button"
      className="umenu-item"
      onClick={signOut}
      disabled={pending}
      role="menuitem"
    >
      Sign out
    </button>
  );
}
