import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportGuide, submitPublicReport, validateReportInput } from './report-guide';

const realFetch = globalThis.fetch;

describe('validateReportInput', () => {
  test('rejects report text shorter than 10 characters', () => {
    const res = validateReportInput('too short');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('at least 10 characters');
  });

  test('rejects report text exceeding 1000 characters', () => {
    const res = validateReportInput('x'.repeat(1001));
    expect(res.valid).toBe(false);
    expect(res.error).toContain('1000 characters');
  });

  test('accepts valid text between 10 and 1000 characters', () => {
    const resMin = validateReportInput('1234567890');
    expect(resMin.valid).toBe(true);

    const resMax = validateReportInput('y'.repeat(1000));
    expect(resMax.valid).toBe(true);
  });

  test('validates optional email format when provided', () => {
    const invalidEmail = validateReportInput('A valid report explanation.', 'not-an-email');
    expect(invalidEmail.valid).toBe(false);
    expect(invalidEmail.error).toContain('valid email address');

    const validEmail = validateReportInput('A valid report explanation.', 'reporter@example.com');
    expect(validEmail.valid).toBe(true);

    const emptyEmail = validateReportInput('A valid report explanation.', '');
    expect(emptyEmail.valid).toBe(true);
  });
});

describe('submitPublicReport client call', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('submits valid report to /api/v1/public/reports with JSON body', async () => {
    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
      capturedUrl = String(url);
      capturedOptions = options;
      return new Response(JSON.stringify({ ok: true, id: 'rep-123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const res = await submitPublicReport({
      guideUrl: 'https://acme.opendocs.test/g/install',
      text: 'A guide asks readers to enter sensitive data.',
      reason: 'phishing',
      reporterEmail: 'reader@example.com',
      website: '',
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(capturedUrl).toBe('/api/v1/public/reports');
    expect(capturedOptions?.method).toBe('POST');
    const parsedBody = JSON.parse(String(capturedOptions?.body));
    expect(parsedBody.guide_url).toBe('https://acme.opendocs.test/g/install');
    expect(parsedBody.reason).toBe('phishing');
    expect(parsedBody.reporter_email).toBe('reader@example.com');
    expect(parsedBody.website).toBeUndefined();
  });

  test('handles 429 rate limit quota_exceeded response', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: { code: 'quota_exceeded', message: 'Too many reports submitted. Please try again later.' },
        }),
        {
          status: 429,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    const res = await submitPublicReport({
      guideUrl: 'https://acme.opendocs.test/g/install',
      text: 'Valid report explanation here.',
      reason: 'spam',
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
    expect(res.error).toBe('Too many reports submitted. Please try again later.');
  });

  test('handles 422 validation failure response', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: { code: 'validation_failed', message: 'text must be between 10 and 1000 characters' },
        }),
        {
          status: 422,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    const res = await submitPublicReport({
      guideUrl: 'https://acme.opendocs.test/g/install',
      text: 'short',
      reason: 'other',
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(422);
    expect(res.error).toBe('text must be between 10 and 1000 characters');
  });

  test('handles network failure gracefully', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Connection refused');
    }) as unknown as typeof fetch;

    const res = await submitPublicReport({
      guideUrl: 'https://acme.opendocs.test/g/install',
      text: 'Valid report explanation here.',
      reason: 'other',
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('Network error');
  });
});

describe('ReportGuide Component (Issue #94, Task 5)', () => {
  const guideUrl = 'https://acme.opendocs.test/g/install-the-app';

  test('renders small link in footer when closed', () => {
    const html = renderToStaticMarkup(<ReportGuide guideUrl={guideUrl} />);

    expect(html).toContain('Report this guide');
    expect(html).toContain('tenant-report-guide-link');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('form');
  });

  test('renders short form when opened with required text and optional email', () => {
    const html = renderToStaticMarkup(
      <ReportGuide guideUrl={guideUrl} initialOpen={true} />,
    );

    // Form card & title
    expect(html).toContain('tenant-report-guide-card');
    expect(html).toContain('Report this guide');
    expect(html).toContain('Reason');

    // Reasons
    expect(html).toContain('Phishing or scam');
    expect(html).toContain('Personal data exposure');
    expect(html).toContain('Copyright infringement');
    expect(html).toContain('Spam');

    // What is wrong field (10-1000 chars)
    expect(html).toContain('What is wrong?');
    expect(html).toContain('minLength="10"');
    expect(html).toContain('maxLength="1000"');
    expect(html).toContain('0/1000 characters (minimum 10)');

    // Optional email
    expect(html).toContain('Your email (optional)');
    expect(html).toContain('type="email"');
    expect(html).toContain('Never published');

    // Honeypot field (hidden from view)
    expect(html).toContain('style="display:none"');
    expect(html).toContain('name="website"');
    expect(html).toContain('tabindex="-1"');

    // Actions
    expect(html).toContain('Submit report');
    expect(html).toContain('Cancel');
  });

  test('renders thank-you state on successful submission and hides raw email', () => {
    const html = renderToStaticMarkup(
      <ReportGuide guideUrl={guideUrl} initialOpen={true} initialSuccess={true} />,
    );

    expect(html).toContain('Thank you for your report');
    expect(html).toContain('Our moderation team has received your report');
    expect(html).toContain('Close');
    expect(html).not.toContain('reporter@example.com');
    expect(html).not.toContain('form');
  });

  test('renders error state when submission fails', () => {
    const errorMsg = 'Too many reports submitted. Please try again later.';
    const html = renderToStaticMarkup(
      <ReportGuide
        guideUrl={guideUrl}
        initialOpen={true}
        initialError={errorMsg}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain(errorMsg);
    expect(html).toContain('Submit report');
  });
});
