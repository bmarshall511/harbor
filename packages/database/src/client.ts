import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: pg.Pool | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  // Reuse the pool across hot-reloads in dev (prevents connection exhaustion).
  // In production serverless, each cold start gets its own pool.
  if (!globalForPrisma.pool) {
    globalForPrisma.pool = new pg.Pool({
      connectionString,
      // Serverless-friendly pool settings: small pool, short idle timeout.
      // PgBouncer (Supabase) handles the real connection pooling.
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  const adapter = new PrismaPg(globalForPrisma.pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['warn', 'error'],
  });
}

// Lazy initialization — the client is only created when first accessed.
// This prevents test files that import @harbor/database types from
// crashing when DATABASE_URL is not set in the test environment.
let _db: PrismaClient | undefined;

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!_db) {
      _db = globalForPrisma.prisma ?? createClient();
      if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = _db;
      }
    }
    return (_db as unknown as Record<string | symbol, unknown>)[prop];
  },
});
