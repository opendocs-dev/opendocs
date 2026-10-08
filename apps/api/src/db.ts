import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

let client: PrismaClient | undefined;

/** Shared Prisma client, created on first use so tests can set DATABASE_URL late. */
export const getPrisma = (): PrismaClient => {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');

    client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        connectionTimeoutMillis: 1500,
        query_timeout: 1500,
      }),
    });
  }

  return client;
};
