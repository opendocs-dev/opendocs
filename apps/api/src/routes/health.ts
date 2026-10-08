import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { Elysia } from 'elysia';

export type DatabaseCheck = () => Promise<unknown>;

let prisma: PrismaClient | undefined;

export const checkDatabase: DatabaseCheck = async () => {
  if (!prisma) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');

    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        connectionTimeoutMillis: 1500,
        query_timeout: 1500,
      }),
    });
  }

  await prisma.$queryRaw`SELECT 1`;
};

/** `/api/health` is the documented path; `/api/healthz` stays for existing probes (Docker HEALTHCHECK). */
export const healthRoute = (checkDb: DatabaseCheck = checkDatabase) => {
  const databaseIsUp = async (): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        Promise.resolve().then(checkDb),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Database check timed out')), 2000);
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const answer = async ({ status }: { status: (code: 200 | 503, body: { status: string; db: string }) => unknown }) =>
    (await databaseIsUp()) ? status(200, { status: 'ok', db: 'up' }) : status(503, { status: 'error', db: 'down' });

  return new Elysia().get('/api/health', answer as never).get('/api/healthz', answer as never);
};
