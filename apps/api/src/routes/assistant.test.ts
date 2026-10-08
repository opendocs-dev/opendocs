import { describe, expect, test } from 'bun:test';
import {
  isValidContactTarget,
  validateSsrfUrl,
  sanitizeAssistant,
  validateSuggestedQuestions,
} from '../assistant/validation';

describe('validateSsrfUrl', () => {
  test('refuses non-https URLs', () => {
    const res = validateSsrfUrl('http://api.openai.com/v1');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Base URL must use HTTPS');
  });

  test('refuses localhost', () => {
    const res = validateSsrfUrl('https://localhost/v1');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Private addresses are refused');
  });

  test('refuses .local and .internal domains', () => {
    expect(validateSsrfUrl('https://my-service.local/v1').ok).toBe(false);
    expect(validateSsrfUrl('https://cluster.internal/v1').ok).toBe(false);
  });

  test('refuses loopback IP 127.0.0.1', () => {
    const res = validateSsrfUrl('https://127.0.0.1:8000/v1');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Private addresses are refused');
  });

  test('refuses private Class A 10.x.x.x', () => {
    expect(validateSsrfUrl('https://10.0.0.1/v1').ok).toBe(false);
  });

  test('refuses private Class B 172.16.x.x - 172.31.x.x', () => {
    expect(validateSsrfUrl('https://172.16.0.1/v1').ok).toBe(false);
    expect(validateSsrfUrl('https://172.24.1.10/v1').ok).toBe(false);
    expect(validateSsrfUrl('https://172.31.255.254/v1').ok).toBe(false);
  });

  test('refuses private Class C 192.168.x.x', () => {
    expect(validateSsrfUrl('https://192.168.1.1/v1').ok).toBe(false);
  });

  test('refuses cloud metadata IP 169.254.169.254', () => {
    expect(validateSsrfUrl('https://169.254.169.254/latest/meta-data').ok).toBe(false);
  });

  test('refuses 0.0.0.0', () => {
    expect(validateSsrfUrl('https://0.0.0.0/v1').ok).toBe(false);
  });

  test('refuses IPv6 loopback and link-local', () => {
    expect(validateSsrfUrl('https://[::1]/v1').ok).toBe(false);
    expect(validateSsrfUrl('https://[fe80::1]/v1').ok).toBe(false);
  });

  test('accepts public https endpoints', () => {
    expect(validateSsrfUrl('https://api.openai.com/v1').ok).toBe(true);
    expect(validateSsrfUrl('https://api.anthropic.com/v1').ok).toBe(true);
    expect(validateSsrfUrl('https://ai.mycompany.com/v1').ok).toBe(true);
  });
});

describe('sanitizeAssistant', () => {
  test('never returns plaintext byoSecret', () => {
    const row = {
      organizationId: 'org-123',
      enabled: true,
      name: 'Test Assistant',
      buttonLabel: 'Ask AI',
      welcome: 'Hello!',
      suggested: ['Q1', 'Q2'],
      tone: 'friendly',
      language: 'auto',
      sourceMode: 'all',
      sourceCategoryIds: [],
      excludedFlowIds: [],
      noMatchMode: 'contact',
      contactTarget: 'help@example.com',
      offTopicRefusal: true,
      showSources: true,
      hourlyPerVisitor: 20,
      dailyCap: 100,
      retentionDays: 30,
      maskPii: true,
      position: 'bottom-right',
      modelId: 'gpt-4o-mini',
      byoEnabled: true,
      byoProvider: 'openai',
      byoBaseUrl: 'https://api.openai.com/v1',
      byoModel: 'gpt-4o',
      byoSecret: 'some-encrypted-secret-string',
      byoFallbackCredits: true,
      embedOrigins: ['https://example.com'],
    };

    const sanitized = sanitizeAssistant(row);

    expect((sanitized as Record<string, unknown>).byoSecret).toBeUndefined();
    expect((sanitized as Record<string, unknown>).byo_secret).toBeUndefined();
    expect(sanitized.byo_secret_set).toBe(true);
    expect(sanitized.byo_secret_masked).toBeDefined();
    expect(sanitized.byo_secret_masked).not.toContain('some-encrypted-secret-string');
  });

  test('handles null byoSecret correctly', () => {
    const row = {
      organizationId: 'org-123',
      enabled: false,
      name: 'Default',
      buttonLabel: 'Ask',
      welcome: 'Hi',
      suggested: [],
      tone: 'friendly',
      language: 'auto',
      sourceMode: 'all',
      sourceCategoryIds: [],
      excludedFlowIds: [],
      noMatchMode: 'contact',
      contactTarget: '',
      offTopicRefusal: true,
      showSources: true,
      hourlyPerVisitor: 30,
      dailyCap: 500,
      retentionDays: 30,
      maskPii: true,
      position: 'bottom-right',
      modelId: null,
      byoEnabled: false,
      byoProvider: null,
      byoBaseUrl: null,
      byoModel: null,
      byoSecret: null,
      byoFallbackCredits: false,
      embedOrigins: [],
    };

    const sanitized = sanitizeAssistant(row);
    expect(sanitized.byo_secret_set).toBe(false);
    expect(sanitized.byo_secret_masked).toBeNull();
  });
});

describe('validateSuggestedQuestions', () => {
  test('accepts up to 4 questions', () => {
    const list = ['What is OpenDocs?', 'How do I start?', 'Where are guides?', 'Pricing'];
    const res = validateSuggestedQuestions(list);
    expect(res).toEqual(list);
  });

  test('refuses more than 4 questions', () => {
    const list = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'];
    expect(() => validateSuggestedQuestions(list)).toThrow('Suggested questions cannot exceed 4');
  });

  test('refuses non-array', () => {
    expect(() => validateSuggestedQuestions('not-an-array')).toThrow('Suggested questions must be an array');
  });
});

describe('isValidContactTarget', () => {
  test('refuses javascript: URLs', () => {
    expect(isValidContactTarget('javascript:alert(1)')).toBe(false);
    expect(isValidContactTarget('javascript:void(0)')).toBe(false);
  });

  test('refuses data: URLs', () => {
    expect(isValidContactTarget('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isValidContactTarget('data:text/plain;base64,SGVsbG8=')).toBe(false);
  });

  test('refuses non-http(s) schemes and arbitrary text', () => {
    expect(isValidContactTarget('ftp://example.com/file')).toBe(false);
    expect(isValidContactTarget('file:///etc/passwd')).toBe(false);
    expect(isValidContactTarget('plain-string-without-email-or-url')).toBe(false);
    expect(isValidContactTarget('')).toBe(false);
    expect(isValidContactTarget('   ')).toBe(false);
  });

  test('accepts valid email addresses', () => {
    expect(isValidContactTarget('support@example.com')).toBe(true);
    expect(isValidContactTarget('mailto:support@example.com')).toBe(true);
    expect(isValidContactTarget('user.name+tag@sub.domain.org')).toBe(true);
  });

  test('accepts valid https and http URLs', () => {
    expect(isValidContactTarget('https://example.com/contact')).toBe(true);
    expect(isValidContactTarget('http://help.example.com/ticket')).toBe(true);
  });
});
