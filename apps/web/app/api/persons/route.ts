import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/**
 * GET /api/persons — List all known persons.
 *
 * Returns two merged sets:
 *   1. Person records from the `persons` table (face detection +
 *      admin-created), with face count and linked user info.
 *   2. Free-text people names from `meta.fields.people` across all
 *      files that don't yet have a matching Person record. These
 *      are surfaced so the admin can see everyone referenced in
 *      the archive and promote them to proper Person records.
 *
 * The `source` field distinguishes the two: `"record"` for DB
 * Person rows, `"metadata"` for free-text-only names.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  // 1. Person records from the DB
  const persons = await db.person.findMany({
    where: { name: { not: null } },
    include: {
      _count: { select: { faces: true } },
      linkedUser: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const personNames = new Set(persons.map((p) => p.name!.toLowerCase()));

  // 2. Free-text people names from file metadata not covered by a Person record
  const filesWithPeople = await db.file.findMany({
    where: {
      status: { notIn: ['DELETED', 'PENDING_DELETE'] },
      meta: { path: ['fields', 'people'], not: null as unknown as undefined },
    },
    select: { meta: true },
    take: 5000,
  });

  const metaNameCounts = new Map<string, { name: string; count: number }>();
  for (const f of filesWithPeople) {
    const meta = f.meta as { fields?: { people?: Array<{ name?: string }> } } | null;
    const people = meta?.fields?.people;
    if (!Array.isArray(people)) continue;
    for (const p of people) {
      const name = typeof p === 'object' && p && typeof p.name === 'string' ? p.name : null;
      if (!name) continue;
      if (personNames.has(name.toLowerCase())) continue; // Already has a Person record
      const key = name.toLowerCase();
      const existing = metaNameCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        metaNameCounts.set(key, { name, count: 1 });
      }
    }
  }

  const result = [
    ...persons.map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl ?? p.linkedUser?.avatarUrl ?? null,
      entityType: p.entityType ?? 'PERSON',
      gender: p.gender ?? null,
      isConfirmed: p.isConfirmed,
      faceCount: p._count.faces,
      linkedUser: p.linkedUser
        ? { id: p.linkedUser.id, username: p.linkedUser.username, displayName: p.linkedUser.displayName }
        : null,
      source: 'record' as const,
      fileCount: 0,
    })),
    ...[...metaNameCounts.values()].map((m) => ({
      id: null as string | null,
      name: m.name,
      avatarUrl: null as string | null,
      entityType: 'PERSON' as const,
      gender: null as string | null,
      isConfirmed: false,
      faceCount: 0,
      linkedUser: null as { id: string; username: string; displayName: string } | null,
      source: 'metadata' as const,
      fileCount: m.count,
    })),
  ];

  // Sort: confirmed records first, then by face count, then by file count
  result.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'record' ? -1 : 1;
    return (b.faceCount + (b.fileCount ?? 0)) - (a.faceCount + (a.fileCount ?? 0));
  });

  return NextResponse.json(result);
}

/**
 * POST /api/persons — Create a new person (admin only).
 * Used when admins want to pre-register people who aren't app users
 * (e.g. family members, historical figures in an archive).
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { name, linkedUserId, entityType, gender } = await request.json();
  if (!name?.trim()) {
    return NextResponse.json({ message: 'Name is required' }, { status: 400 });
  }

  const person = await db.person.create({
    data: {
      name: name.trim(),
      isConfirmed: true,
      ...(linkedUserId ? { linkedUserId } : {}),
      ...(entityType === 'PET' ? { entityType: 'PET' } : {}),
      ...(gender ? { gender } : {}),
    },
  });

  return NextResponse.json(person, { status: 201 });
}
