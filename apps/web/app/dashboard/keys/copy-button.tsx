'use client';

import { useState } from 'react';

export function CopyButton({
  value,
  label = 'Copy',
  className = 'btn',
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      // Denied permission or an insecure context: tell the user to copy by hand.
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2000);
  }

  return (
    <button type="button" className={className} onClick={copy}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed, select and copy' : label}
    </button>
  );
}
