import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/**
 * POST /api/persons/merge — Merge multiple Person records into one.
 *
 * Body: { targetId: string, sourceIds: string[] }
 *
 * All Face records linked to any source Person are reassigned to the
 * target. All file metadata `meta.fields.people` entries that match
 * a source Person's name are rewritten to use the target's name.
 * Source Person records are deleted after the merge.
 *
 * Admin only.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.people', 'access');
  if (denied) return denied;

  const { targetId, sourceIds } = await request.json();
  if (!targetId || !Array.isArray(sourceIds) || sourceIds.length === 0) {
    return NextResponse.json({ message: 'targetId and sourceIds[] required' }, { status: 400 });
  }

  // Validate target exists
  const target = await db.person.findUnique({ where: { id: targetId } });
  if (!target) return NextResponse.json({ message: 'Target person not found' }, { status: 404 });

  // Load sources
  const sources = await db.person.findMany({ where: { id: { in: sourceIds } } });
  if (sources.length === 0) return NextResponse.json({ message: 'No valid source persons found' }, { status: 404 });

  const sourceNames = sources.map((s) => s.name).filter(Boolean) as string[];

  // 1. Reassign all Face records from sources to target
  await db.face.updateMany({
    where: { personId: { in: sourceIds } },
    data: { personId: targetId },
  });

  // 2. Update file metadata: replace source names with target name
  // in meta.fields.people arrays across all files. We use raw SQL
  // because Prisma can't do JSONB array element replacement.
  if (target.name && sourceNames.length > 0) {
    for (const sourceName of sourceNames) {
      if (sourceName.toLowerCase() === target.name.toLowerCase()) continue;

      // Find files that reference this source name
      const filesWithSource = await db.$queryRawUnsafe<Array<{ id: string; meta: unknown }>>(
        `SELECT id::text, meta FROM files
         WHERE meta -> 'fields' -> 'people' IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(meta -> 'fields' -> 'people') AS elem
             WHERE elem ->> 'name' = $1
           )`,
        sourceName,
      );

      for (const file of filesWithSource) {
        const meta = file.meta as { fields?: { people?: Array<{ kind: string; name: string; id?: string }> } };
        const people = meta?.fields?.people;
        if (!Array.isArray(people)) continue;

        // Replace the source name with the target name, deduplicating
        const updated = people.map((p) => {
          if (p.name.toLowerCase() === sourceName.toLowerCase()) {
            return { ...p, name: target.name! };
          }
          return p;
        });

        // Deduplicate by name (case-insensitive)
        const seen = new Set<string>();
        const deduped = updated.filter((p) => {
          const key = p.name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Write back
        await db.$executeRawUnsafe(
          `UPDATE files SET meta = jsonb_set(meta, '{fields,people}', $1::jsonb) WHERE id = $2::uuid`,
          JSON.stringify(deduped),
          file.id,
        );
      }
    }
  }

  // 3. Delete source Person records (faces already reassigned)
  await db.person.deleteMany({ where: { id: { in: sourceIds } } });

  // 4. Count the final state
  const faceCount = await db.face.count({ where: { personId: targetId } });

  return NextResponse.json({
    ok: true,
    targetId,
    mergedCount: sources.length,
    faceCount,
    renamedFiles: sourceNames.length > 0 ? 'metadata updated' : 'no name changes needed',
  });
}
