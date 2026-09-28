import { type Static, Type } from '@sinclair/typebox';

/**
 * OpenDocs API v1 Route Registry.
 */
export const V1_ROUTES = [
  'GET /api/healthz',
  'GET /api/v1/me',
  'POST /api/v1/assets',
  'POST /api/v1/runs',
  'POST /api/v1/runs/{id}/steps',
  'POST /api/v1/runs/{id}/compile',
  'GET /api/v1/flows',
  'GET /api/v1/docs/{publicId}',
] as const;

export type V1Route = (typeof V1_ROUTES)[number];

// ==========================================
// Shared Error Contract (C1-AC06)
// ==========================================

export const ERROR_CODES = [
  // C1 Foundation
  'unauthorized',
  'upgrade_required',
  'validation_failed',
  'not_found',
  'internal_error',
  // C2 Assets and Images
  'payload_too_large',
  'unsupported_media_type',
  'image_too_many_pixels',
  'quota_exceeded',
  'breaker_open',
  'gone',
  'upload_failed',
  // C3 Runs, Steps and Docs
  'step_limit',
  'redaction_report_missing',
  'run_compiled',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCodeSchema = Type.Union(
  ERROR_CODES.map((code) => Type.Literal(code))
);

export const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: ErrorCodeSchema,
    message: Type.String(),
  }),
});

export type ErrorResponse = Static<typeof ErrorResponseSchema>;

// ==========================================
// 1. GET /api/healthz
// ==========================================

export const HealthzResponseSchema = Type.Object({
  ok: Type.Boolean(),
  status: Type.Optional(Type.String()),
  database: Type.Optional(Type.String()),
});

export type HealthzResponse = Static<typeof HealthzResponseSchema>;

// ==========================================
// 2. GET /api/v1/me
// ==========================================

export const MeWorkspaceSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

export const MePlanSchema = Type.Union([
  Type.Literal('free'),
  Type.Literal('pro'),
  Type.Literal('team'),
]);

export const MeQuotaSchema = Type.Object({
  files_left: Type.Number(),
  bytes_left: Type.Number(),
});

export const MeResponseSchema = Type.Object({
  workspace: MeWorkspaceSchema,
  plan: MePlanSchema,
  quota: MeQuotaSchema,
  min_cli_version: Type.String(),
});

export type MeResponse = Static<typeof MeResponseSchema>;

// ==========================================
// 3. POST /api/v1/assets
// ==========================================

export const AssetUploadHeadersSchema = Type.Object({
  'content-type': Type.String(),
  'content-length': Type.Optional(Type.String()),
  'x-opendocs-kind': Type.Union([Type.Literal('step'), Type.Literal('snap')]),
  'x-opendocs-ttl': Type.Optional(
    Type.Union([
      Type.Literal('15m'),
      Type.Literal('1h'),
      Type.Literal('24h'),
    ])
  ),
});

export type AssetUploadHeaders = Static<typeof AssetUploadHeadersSchema>;

export const AssetUploadResponseSchema = Type.Object({
  id: Type.String(),
  url: Type.String(),
  expires_at: Type.Union([Type.String(), Type.Null()]),
});

export type AssetUploadResponse = Static<typeof AssetUploadResponseSchema>;

// ==========================================
// 4. POST /api/v1/runs
// ==========================================

export const CreateRunBodySchema = Type.Object({
  flow_id: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
});

export type CreateRunBody = Static<typeof CreateRunBodySchema>;

export const CreateRunResponseSchema = Type.Object({
  session_id: Type.String(),
});

export type CreateRunResponse = Static<typeof CreateRunResponseSchema>;

// ==========================================
// 5. POST /api/v1/runs/{id}/steps
// ==========================================

export const BoxSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  w: Type.Number(),
  h: Type.Number(),
});

export type Box = Static<typeof BoxSchema>;

export const RedactionReportSchema = Type.Object({
  count: Type.Number(),
  script_version: Type.String(),
  boxes: Type.Optional(Type.Array(BoxSchema)),
});

export type RedactionReport = Static<typeof RedactionReportSchema>;

export const RedactionConfigSchema = Type.Object({
  mode: Type.Union([
    Type.Literal('strict'),
    Type.Literal('basic'),
    Type.Literal('off'),
  ]),
  report: Type.Optional(RedactionReportSchema),
});

export type RedactionConfig = Static<typeof RedactionConfigSchema>;

export const AddStepParamsSchema = Type.Object({
  id: Type.String(),
});

export type AddStepParams = Static<typeof AddStepParamsSchema>;

export const AddStepBodySchema = Type.Object({
  asset_id: Type.String(),
  action: Type.Union([
    Type.Literal('click'),
    Type.Literal('type'),
    Type.Literal('navigate'),
    Type.Literal('other'),
  ]),
  selector: Type.Optional(Type.String()),
  box: Type.Optional(BoxSchema),
  instruction: Type.String(),
  page_url: Type.Optional(Type.String()),
  redaction: Type.Optional(RedactionConfigSchema),
});

export type AddStepBody = Static<typeof AddStepBodySchema>;

export const AddStepResponseSchema = Type.Object({
  order: Type.Number(),
});

export type AddStepResponse = Static<typeof AddStepResponseSchema>;

// ==========================================
// 6. POST /api/v1/runs/{id}/compile
// ==========================================

export const CompileRunParamsSchema = Type.Object({
  id: Type.String(),
});

export type CompileRunParams = Static<typeof CompileRunParamsSchema>;

export const CompileRunBodySchema = Type.Optional(
  Type.Object({
    title: Type.Optional(Type.String()),
  })
);

export type CompileRunBody = Static<typeof CompileRunBodySchema>;

export const CompileRunResponseSchema = Type.Object({
  url: Type.String(),
});

export type CompileRunResponse = Static<typeof CompileRunResponseSchema>;

// ==========================================
// 7. GET /api/v1/flows
// ==========================================

export const ListFlowsQuerySchema = Type.Object({
  limit: Type.Optional(Type.Number()),
  cursor: Type.Optional(Type.String()),
});

export type ListFlowsQuery = Static<typeof ListFlowsQuerySchema>;

export const FlowItemSchema = Type.Object({
  public_id: Type.String(),
  title: Type.String(),
  last_run_at: Type.String(),
  url: Type.Union([Type.String(), Type.Null()]),
  not_redacted: Type.Boolean(),
});

export type FlowItem = Static<typeof FlowItemSchema>;

export const ListFlowsResponseSchema = Type.Object({
  items: Type.Array(FlowItemSchema),
  next_cursor: Type.Union([Type.String(), Type.Null()]),
});

export type ListFlowsResponse = Static<typeof ListFlowsResponseSchema>;

// ==========================================
// 8. GET /api/v1/docs/{publicId}
// ==========================================

export const GetDocParamsSchema = Type.Object({
  publicId: Type.String(),
});

export type GetDocParams = Static<typeof GetDocParamsSchema>;

export const DocStepImageSchema = Type.Object({
  url: Type.String(),
  expired: Type.Boolean(),
});

export type DocStepImage = Static<typeof DocStepImageSchema>;

export const DocStepSchema = Type.Object({
  order: Type.Number(),
  action: Type.String(),
  instruction: Type.String(),
  page_url: Type.Optional(Type.String()),
  selector: Type.Optional(Type.String()),
  box: Type.Optional(BoxSchema),
  image: DocStepImageSchema,
  redaction_mode: Type.Optional(Type.String()),
});

export type DocStep = Static<typeof DocStepSchema>;

export const GetDocResponseSchema = Type.Object({
  public_id: Type.String(),
  title: Type.String(),
  plan: Type.Optional(Type.String()),
  is_free_plan: Type.Optional(Type.Boolean()),
  steps: Type.Array(DocStepSchema),
});

export type GetDocResponse = Static<typeof GetDocResponseSchema>;

// ==========================================
// Route Schemas Map
// ==========================================

export const V1_ROUTE_SCHEMAS = {
  'GET /api/healthz': {
    method: 'GET',
    path: '/api/healthz',
    response: HealthzResponseSchema,
  },
  'GET /api/v1/me': {
    method: 'GET',
    path: '/api/v1/me',
    response: MeResponseSchema,
  },
  'POST /api/v1/assets': {
    method: 'POST',
    path: '/api/v1/assets',
    headers: AssetUploadHeadersSchema,
    response: AssetUploadResponseSchema,
  },
  'POST /api/v1/runs': {
    method: 'POST',
    path: '/api/v1/runs',
    body: CreateRunBodySchema,
    response: CreateRunResponseSchema,
  },
  'POST /api/v1/runs/{id}/steps': {
    method: 'POST',
    path: '/api/v1/runs/{id}/steps',
    params: AddStepParamsSchema,
    body: AddStepBodySchema,
    response: AddStepResponseSchema,
  },
  'POST /api/v1/runs/{id}/compile': {
    method: 'POST',
    path: '/api/v1/runs/{id}/compile',
    params: CompileRunParamsSchema,
    body: CompileRunBodySchema,
    response: CompileRunResponseSchema,
  },
  'GET /api/v1/flows': {
    method: 'GET',
    path: '/api/v1/flows',
    query: ListFlowsQuerySchema,
    response: ListFlowsResponseSchema,
  },
  'GET /api/v1/docs/{publicId}': {
    method: 'GET',
    path: '/api/v1/docs/{publicId}',
    params: GetDocParamsSchema,
    response: GetDocResponseSchema,
  },
} as const;
