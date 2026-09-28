import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import {
  AddStepBodySchema,
  AddStepParamsSchema,
  AddStepResponseSchema,
  AssetUploadHeadersSchema,
  AssetUploadResponseSchema,
  CompileRunParamsSchema,
  CompileRunResponseSchema,
  CreateRunBodySchema,
  CreateRunResponseSchema,
  ERROR_CODES,
  ErrorCodeSchema,
  ErrorResponseSchema,
  GetDocParamsSchema,
  GetDocResponseSchema,
  HealthzResponseSchema,
  ListFlowsQuerySchema,
  ListFlowsResponseSchema,
  MeResponseSchema,
  V1_ROUTE_SCHEMAS,
  V1_ROUTES,
} from './contract';

describe('API v1 contract', () => {
  test('exports a schema for every v1 route', () => {
    expect(V1_ROUTES).toHaveLength(8);

    const expectedRoutes = [
      'GET /api/healthz',
      'GET /api/v1/me',
      'POST /api/v1/assets',
      'POST /api/v1/runs',
      'POST /api/v1/runs/{id}/steps',
      'POST /api/v1/runs/{id}/compile',
      'GET /api/v1/flows',
      'GET /api/v1/docs/{publicId}',
    ];

    for (const route of expectedRoutes) {
      expect(V1_ROUTES).toContain(route as any);
      expect(V1_ROUTE_SCHEMAS).toHaveProperty(route);
      const entry = (V1_ROUTE_SCHEMAS as any)[route];
      expect(entry).toBeDefined();
      expect(entry.response).toBeDefined();
      expect(entry.method).toBeDefined();
      expect(entry.path).toBeDefined();
    }
  });

  test('schemas are TypeBox instances with request/response shapes', () => {
    for (const route of V1_ROUTES) {
      const entry = (V1_ROUTE_SCHEMAS as any)[route];
      // Every route must define a valid TypeBox response schema
      expect(Value.Check(entry.response, {})).toBeBoolean();

      if (entry.body) {
        expect(Value.Check(entry.body, {})).toBeBoolean();
      }
      if (entry.params) {
        expect(Value.Check(entry.params, {})).toBeBoolean();
      }
      if (entry.query) {
        expect(Value.Check(entry.query, {})).toBeBoolean();
      }
      if (entry.headers) {
        expect(Value.Check(entry.headers, {})).toBeBoolean();
      }
    }
  });

  test('shared error schema covers all 15 error codes from C1-AC06', () => {
    expect(ERROR_CODES).toHaveLength(15);

    // C1 Foundation
    expect(ERROR_CODES).toContain('unauthorized');
    expect(ERROR_CODES).toContain('upgrade_required');
    expect(ERROR_CODES).toContain('validation_failed');
    expect(ERROR_CODES).toContain('not_found');
    expect(ERROR_CODES).toContain('internal_error');

    // C2 Assets and Images
    expect(ERROR_CODES).toContain('payload_too_large');
    expect(ERROR_CODES).toContain('unsupported_media_type');
    expect(ERROR_CODES).toContain('image_too_many_pixels');
    expect(ERROR_CODES).toContain('quota_exceeded');
    expect(ERROR_CODES).toContain('breaker_open');
    expect(ERROR_CODES).toContain('gone');
    expect(ERROR_CODES).toContain('upload_failed');

    // C3 Runs, Steps and Docs
    expect(ERROR_CODES).toContain('step_limit');
    expect(ERROR_CODES).toContain('redaction_report_missing');
    expect(ERROR_CODES).toContain('run_compiled');

    // Error body shape
    const sampleError = {
      error: {
        code: 'unauthorized',
        message: 'Invalid API key',
      },
    };
    expect(Value.Check(ErrorResponseSchema, sampleError)).toBe(true);

    const invalidError = {
      error: {
        code: 'unknown_code_not_in_spec',
        message: 'something',
      },
    };
    expect(Value.Check(ErrorResponseSchema, invalidError)).toBe(false);
  });

  test('validates GET /api/healthz response', () => {
    expect(Value.Check(HealthzResponseSchema, { ok: true })).toBe(true);
    expect(
      Value.Check(HealthzResponseSchema, {
        ok: true,
        status: 'healthy',
        database: 'connected',
      })
    ).toBe(true);
    expect(Value.Check(HealthzResponseSchema, { ok: 'not-bool' })).toBe(false);
  });

  test('validates GET /api/v1/me response', () => {
    const validMe = {
      workspace: {
        id: 'ws_123',
        name: 'My Workspace',
      },
      plan: 'free',
      quota: {
        files_left: 200,
        bytes_left: 209715200,
      },
      min_cli_version: '0.1.0',
    };
    expect(Value.Check(MeResponseSchema, validMe)).toBe(true);

    const invalidPlan = { ...validMe, plan: 'enterprise' };
    expect(Value.Check(MeResponseSchema, invalidPlan)).toBe(false);
  });

  test('validates POST /api/v1/assets headers and response', () => {
    const validHeaders = {
      'content-type': 'image/webp',
      'x-opendocs-kind': 'step',
    };
    expect(Value.Check(AssetUploadHeadersSchema, validHeaders)).toBe(true);

    const validSnapHeaders = {
      'content-type': 'image/webp',
      'x-opendocs-kind': 'snap',
      'x-opendocs-ttl': '1h',
    };
    expect(Value.Check(AssetUploadHeadersSchema, validSnapHeaders)).toBe(true);

    const validResponse = {
      id: 'abc123xyz4567890',
      url: 'https://i.opendocs.juniyadi.id/i/abc123xyz4567890',
      expires_at: null,
    };
    expect(Value.Check(AssetUploadResponseSchema, validResponse)).toBe(true);
  });

  test('validates POST /api/v1/runs request and response', () => {
    expect(Value.Check(CreateRunBodySchema, {})).toBe(true);
    expect(Value.Check(CreateRunBodySchema, { title: 'New Run' })).toBe(true);
    expect(
      Value.Check(CreateRunBodySchema, {
        flow_id: 'flow_123',
        title: 'Run 2',
      })
    ).toBe(true);

    expect(
      Value.Check(CreateRunResponseSchema, { session_id: 'run_abc123' })
    ).toBe(true);
  });

  test('validates POST /api/v1/runs/{id}/steps request and response', () => {
    expect(Value.Check(AddStepParamsSchema, { id: 'run_123' })).toBe(true);

    const validStep = {
      asset_id: 'asset_123',
      action: 'click',
      selector: '#submit-btn',
      box: { x: 100, y: 200, w: 50, h: 20 },
      instruction: 'Click Submit',
      page_url: 'https://app.example.com/checkout',
      redaction: {
        mode: 'strict',
        report: {
          count: 1,
          script_version: '1.0.0',
        },
      },
    };
    expect(Value.Check(AddStepBodySchema, validStep)).toBe(true);

    expect(Value.Check(AddStepResponseSchema, { order: 1 })).toBe(true);
  });

  test('validates POST /api/v1/runs/{id}/compile request and response', () => {
    expect(Value.Check(CompileRunParamsSchema, { id: 'run_123' })).toBe(true);
    expect(
      Value.Check(CompileRunResponseSchema, { url: '/d/publicId12345678' })
    ).toBe(true);
  });

  test('validates GET /api/v1/flows query and response', () => {
    expect(Value.Check(ListFlowsQuerySchema, {})).toBe(true);
    expect(Value.Check(ListFlowsQuerySchema, { limit: 20, cursor: 'abc' })).toBe(
      true
    );

    const validResponse = {
      items: [
        {
          public_id: 'flow123456789012',
          title: 'Checkout Flow',
          last_run_at: '2026-09-28T12:00:00Z',
          url: '/d/flow123456789012',
          not_redacted: false,
        },
      ],
      next_cursor: null,
    };
    expect(Value.Check(ListFlowsResponseSchema, validResponse)).toBe(true);
  });

  test('validates GET /api/v1/docs/{publicId} params and response', () => {
    expect(Value.Check(GetDocParamsSchema, { publicId: 'abc123' })).toBe(true);

    const validDoc = {
      public_id: 'doc123456789012',
      title: 'Documentation',
      plan: 'free',
      is_free_plan: true,
      steps: [
        {
          order: 1,
          action: 'click',
          instruction: 'Click Start',
          image: {
            url: 'https://i.opendocs.juniyadi.id/i/asset123',
            expired: false,
          },
        },
      ],
    };
    expect(Value.Check(GetDocResponseSchema, validDoc)).toBe(true);
  });
});
