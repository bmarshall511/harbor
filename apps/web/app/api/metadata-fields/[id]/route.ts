import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/** PATCH /api/metadata-fields/:id — Update a field template. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.metadata_fields', 'access');
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
  const denied = requirePermission(auth, 'settings.metadata_fields', 'access');
  if (denied) return denied;

  const { id } = await params;

  // Look up the template key before deleting so we can clean up permissions
  const template = await db.metadataFieldTemplate.findUnique({ where: { id } });
  await db.metadataFieldTemplate.delete({ where: { id } });

  // Remove all role permissions for this custom field
  if (template) {
    const resource = `items.custom.${template.key}`;
    await db.rolePermission.deleteMany({ where: { resource } });
  }

  return new NextResponse(null, { status: 204 });
}
