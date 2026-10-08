'use client';

import { useState } from 'react';

type Props = {
  guideUrl: string;
  initialOpen?: boolean;
  initialSuccess?: boolean;
  initialError?: string | null;
};

export const validateReportInput = (
  text: string,
  email?: string,
): { valid: boolean; error?: string } => {
  const trimmedText = text.trim();
  if (trimmedText.length < 10) {
    return { valid: false, error: 'Please describe what is wrong in at least 10 characters.' };
  }
  if (trimmedText.length > 1000) {
    return { valid: false, error: 'Report description must be at most 1000 characters.' };
  }
  const trimmedEmail = email?.trim();
  if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }
  return { valid: true };
};

export type SubmitReportParams = {
  guideUrl: string;
  text: string;
  reason: string;
  reporterEmail?: string;
  website?: string;
};

export async function submitPublicReport(
  params: SubmitReportParams,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch('/api/v1/public/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guide_url: params.guideUrl,
        text: params.text.trim(),
        reason: params.reason,
        reporter_email: params.reporterEmail?.trim() || undefined,
        website: params.website?.trim() || undefined,
      }),
    });

    if (!res.ok) {
      if (res.status === 429) {
        return {
          ok: false,
          status: 429,
          error: 'Too many reports submitted. Please try again later.',
        };
      }
      let errMessage = 'Failed to submit report. Please try again later.';
      try {
        const data = await res.json();
        if (data.error?.message) {
          errMessage = data.error.message;
        }
      } catch {
        // ignore
      }
      return { ok: false, status: res.status, error: errMessage };
    }

    return { ok: true, status: res.status };
  } catch {
    return { ok: false, error: 'Network error. Please check your connection and try again.' };
  }
}

export function ReportGuide({
  guideUrl,
  initialOpen = false,
  initialSuccess = false,
  initialError = null,
}: Props) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [reason, setReason] = useState('phishing');
  const [text, setText] = useState('');
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [isSuccess, setIsSuccess] = useState(initialSuccess);

  const handleClose = () => {
    setIsOpen(false);
    setIsSuccess(false);
    setError(null);
    setText('');
    setEmail('');
    setHoneypot('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validation = validateReportInput(text, email);
    if (!validation.valid) {
      setError(validation.error ?? 'Invalid form submission.');
      return;
    }

    setIsSubmitting(true);

    const result = await submitPublicReport({
      guideUrl,
      text,
      reason,
      reporterEmail: email,
      website: honeypot,
    });

    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? 'Failed to submit report. Please try again later.');
      return;
    }

    setIsSuccess(true);
    setText('');
    setEmail('');
    setHoneypot('');
  };

  return (
    <div className="tenant-report-guide">
      {!isOpen ? (
        <button
          type="button"
          className="tenant-report-guide-link"
          onClick={() => {
            setIsOpen(true);
            setError(null);
            setIsSuccess(false);
          }}
          aria-expanded={false}
        >
          Report this guide
        </button>
      ) : isSuccess ? (
        <div className="tenant-report-guide-card" role="status" aria-live="polite">
          <div className="tenant-report-guide-success">
            <h4>Thank you for your report</h4>
            <p>Our moderation team has received your report and will review this guide.</p>
            <button
              type="button"
              className="btn tenant-report-btn"
              onClick={handleClose}
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <div
          className="tenant-report-guide-card"
          role="region"
          aria-label="Report this guide form"
        >
          <div className="tenant-report-guide-header">
            <h4>Report this guide</h4>
            <p className="tenant-report-guide-sub">
              Report abuse, phishing, copyright infringement, or exposed personal data.
            </p>
          </div>

          {error && (
            <div className="tenant-report-guide-error" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {/* Honeypot field for bot suppression */}
            <div style={{ display: 'none' }} aria-hidden="true">
              <label htmlFor="website-hp">Leave this empty</label>
              <input
                id="website-hp"
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            <div className="tenant-report-fld">
              <label htmlFor="report-reason" className="tenant-report-lab">
                Reason
              </label>
              <select
                id="report-reason"
                className="tenant-report-select"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                <option value="phishing">Phishing or scam</option>
                <option value="personal_data">Personal data exposure</option>
                <option value="copyright">Copyright infringement</option>
                <option value="spam">Spam</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="tenant-report-fld">
              <label htmlFor="report-text" className="tenant-report-lab">
                What is wrong? <span className="req">*</span>
              </label>
              <textarea
                id="report-text"
                className="tenant-report-textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Describe what is wrong with this guide (10–1000 characters)..."
                rows={4}
                required
                minLength={10}
                maxLength={1000}
              />
              <div className="tenant-report-meta">
                <span className="tenant-report-char-count">
                  {text.length}/1000 characters (minimum 10)
                </span>
              </div>
            </div>

            <div className="tenant-report-fld">
              <label htmlFor="report-email" className="tenant-report-lab">
                Your email (optional)
              </label>
              <input
                id="report-email"
                type="email"
                className="tenant-report-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <span className="tenant-report-hint">
                Optional. Used only if our team needs to follow up with you. Never published.
              </span>
            </div>

            <div className="tenant-report-actions">
              <button
                type="submit"
                className="btn btn-primary tenant-report-submit-btn"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : 'Submit report'}
              </button>
              <button
                type="button"
                className="btn tenant-report-cancel-btn"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
