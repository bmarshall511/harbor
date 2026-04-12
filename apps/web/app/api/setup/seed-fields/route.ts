import { NextResponse } from 'next/server';
import { db } from '@harbor/database';
import { requireAuth, requirePermission } from '@/lib/auth';

/**
 * POST /api/setup/seed-fields — Seed default metadata field templates.
 * Admin only. Idempotent — won't overwrite existing fields.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const denied = requirePermission(auth, 'settings.metadata_fields', 'access');
  if (denied) return denied;

  const fieldTemplates = [
    { name: 'Title', key: 'title', fieldType: 'text', sortOrder: 1 },
    { name: 'Description', key: 'description', fieldType: 'textarea', sortOrder: 2 },
    { name: 'Tags', key: 'tags', fieldType: 'multiselect', sortOrder: 3 },
    { name: 'People', key: 'people', fieldType: 'people', sortOrder: 4, showInSearch: true },
    {
      name: 'Adult Content', key: 'adult_content', fieldType: 'multiselect', sortOrder: 5,
      options: [
        { value: 'nudity', label: 'Nudity' },
        { value: 'sexual_acts', label: 'Sexual Acts' },
        { value: 'suggestive', label: 'Suggestive' },
      ],
      showInSearch: true, hiddenByDefault: true,
    },
  ];

  let created = 0;
  for (const tmpl of fieldTemplates) {
    const existing = await db.metadataFieldTemplate.findUnique({ where: { key: tmpl.key } });
    if (!existing) {
      await db.metadataFieldTemplate.create({
        data: {
          name: tmpl.name,
          key: tmpl.key,
          fieldType: tmpl.fieldType,
          sortOrder: tmpl.sortOrder,
          options: (tmpl as { options?: unknown }).options ?? [],
          showInSearch: (tmpl as { showInSearch?: boolean }).showInSearch ?? false,
          hiddenByDefault: (tmpl as { hiddenByDefault?: boolean }).hiddenByDefault ?? false,
        },
      });
      created++;
    }
  }

  return NextResponse.json({ ok: true, created, total: fieldTemplates.length });
}
