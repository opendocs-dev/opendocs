'use client';

import { useState, useRef, useEffect } from 'react';
import { addressMessage, apiErrorMessage, formatAddressSuffix, type AddressStatus } from '@/lib/site-address';

interface SiteAddressFormProps {
  current: string;
  host: string | null;
}

export function SiteAddressForm({ current, host }: SiteAddressFormProps) {
  const [currentAddress, setCurrentAddress] = useState(current || '');
  const [currentHost, setCurrentHost] = useState(host);
  const [isEditing, setIsEditing] = useState(!current);
  const [slug, setSlug] = useState(current || '');
  const [checkStatus, setCheckStatus] = useState<AddressStatus | null>(null);
  const [checkReason, setCheckReason] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [newSlug, setNewSlug] = useState<string | null>(null);
  const checkTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setCurrentAddress(current || '');
    if (!current) {
      setIsEditing(true);
    }
  }, [current]);

  useEffect(() => {
    setCurrentHost(host);
  }, [host]);

  const activeHost = currentHost ?? host;
  const baseSuffix = formatAddressSuffix(activeHost);
  const displayDomain = baseSuffix;
  const msg = checkStatus ? addressMessage(checkStatus, checkReason, currentAddress) : null;
  const canChange = checkStatus === 'available' && slug !== currentAddress;

  // Debounced address check
  useEffect(() => {
    if (!slug || slug === currentAddress) {
      setCheckStatus(null);
      setCheckReason(null);
      return;
    }

    setIsChecking(true);

    if (checkTimeoutRef.current) {
      clearTimeout(checkTimeoutRef.current);
    }

    checkTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/v1/site/address-check?slug=${encodeURIComponent(slug)}`,
          { credentials: 'include' },
        );

        if (!response.ok) {
          setCheckStatus(null);
          setCheckReason(null);
          return;
        }

        const data = (await response.json()) as {
          status: AddressStatus;
          reason?: string;
        };
        setCheckStatus(data.status);
        setCheckReason(data.reason || null);
      } catch {
        setCheckStatus(null);
        setCheckReason(null);
      } finally {
        setIsChecking(false);
      }
    }, 300);

    return () => {
      if (checkTimeoutRef.current) {
        clearTimeout(checkTimeoutRef.current);
      }
    };
  }, [slug, currentAddress]);

  async function handleConfirm() {
    if (!canChange || !newSlug) return;

    setIsChanging(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/v1/site/address', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ slug: newSlug }),
      });

      if (!response.ok) {
        const body = await response.text();
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = null;
        }
        setError(
          apiErrorMessage(
            parsed,
            `Error changing address (${response.status})`,
          ),
        );
        setIsConfirming(false);
        return;
      }

      const result = (await response.json()) as { slug: string; host: string | null };
      setCurrentAddress(result.slug);
      setCurrentHost(result.host);
      setSuccess(
        `Address changed to ${result.slug}${
          result.host ? `.${result.host.split('.').slice(1).join('.')}` : baseSuffix
        }`,
      );
      setSlug(result.slug);
      setCheckStatus(null);
      setIsConfirming(false);
      setIsEditing(false);
    } catch (e) {
      setError('Failed to change address. Please try again.');
      setIsConfirming(false);
    } finally {
      setIsChanging(false);
    }
  }

  return (
    <div className="card">
      <h3>Your address</h3>
      <p className="sub" style={{ marginBottom: '12px' }}>
        Changing it keeps the old address redirecting for 90 days so links do not break.
      </p>

      {currentAddress && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <strong style={{ fontSize: '17px', fontWeight: 700 }}>
              {currentAddress}
              {baseSuffix}
            </strong>
            <span className="badge badge-ok">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M3 8.5l3.5 3.5 6.5-7" />
              </svg>
              Live
            </span>
          </div>
          {!isEditing && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setIsEditing(true);
                setSlug(currentAddress);
                setError(null);
                setSuccess(null);
              }}
            >
              Change address
            </button>
          )}
        </div>
      )}

      {success && !isEditing && (
        <div className="msg ok" style={{ marginTop: '12px' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 8l2 2 4-4" />
          </svg>
          {success}
        </div>
      )}

      {isEditing && !isConfirming && (
        <div style={{ marginTop: currentAddress ? '16px' : '0', paddingTop: currentAddress ? '16px' : '0', borderTop: currentAddress ? '1px solid var(--a-line)' : 'none' }}>
          <div className="fld" style={{ marginTop: 0 }}>
            <label htmlFor="addr-slug">New address</label>
            <div className="inl">
              <input
                id="addr-slug"
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={isChanging}
                autoComplete="off"
                spellCheck="false"
                aria-describedby="addr-msg"
                autoFocus
              />
              <span>{displayDomain}</span>
            </div>
            {isChecking && <div className="msg" id="addr-msg">Checking...</div>}
            {msg && !isChecking && (
              <div className={`msg ${msg.tone}`} id="addr-msg">
                {msg.tone === 'ok' && (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 8l2 2 4-4" />
                  </svg>
                )}
                {msg.tone === 'bad' && (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path stroke="currentColor" strokeWidth="2" d="M11 5L5 11M5 5l6 6" />
                  </svg>
                )}
                {msg.tone === 'warn' && (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path stroke="currentColor" strokeWidth="1.5" d="M8 5v4m0 3v.5" />
                  </svg>
                )}
                {msg.text}
              </div>
            )}
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

          <div className="adm-buttons" style={{ marginTop: '14px', display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canChange || isChanging}
              onClick={() => {
                setNewSlug(slug);
                setIsConfirming(true);
              }}
            >
              Change
            </button>
            {currentAddress && (
              <button
                type="button"
                className="btn"
                disabled={isChanging}
                onClick={() => {
                  setIsEditing(false);
                  setSlug(currentAddress);
                  setCheckStatus(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {isEditing && isConfirming && newSlug && (
        <div style={{ marginTop: '16px', padding: '14px', borderRadius: '10px', background: 'var(--a-soft)', border: '1px solid var(--a-brand)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 600 }}>Confirm address change</h4>
          <p className="sub" style={{ margin: '0 0 8px' }}>
            You&apos;re about to change your address from <strong>{currentAddress}</strong> to{' '}
            <strong>{newSlug}</strong>.
          </p>
          <p className="sub" style={{ margin: '0 0 8px' }}>
            Your old address will keep redirecting for 90 days so links don&apos;t break.
          </p>
          <p className="sub" style={{ margin: '0 0 14px' }}>
            You can change your address up to 3 times per day.
          </p>
          <div className="adm-buttons" style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn"
              onClick={() => setIsConfirming(false)}
              disabled={isChanging}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={isChanging}
            >
              {isChanging ? 'Changing...' : 'Confirm'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
