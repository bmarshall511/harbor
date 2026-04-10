import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/** PATCH /api/metadata-fields/:id — Update a field template. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();

  const field = await db.metadataFieldTemplate.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.fieldType !== undefined ? { fieldType: body.fieldType } : {}),
      ...(body.options !== undefined ? { options: body.options } : {}),
      ...(body.required !== undefined ? { required: body.required } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.appliesTo !== undefined ? { appliesTo: body.appliesTo } : {}),
      ...(body.showInSearch !== undefined ? { showInSearch: body.showInSearch } : {}),
      ...(body.hiddenByDefault !== undefined ? { hiddenByDefault: body.hiddenByDefault } : {}),
    },
  });

  return NextResponse.json(field);
}

/** DELETE /api/metadata-fields/:id — Delete a field template. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'admin', 'manage');
  if (denied) return denied;

  const { id } = await params;
  await db.metadataFieldTemplate.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
