'use client';

export interface ChatPreviewProps {
  name: string;
  buttonLabel: string;
  welcome: string;
  suggested: string[];
  preset?: string;
  showSources?: boolean;
}

const PRESET_COLORS: Record<string, { paper: string; accent: string; mark: string; text: string }> = {
  sage: { paper: '#ECF1EE', accent: '#0F6B54', mark: '#FFC83D', text: '#14211D' },
  atlas: { paper: '#F7F8FA', accent: '#2450D6', mark: '#FFE14D', text: '#0F172A' },
  ledger: { paper: '#FAFAFA', accent: '#8C1D2C', mark: '#FFD9A8', text: '#1C1917' },
};

export function ChatPreview({
  name,
  buttonLabel,
  welcome,
  suggested,
  preset = 'sage',
  showSources = true,
}: ChatPreviewProps) {
  const colors = PRESET_COLORS[preset] ?? PRESET_COLORS.sage;

  return (
    <div
      style={{
        border: '1px solid var(--a-line)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--a-surface)',
        display: 'flex',
        flexDirection: 'column',
        height: 480,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          background: colors.paper,
          borderBottom: '1px solid var(--a-line)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: colors.accent,
              color: '#ffffff',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            AI
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: colors.text }}>
              {name || 'AI Assistant'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--a-muted)' }}>Powered by OpenDocs</div>
          </div>
        </div>
        <span
          className="badge"
          style={{
            background: `${colors.accent}1A`,
            color: colors.accent,
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          {buttonLabel || 'Ask AI'}
        </span>
      </div>

      {/* Messages Scroll Area */}
      <div
        style={{
          flex: 1,
          padding: 16,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: 'var(--a-surface)',
        }}
      >
        {/* Welcome Message Bubble */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div
            style={{
              background: 'var(--a-bg)',
              border: '1px solid var(--a-line)',
              borderRadius: '4px 12px 12px 12px',
              padding: '10px 14px',
              maxWidth: '85%',
              fontSize: 13.5,
              lineHeight: 1.5,
              color: 'var(--a-ink)',
            }}
          >
            {welcome || 'How can I help you today?'}
          </div>
        </div>

        {/* Suggested Questions Chips */}
        {suggested && suggested.filter(Boolean).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {suggested.filter(Boolean).map((q, idx) => (
              <span
                key={idx}
                style={{
                  background: 'var(--a-surface)',
                  border: `1px solid ${colors.accent}40`,
                  borderRadius: 16,
                  padding: '4px 10px',
                  fontSize: 12,
                  color: colors.accent,
                  cursor: 'default',
                  display: 'inline-block',
                }}
              >
                {q}
              </span>
            ))}
          </div>
        )}

        {/* Example Question & Answer Simulation */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <div
            style={{
              background: colors.accent,
              color: '#ffffff',
              borderRadius: '12px 12px 4px 12px',
              padding: '8px 12px',
              fontSize: 13,
              maxWidth: '80%',
            }}
          >
            How do I get started with the API?
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div
            style={{
              background: 'var(--a-bg)',
              border: '1px solid var(--a-line)',
              borderRadius: '4px 12px 12px 12px',
              padding: '10px 14px',
              maxWidth: '85%',
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--a-ink)',
            }}
          >
            To authenticate with the API, include your API key in the{' '}
            <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.06)', padding: '2px 4px', borderRadius: 4 }}>
              x-api-key
            </code>{' '}
            header for all requests.
            {showSources && (
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px dashed var(--a-line)',
                  fontSize: 11,
                  color: 'var(--a-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>Sources:</span>
                <span
                  style={{
                    color: colors.accent,
                    textDecoration: 'underline',
                    cursor: 'default',
                  }}
                >
                  Quickstart Guide
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Input Footer */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid var(--a-line)',
          background: 'var(--a-surface)',
          display: 'flex',
          gap: 8,
        }}
      >
        <input
          type="text"
          readOnly
          placeholder="Ask a question..."
          style={{
            flex: 1,
            height: 36,
            fontSize: 13,
            border: '1px solid var(--a-line)',
            borderRadius: 8,
            padding: '0 12px',
            background: 'var(--a-bg)',
            color: 'var(--a-muted)',
          }}
        />
        <button
          type="button"
          disabled
          style={{
            background: colors.accent,
            color: '#ffffff',
            border: 'none',
            borderRadius: 8,
            padding: '0 14px',
            fontSize: 12.5,
            fontWeight: 500,
            cursor: 'default',
          }}
        >
          {buttonLabel || 'Ask AI'}
        </button>
      </div>
    </div>
  );
}
