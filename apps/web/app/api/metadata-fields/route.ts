import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/** GET /api/metadata-fields — List all metadata field templates. */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const fields = await db.metadataFieldTemplate.findMany({
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json(fields);
}

/** POST /api/metadata-fields — Create a new field template. Admin only. */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { name, key, fieldType, options, required, appliesTo, showInSearch, hiddenByDefault } = await request.json();
  if (!name?.trim() || !key?.trim() || !fieldType) {
    return NextResponse.json({ message: 'name, key, and fieldType required' }, { status: 400 });
  }

  const maxOrder = await db.metadataFieldTemplate.aggregate({ _max: { sortOrder: true } });
  const field = await db.metadataFieldTemplate.create({
    data: {
      name: name.trim(),
      key: key.trim().toLowerCase().replace(/\s+/g, '_'),
      fieldType,
      options: options ?? [],
      required: required ?? false,
      sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      appliesTo: appliesTo ?? ['all'],
      showInSearch: showInSearch ?? false,
      hiddenByDefault: hiddenByDefault ?? false,
    },
  });

  return NextResponse.json(field, { status: 201 });
}
