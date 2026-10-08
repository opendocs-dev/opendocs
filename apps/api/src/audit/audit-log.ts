import { getPrisma } from '../db';
import type { Prisma } from '../../generated/prisma/client';

export type ActorKind = 'user' | 'apikey';

export type AuditLogEntry = {
  actorKind: ActorKind;
  actorId: string;
  organizationId?: string | null;
  action: string;
  detail?: Record<string, unknown>;
};

export const recordAuditLog = async (entry: AuditLogEntry) => {
  try {
    const prisma = getPrisma();
    return await prisma.auditLog.create({
      data: {
        actorKind: entry.actorKind,
        actorId: entry.actorId,
        organizationId: entry.organizationId ?? null,
        action: entry.action,
        detail: (entry.detail ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error('Failed to record audit log:', error);
    return null;
  }
};
