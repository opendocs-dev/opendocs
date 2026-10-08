'use client';

import { useState } from 'react';
import { apiErrorMessage } from '@/lib/site-address';

type DomainStatus = 'verified' | 'waiting_dns' | 'cert_failing' | 'blocked' | null;

interface DomainInfo {
  custom_domain: string | null;
  status: DomainStatus;
  cname_target: string;
  cert_expires_at: string | null;
  last_checked_at: string | null;
}

interface CustomDomainFormProps {
  initial: DomainInfo;
  isEnterprise?: boolean;
}

const putCustomDomain = (domain: string | null) =>
  fetch('/api/v1/site/custom-domain', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ domain }),
  });

const recheckCustomDomain = () =>
  fetch('/api/v1/site/custom-domain/recheck', {
    method: 'POST',
    credentials: 'include',
  });

/** Reads an error body the same way site-address-form does, falling back to a plain status message. */
async function parsedError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return apiErrorMessage(parsed, fallback);
}

export function CustomDomainForm({ initial, isEnterprise = true }: CustomDomainFormProps) {
  const [domain, setDomain] = useState(initial.custom_domain ?? '');
  const [info, setInfo] = useState<DomainInfo>(initial);
  const [isSaving, setIsSaving] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const response = await putCustomDomain(domain.trim() === '' ? null : domain.trim());
      if (!response.ok) {
        setError(await parsedError(response, `Error saving domain (${response.status})`));
        return;
      }
      const result = (await response.json()) as DomainInfo;
      setInfo(result);
      setDomain(result.custom_domain ?? '');
    } catch {
      setError('Failed to save the domain. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClear() {
    setIsSaving(true);
    setError(null);
    try {
      const response = await putCustomDomain(null);
      if (!response.ok) {
        setError(await parsedError(response, `Error clearing domain (${response.status})`));
        return;
      }
      const result = (await response.json()) as DomainInfo;
      setInfo(result);
      setDomain('');
    } catch {
      setError('Failed to clear the domain. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRecheck() {
    setIsChecking(true);
    setError(null);
    try {
      const response = await recheckCustomDomain();
      if (!response.ok) {
        setError(await parsedError(response, `Error checking domain (${response.status})`));
        return;
      }
      const result = (await response.json()) as DomainInfo;
      setInfo(result);
    } catch {
      setError('Failed to check the domain. Please try again.');
    } finally {
      setIsChecking(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(info.cname_target);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Denied clipboard permission or insecure context
    }
  }

  const dnsFound = info.status === 'verified' || info.status === 'cert_failing' || info.status === 'blocked';
  const hasDomain = Boolean(info.custom_domain);
  const canSave = domain.trim() !== '' && domain.trim() !== (initial.custom_domain ?? '');
  const dnsName = info.custom_domain
    ? (info.custom_domain.includes('.') ? info.custom_domain.split('.')[0] : info.custom_domain)
    : 'docs';

  return (
    <div className={`card card-lock ${isEnterprise ? '' : 'is-locked'}`} data-need="enterprise">
      {!isEnterprise && (
        <div className="card-veil">
          <div className="card-veil-box">
            <span className="badge badge-ai" style={{ marginBottom: '8px' }}>Enterprise</span>
            <p><b>Your own domain is on Enterprise</b></p>
            <p className="sub" style={{ margin: '6px 0 0' }}>Serve guides from docs.yourcompany.com.</p>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div>
          <h3>Your own domain</h3>
          <p className="sub">Serve guides from docs.example.com instead of the address above.</p>
        </div>
        <span className="badge badge-ai">Enterprise</span>
      </div>

      <div className="fld">
        <label htmlFor="custom-domain-input">Domain</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            id="custom-domain-input"
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="docs.example.com"
            disabled={!isEnterprise || isSaving}
            autoComplete="off"
            spellCheck="false"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!isEnterprise || !canSave || isSaving}
            onClick={handleSave}
          >
            {isSaving ? 'Verifying...' : 'Verify'}
          </button>
        </div>
      </div>

      {error && (
        <div className="msg bad" style={{ marginTop: '12px' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path stroke="currentColor" strokeWidth="2" d="M11 5L5 11M5 5l6 6" />
          </svg>
          {error}
        </div>
      )}

      {hasDomain && (
        <>
          <div className="fld">
            <label>Add this record at your DNS provider</label>
            <div className="tw" style={{ marginTop: '6px' }}>
              <table className="adm">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Name</th>
                    <th>Value</th>
                    <th style={{ width: '80px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>CNAME</code></td>
                    <td><code>{dnsName}</code></td>
                    <td><code>{info.cname_target}</code></td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={handleCopy}
                        aria-label="Copy DNS record target"
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="fld">
            <label>Verification checklist</label>
            <ul className="check">
              <li className={dnsFound ? 'done' : ''}>
                <span className="tick">
                  {dnsFound && (
                    <svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor">
                      <path d="M10.6 0.6L4 7.2L1.4 4.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    </svg>
                  )}
                </span>
                <span>DNS record found</span>
              </li>
              <li className={info.cert_expires_at ? 'done' : ''}>
                <span className="tick">
                  {info.cert_expires_at && (
                    <svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor">
                      <path d="M10.6 0.6L4 7.2L1.4 4.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    </svg>
                  )}
                </span>
                <span>Issuing certificate</span>
                {!info.cert_expires_at && <span className="sub">—</span>}
              </li>
              <li className={info.status === 'verified' ? 'done' : ''}>
                <span className="tick">
                  {info.status === 'verified' && (
                    <svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor">
                      <path d="M10.6 0.6L4 7.2L1.4 4.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    </svg>
                  )}
                </span>
                <span>Site reachable</span>
              </li>
            </ul>
            {info.last_checked_at && (
              <p className="sub" style={{ marginTop: '10px' }}>
                Last checked {new Date(info.last_checked_at).toLocaleString()}
              </p>
            )}
          </div>

          <div className="adm-buttons" style={{ marginTop: '14px' }}>
            <button
              type="button"
              className="btn"
              disabled={!isEnterprise || isChecking}
              onClick={handleRecheck}
            >
              {isChecking ? 'Checking...' : 'Recheck DNS'}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!isEnterprise || isSaving}
              onClick={handleClear}
            >
              Clear domain
            </button>
          </div>
        </>
      )}
    </div>
  );
}
