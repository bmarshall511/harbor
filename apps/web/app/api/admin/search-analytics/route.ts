import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/**
 * GET /api/admin/search-analytics — Search analytics dashboard data.
 * DELETE /api/admin/search-analytics — Clear all search logs.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    topQueries,
    zeroResultQueries,
    perUserCounts,
    totalSearches,
    searchesToday,
    avgDuration,
    recentLogs,
  ] = await Promise.all([
    db.$queryRaw<Array<{ query: string; count: bigint; avg_results: number }>>`
      SELECT query, COUNT(*)::bigint as count, AVG(result_count)::int as avg_results
      FROM search_logs
      WHERE created_at >= ${sevenDaysAgo} AND query != ''
      GROUP BY query ORDER BY count DESC LIMIT 20
    `,
    db.$queryRaw<Array<{ query: string; count: bigint; last_searched: Date }>>`
      SELECT query, COUNT(*)::bigint as count, MAX(created_at) as last_searched
      FROM search_logs
      WHERE created_at >= ${sevenDaysAgo} AND query != '' AND result_count = 0
      GROUP BY query ORDER BY count DESC LIMIT 15
    `,
    db.$queryRaw<Array<{ user_id: string; display_name: string; username: string; count: bigint }>>`
      SELECT sl.user_id, u.display_name, u.username, COUNT(*)::bigint as count
      FROM search_logs sl JOIN users u ON u.id = sl.user_id
      WHERE sl.created_at >= ${sevenDaysAgo}
      GROUP BY sl.user_id, u.display_name, u.username ORDER BY count DESC LIMIT 20
    `,
    db.searchLog.count(),
    db.searchLog.count({ where: { createdAt: { gte: todayStart } } }),
    db.$queryRaw<[{ avg_ms: number }]>`
      SELECT COALESCE(AVG(duration_ms), 0)::int as avg_ms FROM search_logs WHERE created_at >= ${sevenDaysAgo}
    `,
    db.searchLog.findMany({
      include: { user: { select: { id: true, username: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  return NextResponse.json({
    topQueries: topQueries.map((q) => ({ query: q.query, count: Number(q.count), avgResults: q.avg_results })),
    zeroResultQueries: zeroResultQueries.map((q) => ({ query: q.query, count: Number(q.count), lastSearched: q.last_searched })),
    perUserCounts: perUserCounts.map((u) => ({ userId: u.user_id, displayName: u.display_name, username: u.username, count: Number(u.count) })),
    stats: { totalSearches, searchesToday, avgDurationMs: avgDuration[0]?.avg_ms ?? 0 },
    recentLogs: recentLogs.map((l) => ({
      id: l.id, query: l.query, filters: l.filters, resultCount: l.resultCount,
      durationMs: l.durationMs, createdAt: l.createdAt.toISOString(),
      user: { id: l.user.id, username: l.user.username, displayName: l.user.displayName },
    })),
  });
}

/** DELETE /api/admin/search-analytics — Clear all search log entries. */
export async function DELETE(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { count } = await db.searchLog.deleteMany({});
  return NextResponse.json({ ok: true, deleted: count });
}
