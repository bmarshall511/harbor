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
  const denied = requirePermission(auth, 'settings.metadata_fields', 'access');
  if (denied) return denied;

  const { name, key, fieldType, options, required, appliesTo, showInSearch, hiddenByDefault } = await request.json();
  if (!name?.trim() || !key?.trim() || !fieldType) {
    return NextResponse.json({ message: 'name, key, and fieldType required' }, { status: 400 });
  }

  const maxOrder = await db.metadataFieldTemplate.aggregate({ _max: { sortOrder: true } });
  const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
  const field = await db.metadataFieldTemplate.create({
    data: {
      name: name.trim(),
      key: normalizedKey,
      fieldType,
      options: options ?? [],
      required: required ?? false,
      sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      appliesTo: appliesTo ?? ['all'],
      showInSearch: showInSearch ?? false,
      hiddenByDefault: hiddenByDefault ?? false,
    },
  });

  // Auto-create field permissions for roles that should have access
  const resource = `items.custom.${normalizedKey}`;
  const roles = await db.role.findMany();
  const permData: Array<{ roleId: string; resource: string; action: string }> = [];
  for (const role of roles) {
    if (['OWNER', 'ADMIN', 'EDITOR'].includes(role.systemRole)) {
      permData.push({ roleId: role.id, resource, action: 'view' });
      permData.push({ roleId: role.id, resource, action: 'edit' });
    } else if (role.systemRole === 'VIEWER') {
      permData.push({ roleId: role.id, resource, action: 'view' });
    }
  }
  if (permData.length > 0) {
    await db.rolePermission.createMany({ data: permData, skipDuplicates: true });
  }

  return NextResponse.json(field, { status: 201 });
}
