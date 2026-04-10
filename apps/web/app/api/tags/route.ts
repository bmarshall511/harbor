import { NextResponse } from 'next/server';
import { TagRepository } from '@harbor/database';
import { requireAuth } from '@/lib/auth';

const repo = new TagRepository();

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') ?? undefined;
  const category = searchParams.get('category') ?? undefined;

  const tags = await repo.findAll({ search, category });
  return NextResponse.json(tags);
}
