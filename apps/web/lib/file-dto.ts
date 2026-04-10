/**
 * Single source of truth for serializing a Prisma File row into a
 * client-safe FileDto JSON object.
 *
 * The DB has been refactored so that the on-disk JSON file at
 * `.harbor/items/{harborItemId}.json` is the canonical source of
 * metadata; the DB columns are a derived index. This serializer
 * mirrors that:
 *
 *   • Identity columns (id, paths, dates, name, hash, mime, size)
 *     come straight from the DB row.
 *   • `meta` is the JSON column that mirrors the on-disk JSON.
 *   • `title`, `description`, `rating` are surfaced as top-level
 *     convenience fields for the UI's sort/display paths — they
 *     are duplicates of `meta.core.*` and the indexer keeps them
 *     in sync.
 *
 * Handles BigInt + Date serialization so the result is safe to pass
 * to `JSON.stringify` / `NextResponse.json`.
 */

import type { FileDto, HarborItemMeta, PreviewDto } from '@harbor/types';

type SerializableFile = {
  id: string;
  harborItemId: string;
  archiveRootId: string;
  folderId: string | null;
  name: string;
  path: string;
  mimeType: string | null;
  size: bigint | number;
  hash: string | null;
  status: string;
  fileCreatedAt: Date | null;
  fileModifiedAt: Date | null;
  title: string | null;
  description: string | null;
  rating: number | null;
  meta: unknown;
  tags: Array<{
    tag: { id: string; name: string; color: string | null; category: string | null; usageCount: number };
  }>;
  previews: Array<{
    id: string;
    fileId: string;
    size: string;
    format: string;
    width: number | null;
    height: number | null;
    path: string;
  }>;
};

/**
 * Coerce the raw `meta` JSON column into a well-formed
 * `HarborItemMeta`. Defaults missing keys so the client never has to
 * null-check `meta.core` or `meta.fields`.
 */
function normalizeMeta(raw: unknown): HarborItemMeta {
  if (!raw || typeof raw !== 'object') return { core: {}, fields: {} };
  const obj = raw as Record<string, unknown>;
  return {
    core: (obj.core as HarborItemMeta['core']) ?? {},
    fields: (obj.fields as HarborItemMeta['fields']) ?? {},
    system: obj.system as HarborItemMeta['system'] | undefined,
  };
}

export function serializeFile(file: SerializableFile): FileDto {
  return {
    id: file.id,
    harborItemId: file.harborItemId,
    archiveRootId: file.archiveRootId,
    folderId: file.folderId,
    name: file.name,
    path: file.path,
    mimeType: file.mimeType,
    // BigInt → Number. Sizes that exceed Number.MAX_SAFE_INTEGER
    // (>~9 PB) are not realistic for individual files in this app.
    size: typeof file.size === 'bigint' ? Number(file.size) : file.size,
    hash: file.hash,
    status: file.status as unknown as FileDto['status'],
    fileCreatedAt: file.fileCreatedAt ? file.fileCreatedAt.toISOString() : null,
    fileModifiedAt: file.fileModifiedAt ? file.fileModifiedAt.toISOString() : null,
    title: file.title,
    description: file.description,
    rating: file.rating,
    meta: normalizeMeta(file.meta),
    tags: file.tags.map((t) => ({
      id: t.tag.id,
      name: t.tag.name,
      color: t.tag.color,
      category: t.tag.category,
      usageCount: t.tag.usageCount,
    })),
    previews: file.previews.map<PreviewDto>((p) => ({
      id: p.id,
      fileId: p.fileId,
      size: p.size as PreviewDto['size'],
      format: p.format,
      width: p.width,
      height: p.height,
      path: p.path,
    })),
  };
}
