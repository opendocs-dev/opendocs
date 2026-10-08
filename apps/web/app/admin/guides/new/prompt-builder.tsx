'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buildGuidePrompt } from '@/lib/new-guide-prompt';
import { relativeTime } from '@/lib/relative-time';
import { startRecordingStatusPoller, type RecordingStatus } from './recording-poller';

type Props = {
  categoryNames: string[];
  hasKey?: boolean;
  initialStatus?: RecordingStatus | null;
  poller?: typeof startRecordingStatusPoller;
};

export function PromptBuilder({
  categoryNames,
  hasKey = false,
  initialStatus = null,
  poller,
}: Props) {
  const [task, setTask] = useState('');
  const [category, setCategory] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [publish, setPublish] = useState(true);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [status, setStatus] = useState<RecordingStatus | null>(initialStatus);

  useEffect(() => {
    const pollerFn = poller ?? startRecordingStatusPoller;
    const stop = pollerFn({
      onStatus: (newStatus) => {
        setStatus(newStatus);
      },
    });
    return stop;
  }, [poller]);

  const prompt = buildGuidePrompt({
    task,
    category,
    startUrl,
    publish,
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyStatus('Copied!');
      setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      // Fallback: select the text
      const preElement = document.getElementById('prompt-output');
      if (preElement) {
        const range = document.createRange();
        range.selectNodeContents(preElement);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
          setCopyStatus('Press Ctrl/Cmd+C to copy');
          setTimeout(() => setCopyStatus(null), 2000);
        }
      }
    }
  };

  const isConnected = status ? status.connected : hasKey;
  const keyName = status?.key_name;
  const keyLastUsed = status?.key_last_used;
  const isRecording = status ? (status.recording_started || status.compile_state === 'done') : false;
  const stepsCount = status?.steps_count ?? 0;
  const isCompiled = status ? status.compile_state === 'done' : false;
  const guideId = status?.guide_id;
  const showCallout = status ? (!status.has_key && !status.connected) : !hasKey;

  return (
    <div className="split">
      <div className="stack">
        <div className="card">
          <h3>What should it record?</h3>

          <div className="fld">
            <label htmlFor="task">Task</label>
            <textarea
              id="task"
              rows={2}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe the task your agent should record..."
            />
          </div>

          <div className="grid2">
            <div className="fld">
              <label htmlFor="category">Category</label>
              <input
                id="category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="category-list"
                placeholder="Select or type a category"
              />
              <datalist id="category-list">
                {categoryNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <small className="muted">Leave empty and your agent picks one</small>
            </div>

            <div className="fld">
              <label htmlFor="startUrl">Start page (optional)</label>
              <input
                id="startUrl"
                type="url"
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                placeholder="https://acme.id/console"
              />
            </div>
          </div>

          <div className="fld">
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                checked={publish}
                onChange={(e) => setPublish(e.target.checked)}
              />
              <span>Publish when recording ends</span>
            </label>
            <small className="muted">Off keeps it as a draft for you to review.</small>
          </div>
        </div>

        <div className="card">
          <h3>Your prompt</h3>
          <pre id="prompt-output">{prompt}</pre>
          <div className="btns" style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={handleCopy}
              className="btn btn-primary"
              style={{ justifySelf: 'start' }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy prompt
            </button>
            {copyStatus && <small className="msg ok">{copyStatus}</small>}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Waiting for your agent</h3>
        <ul className="check">
          <li className={isConnected ? 'done' : ''}>
            <span className="tick">
              {isConnected && (
                <svg
                  width="12"
                  height="10"
                  viewBox="0 0 12 10"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M10.6 0.6L4 7.2L1.4 4.6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                  />
                </svg>
              )}
            </span>
            <span>
              {isConnected && keyLastUsed ? (
                keyName ? (
                  `Agent connected (${keyName}, used ${relativeTime(keyLastUsed)})`
                ) : (
                  `Agent connected (used ${relativeTime(keyLastUsed)})`
                )
              ) : (
                'Agent connected'
              )}
            </span>
          </li>
          <li className={isRecording ? 'done' : ''}>
            <span className="tick">
              {isRecording && (
                <svg
                  width="12"
                  height="10"
                  viewBox="0 0 12 10"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M10.6 0.6L4 7.2L1.4 4.6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                  />
                </svg>
              )}
            </span>
            <span>
              {isRecording && stepsCount > 0
                ? `Recording started (${stepsCount} ${stepsCount === 1 ? 'step' : 'steps'})`
                : 'Recording started'}
            </span>
          </li>
          <li className={isCompiled ? 'done' : ''}>
            <span className="tick">
              {isCompiled && (
                <svg
                  width="12"
                  height="10"
                  viewBox="0 0 12 10"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M10.6 0.6L4 7.2L1.4 4.6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                  />
                </svg>
              )}
            </span>
            <span>
              {isCompiled && guideId ? (
                <Link href={`/admin/guides/${guideId}`}>
                  Guide compiled and filed
                </Link>
              ) : (
                'Guide compiled and filed'
              )}
            </span>
          </li>
        </ul>

        <p className="sub" style={{ marginTop: 16 }}>
          This page updates by itself. You can leave; the guide will appear in Guides.
        </p>

        {showCallout && (
          <div className="callout neutral" style={{ marginTop: 16 }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path
                d="M10 2L1 18h18L10 2z"
                strokeLinejoin="round"
              />
              <path
                d="M10 8v4m0 3v.5"
                strokeLinecap="round"
              />
            </svg>
            <span className="sp">
              No agent connected yet? Set one up in API and MCP.
            </span>
            <Link href="/admin/keys" className="btn">
              Open setup
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
