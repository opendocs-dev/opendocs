'use client';

import { useState } from 'react';

import { agentSetup } from '@/lib/agent-setup';

import { CopyButton } from './copy-button';

const COMPILE_EXAMPLE = `opendocs_compile {
  title: "Create a WhatsApp template",
  category: "WhatsApp"
}`;

type Tool = 'claudeCode' | 'cursor' | 'other';

/**
 * Permanent setup card (C18-AC14): unlike NewKeyPanel, this has no key value and
 * never disappears, so returning admins can always find the connection snippet
 * and the opendocs_compile example with a category.
 */
export function ConnectToolCard() {
  const [tool, setTool] = useState<Tool>('claudeCode');
  const origin = typeof window !== 'undefined' ? window.location?.origin ?? '' : '';
  const setup = agentSetup(null, origin);
  const snippet =
    tool === 'claudeCode' ? setup.claudeCode : tool === 'cursor' ? setup.cursor : setup.other;
  const toolName =
    tool === 'claudeCode' ? 'Claude Code' : tool === 'cursor' ? 'Cursor' : 'Other';

  return (
    <section className="card" aria-label="Connect your tool">
      <h3>Connect your tool</h3>
      <p className="sub">Create a key above, then use it here to connect your coding agent.</p>

      <div className="seg" role="tablist" aria-label="Tool" style={{ marginTop: '12px' }}>
        <button
          type="button"
          role="tab"
          aria-selected={tool === 'claudeCode'}
          aria-pressed={tool === 'claudeCode'}
          onClick={() => setTool('claudeCode')}
        >
          Claude Code
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tool === 'cursor'}
          aria-pressed={tool === 'cursor'}
          onClick={() => setTool('cursor')}
        >
          Cursor
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tool === 'other'}
          aria-pressed={tool === 'other'}
          onClick={() => setTool('other')}
        >
          Other
        </button>
      </div>

      <pre>{snippet}</pre>
      <div style={{ marginTop: '10px', marginBottom: '16px' }}>
        <CopyButton value={snippet} label={`Copy ${toolName} setup`} />
      </div>

      <p className="sub" style={{ marginTop: '16px' }}>
        Ask: &quot;Record how to create a template and file it under WhatsApp.&quot; The agent sends the category with the guide.
      </p>
      <pre>{COMPILE_EXAMPLE}</pre>
      <div style={{ marginTop: '10px' }}>
        <CopyButton value={COMPILE_EXAMPLE} label="Copy compile example" />
      </div>
    </section>
  );
}
