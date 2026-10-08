import { Elysia } from 'elysia';
import { resolveOrganizationId } from '../auth-context';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { capabilitiesFor, getPlan } from '../plan';
import type { Plan } from '../legacy-limits';
import {
  encryptDriveSecret,
  encryptS3Secret,
  testConnection,
  type DriveConfig,
  type S3Config,
} from '../storage/connections';
import type { StorageProvider } from '../storage/provider';
import { requireSession } from '../site/session';

const forbidden = () =>
  new ApiError(403, 'unauthorized', 'Only the owner or an admin can manage storage');
const invalid = (message: string) => new ApiError(422, 'validation_failed', message);
const notFound = () => new ApiError(404, 'not_found', 'No storage connection of that kind exists');
const testFailed = (message: string) => new ApiError(502, 'upload_failed', message);

const requireOwnerOrAdmin = async (userId: string, organizationId: string) => {
  const member = await getPrisma().member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) throw forbidden();
};

/** Which StorageConnection kinds a plan may use (C14 Decisions, AC-15/21). */
const allowedKinds = (plan: Plan): readonly string[] => capabilitiesFor(plan).storageKinds;

const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text().catch(() => {
    throw invalid('A JSON request body is required');
  });
  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw invalid('Request body must be valid JSON');
    }
  }
  return (parsed as Record<string, unknown>) ?? {};
};

const requireNonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid(`${field} is required`);
  }
  return value.trim();
};

type ConnectInput =
  | { kind: 'gdrive'; config: DriveConfig; secret: string }
  | { kind: 's3'; config: S3Config; secret: string };

/** Reads an optional string field, treating anything else (including empty string) as absent. */
const optionalString = (body: Record<string, unknown>, field: string): string | undefined => {
  const value = body[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/** Validates the connect body for one kind and returns the encrypted secret plus config to store. */
const parseConnectBody = (body: Record<string, unknown>): ConnectInput => {
  const kind = body.kind;
  if (kind === 'gdrive') {
    const folderId = requireNonEmptyString(body.folder_id, 'folder_id');
    const refreshToken = requireNonEmptyString(body.refresh_token, 'refresh_token');
    return { kind: 'gdrive', config: { folderId }, secret: encryptDriveSecret({ refreshToken }) };
  }
  if (kind === 's3') {
    const bucket = requireNonEmptyString(body.bucket, 'bucket');
    const accessKeyId = requireNonEmptyString(body.access_key_id, 'access_key_id');
    const secretAccessKey = requireNonEmptyString(body.secret_access_key, 'secret_access_key');
    const pathStyleRaw = body.path_style;
    const config: S3Config = {
      bucket,
      endpoint: optionalString(body, 'endpoint'),
      region: optionalString(body, 'region'),
      prefix: optionalString(body, 'prefix'),
      pathStyle: typeof pathStyleRaw === 'boolean' ? pathStyleRaw : undefined,
    };
    return { kind: 's3', config, secret: encryptS3Secret({ accessKeyId, secretAccessKey }) };
  }
  throw invalid('kind must be "gdrive" or "s3"');
};

const toConnectionResponse = (connection: {
  kind: string;
  config: unknown;
  status: string;
  lastTestedAt: Date | null;
}) => ({
  kind: connection.kind,
  config: connection.config,
  status: connection.status as 'connected' | 'failed' | 'untested',
  last_tested_at: connection.lastTestedAt?.toISOString() ?? null,
});

/** `buildProvider` lets tests substitute a fake StorageProvider for the test route, the same way `assetsRoute(storage?)` does for uploads. */
export const storageRoute = (buildProvider?: (connection: Parameters<typeof testConnection>[0]) => StorageProvider) =>
  new Elysia()
    /** Current destination (OpenDocs storage, or the active StorageConnection) and what the plan allows. */
    .get('/api/v1/storage', async ({ request }) => {
      const organizationId = await resolveOrganizationId(request);
      const prisma = getPrisma();
      const [plan, site, connections] = await Promise.all([
        getPlan(organizationId),
        prisma.workspaceSite.findUnique({ where: { organizationId }, select: { storageKind: true } }),
        prisma.storageConnection.findMany({ where: { organizationId } }),
      ]);
      return {
        plan,
        allowed_kinds: allowedKinds(plan),
        active_kind: site?.storageKind ?? null,
        connections: connections.map(toConnectionResponse),
      };
    })
    /**
     * Saves (or replaces) one kind's connection. Does not activate it — a workspace may
     * hold a connection without routing uploads to it yet, matching `/activate` below.
     */
    .post('/api/v1/storage/connections', async ({ request }) => {
      const { userId, organizationId } = await requireSession(request);
      await requireOwnerOrAdmin(userId, organizationId);
      const plan = await getPlan(organizationId);
      const body = await readJsonBody(request);
      const input = parseConnectBody(body);
      if (!allowedKinds(plan).includes(input.kind)) {
        throw invalid(`Your plan does not allow a "${input.kind}" storage connection`);
      }
      const prisma = getPrisma();
      const connection = await prisma.storageConnection.upsert({
        where: { organizationId_kind: { organizationId, kind: input.kind } },
        create: {
          organizationId,
          kind: input.kind,
          config: input.config,
          secret: input.secret,
          status: 'untested',
        },
        update: { config: input.config, secret: input.secret, status: 'untested', lastTestedAt: null },
      });
      return toConnectionResponse(connection);
    })
    /** Round-trips a probe object through the connection; never falls back silently on failure. */
    .post('/api/v1/storage/connections/:kind/test', async ({ params, request }) => {
      const { userId, organizationId } = await requireSession(request);
      await requireOwnerOrAdmin(userId, organizationId);
      const prisma = getPrisma();
      const connection = await prisma.storageConnection.findUnique({
        where: { organizationId_kind: { organizationId, kind: params.kind } },
      });
      if (!connection) throw notFound();
      const now = new Date();
      try {
        await testConnection(connection, buildProvider);
      } catch (error) {
        await prisma.storageConnection.update({
          where: { id: connection.id },
          data: { status: 'failed', lastTestedAt: now },
        });
        const message = error instanceof Error ? error.message : 'Storage test failed';
        throw testFailed(message);
      }
      const updated = await prisma.storageConnection.update({
        where: { id: connection.id },
        data: { status: 'connected', lastTestedAt: now },
      });
      return toConnectionResponse(updated);
    })
    /** Makes this kind's connection the one new uploads use. The connection must exist and have passed a test. */
    .post('/api/v1/storage/connections/:kind/activate', async ({ params, request }) => {
      const { userId, organizationId } = await requireSession(request);
      await requireOwnerOrAdmin(userId, organizationId);
      const prisma = getPrisma();
      if (params.kind === 'opendocs') {
        const organization = await prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { name: true },
        });
        await prisma.workspaceSite.upsert({
          where: { organizationId },
          create: { organizationId, siteTitle: organization.name, storageKind: null },
          update: { storageKind: null },
          select: { storageKind: true },
        });
        return { active_kind: null };
      }
      const plan = await getPlan(organizationId);
      if (!allowedKinds(plan).includes(params.kind)) {
        throw invalid(`Your plan does not allow a "${params.kind}" storage connection`);
      }
      const connection = await prisma.storageConnection.findUnique({
        where: { organizationId_kind: { organizationId, kind: params.kind } },
      });
      if (!connection) throw notFound();
      if (connection.status !== 'connected') {
        throw invalid('Test this connection successfully before making it active');
      }
      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true },
      });
      await prisma.workspaceSite.upsert({
        where: { organizationId },
        create: { organizationId, siteTitle: organization.name, storageKind: params.kind },
        update: { storageKind: params.kind },
        select: { storageKind: true },
      });
      return { active_kind: params.kind };
    })
    /**
     * Removes one kind's connection. If it was active, uploads fall back to OpenDocs
     * storage going forward (existing assets already on that provider are unaffected
     * and keep reading from it via the per-asset resolver).
     */
    .delete('/api/v1/storage/connections/:kind', async ({ params, request }) => {
      const { userId, organizationId } = await requireSession(request);
      await requireOwnerOrAdmin(userId, organizationId);
      const prisma = getPrisma();
      const connection = await prisma.storageConnection.findUnique({
        where: { organizationId_kind: { organizationId, kind: params.kind } },
      });
      if (!connection) throw notFound();
      await prisma.$transaction([
        prisma.storageConnection.delete({ where: { id: connection.id } }),
        prisma.workspaceSite.updateMany({
          where: { organizationId, storageKind: params.kind },
          data: { storageKind: null },
        }),
      ]);
      return { ok: true };
    });
