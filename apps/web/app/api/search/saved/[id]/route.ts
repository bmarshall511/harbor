import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

/** DELETE /api/search/saved/:id — Delete a saved search. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const saved = await db.savedSearch.findUnique({ where: { id } });
  if (!saved || saved.userId !== auth.userId) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  await db.savedSearch.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
