'use client';

import { agentSetup } from '@/lib/agent-setup';

import { CopyButton } from './copy-button';

/**
 * Shown once, right after a key is created: the raw key is not retrievable
 * afterwards, so the panel stays until the user closes it explicitly.
 */
export function NewKeyPanel({ keyValue, onClose }: { keyValue: string; onClose: () => void }) {
  const origin = typeof window !== 'undefined' ? window.location?.origin ?? '' : '';
  const setup = agentSetup(keyValue, origin);

  return (
    <section className="card" aria-label="New API key">
      <h3>Your new API key</h3>
      <p className="sub">
        Copy it now — this is the only time the full key is shown. Install:{' '}
        <a href="https://github.com/opendocs-dev/opendocs#build-from-source">
          Build the CLI from source
        </a>
      </p>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <pre style={{ flex: 1, margin: 0 }}>{keyValue}</pre>
        <CopyButton value={keyValue} label="Copy key" />
      </div>

      <h3 style={{ marginTop: '16px' }}>Claude Code</h3>
      <pre>{setup.claudeCode}</pre>
      <div style={{ marginTop: '10px' }}>
        <CopyButton value={setup.claudeCode} label="Copy Claude Code setup" />
      </div>

      <h3 style={{ marginTop: '16px' }}>Cursor</h3>
      <pre>{setup.cursor}</pre>
      <div style={{ marginTop: '10px' }}>
        <CopyButton value={setup.cursor} label="Copy Cursor setup" />
      </div>

      <h3 style={{ marginTop: '16px' }}>Other</h3>
      <pre>{setup.other}</pre>
      <div style={{ marginTop: '10px' }}>
        <CopyButton value={setup.other} label="Copy Other setup" />
      </div>

      <p style={{ marginTop: '16px' }}>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </p>
    </section>
  );
}
