import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/files/:id/faces — List detected faces for a file.
 * Returns face records with their linked Person info.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const faces = await db.face.findMany({
    where: { fileId: id },
    include: {
      person: { select: { id: true, name: true, avatarUrl: true, isConfirmed: true } },
    },
    orderBy: { confidence: 'desc' },
  });

  return NextResponse.json(
    faces.map((f) => ({
      id: f.id,
      fileId: f.fileId,
      boundingBox: f.boundingBox,
      confidence: f.confidence,
      person: f.person
        ? {
            id: f.person.id,
            name: f.person.name,
            avatarUrl: f.person.avatarUrl,
            isConfirmed: f.person.isConfirmed,
          }
        : null,
    })),
  );
}
