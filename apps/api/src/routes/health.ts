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

export const healthRoute = (checkDb: DatabaseCheck = checkDatabase) =>
  new Elysia().get('/api/healthz', async ({ status }) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        Promise.resolve().then(checkDb),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Database check timed out')), 2000);
        }),
      ]);
      return status(200, { status: 'ok', db: 'up' });
    } catch {
      return status(503, { status: 'error', db: 'down' });
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
