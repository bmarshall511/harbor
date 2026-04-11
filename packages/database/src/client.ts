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
    const isSupabase = connectionString.includes('supabase.com');
    globalForPrisma.pool = new pg.Pool({
      connectionString,
      // On serverless (Vercel), each function invocation may be a new
      // container. Supabase's connection pooler (Supavisor) handles
      // real pooling, so our local pool should be minimal: 1 connection
      // per function instance, released quickly.
      max: isSupabase ? 1 : 5,
      idleTimeoutMillis: isSupabase ? 10_000 : 30_000,
      connectionTimeoutMillis: 10_000,
      // Supabase requires SSL connections.
      ssl: isSupabase || connectionString.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined,
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
