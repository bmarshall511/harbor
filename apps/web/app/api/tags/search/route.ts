import { NextResponse } from 'next/server';
import { TagRepository } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

const repo = new TagRepository();

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  if (!q) return NextResponse.json([]);

  const tags = await repo.search(q);
  return NextResponse.json(tags);
}
