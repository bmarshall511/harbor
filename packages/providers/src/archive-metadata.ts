import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Archive Metadata Service (v2) — UUID-keyed item metadata.
 *
 * # Source of truth
 *
 * The on-disk JSON file is canonical for ALL item metadata: title,
 * description, tags, people, custom fields, AI fields, EXIF, etc.
 * The database stores a derived index for search/filter performance,
 * but ANY write goes through this service first.
 *
 * # On-disk layout
 *
 *   {archiveRoot}/.harbor/items/{uuid}.json   ← per-item metadata
 *   {archiveRoot}/.harbor/index.json          ← path → uuid mapping
 *   {archiveRoot}/.harbor/folders/{folderPath}/meta.json  ← per-folder meta
 *
 * The `index.json` makes the system self-describing: any external
 * tool can read it to find the UUID for a given current file path,
 * then read the item JSON. This means if Harbor renames or moves a
 * file we only need to touch `index.json`; the per-item JSON file
 * keeps its stable name forever.
 *
 * # Why UUID-keyed (not filename-keyed)
 *
 * The previous v1 layout was `.harbor/files/{filename}.json`. That
 * broke the moment a user renamed a file outside Harbor — the JSON
 * was orphaned. UUID keying makes metadata survive any rename,
 * move within an archive, or external tool that touches the file.
 *
 * # All providers
 *
 * The service operates on a string `archiveRootPath` so it works
 * uniformly for local filesystem archives. For Dropbox archives,
 * Harbor stores the metadata in a server-side cache directory; the
 * caller passes that cache directory as `archiveRootPath` instead
 * of the Dropbox URL.
 */

const HARBOR_DIR = '.harbor';
const ITEMS_DIR = 'items';
const INDEX_FILE = 'index.json';
const FOLDERS_DIR = 'folders';
const FOLDER_META_FILE = 'meta.json';

// ─── Item shape ─────────────────────────────────────────────────────

/**
 * The canonical shape persisted to `.harbor/items/{uuid}.json`.
 *
 * Three reserved sections:
 *   • `core`   — fields the app indexes as typed DB columns
 *                (title, description, rating). Always strings/numbers.
 *   • `system` — provenance fields owned by the app
 *                (uuid, current path, original name, hash, dates).
 *   • `fields` — every custom field, keyed by the field's machine
 *                key. Values are JSON-clean (string, number, array,
 *                object). This is where People, Adult Content, EXIF,
 *                AI fields, etc. live.
 *
 * Splitting it this way makes the JSON readable, makes the DB
 * mirror trivial to derive (`core` becomes typed columns, the whole
 * file becomes the `meta` JsonB column), and keeps the door open
 * for adding new typed columns later without bumping a version.
 */
export interface HarborItemJson {
  uuid: string;
  system: {
    /** Path relative to the archive root, no leading slash. */
    path: string;
    /** Filename only. */
    name: string;
    /** Optional content hash for offline diffing. */
    hash?: string;
    createdAt?: string; // file creation time (filesystem)
    modifiedAt?: string; // file modification time (filesystem)
    importedAt: string; // when Harbor first saw the file
    updatedAt: string; // last metadata change
  };
  core: {
    title?: string;
    description?: string;
    rating?: number;
  };
  /** Custom + AI + EXIF fields, keyed by their stable machine key. */
  fields: Record<string, unknown>;
}

export interface HarborIndexJson {
  /** Map of current relative path → item UUID. */
  paths: Record<string, string>;
  /** Last time the index was updated, ISO timestamp. */
  updatedAt: string;
}

// ─── Folder metadata (separate file) ────────────────────────────────

export interface FolderMetaJson {
  description?: string;
  eventDate?: string;
  location?: string;
  tags?: string[];
  coverItemId?: string; // UUID of an item in this folder
  notes?: string;
}

// ─── Service ────────────────────────────────────────────────────────

export class ArchiveMetadataService {
  // ─── Index ────────────────────────────────────────────────────────

  private indexPath(archiveRootPath: string): string {
    return path.join(archiveRootPath, HARBOR_DIR, INDEX_FILE);
  }

  /** Read the path → UUID index. Returns an empty index if missing. */
  async readIndex(archiveRootPath: string): Promise<HarborIndexJson> {
    try {
      const raw = await fsp.readFile(this.indexPath(archiveRootPath), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<HarborIndexJson>;
      return {
        paths: parsed.paths ?? {},
        updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      };
    } catch {
      return { paths: {}, updatedAt: new Date(0).toISOString() };
    }
  }

  private async writeIndex(archiveRootPath: string, index: HarborIndexJson): Promise<void> {
    await fsp.mkdir(path.join(archiveRootPath, HARBOR_DIR), { recursive: true });
    await fsp.writeFile(
      this.indexPath(archiveRootPath),
      JSON.stringify({ ...index, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8',
    );
  }

  /**
   * Resolve (or allocate) a stable UUID for a given current relative
   * path. Persists the new mapping atomically to `index.json`.
   */
  async getOrCreateItemId(archiveRootPath: string, relPath: string): Promise<string> {
    const index = await this.readIndex(archiveRootPath);
    const existing = index.paths[relPath];
    if (existing) return existing;

    const uuid = crypto.randomUUID();
    index.paths[relPath] = uuid;
    await this.writeIndex(archiveRootPath, index);
    return uuid;
  }

  /**
   * Update the index entry for a renamed/moved file. The item JSON
   * file itself does NOT need to be touched on rename — only the
   * mapping changes. We then patch the item JSON's `system.path`
   * + `system.name` for transparency to external tools.
   */
  async renameItem(
    archiveRootPath: string,
    fromPath: string,
    toPath: string,
  ): Promise<void> {
    const index = await this.readIndex(archiveRootPath);
    const uuid = index.paths[fromPath];
    if (!uuid) return;
    delete index.paths[fromPath];
    index.paths[toPath] = uuid;
    await this.writeIndex(archiveRootPath, index);

    // Patch the item JSON's path/name to match.
    const item = await this.readItemByUuid(archiveRootPath, uuid);
    if (item) {
      item.system.path = toPath;
      item.system.name = path.basename(toPath);
      item.system.updatedAt = new Date().toISOString();
      await this.writeItemByUuid(archiveRootPath, uuid, item);
    }
  }

  /** Drop both the index entry and the on-disk JSON for a removed file. */
  async removeItem(archiveRootPath: string, relPath: string): Promise<void> {
    const index = await this.readIndex(archiveRootPath);
    const uuid = index.paths[relPath];
    if (!uuid) return;
    delete index.paths[relPath];
    await this.writeIndex(archiveRootPath, index);
    try {
      await fsp.unlink(this.itemPath(archiveRootPath, uuid));
    } catch {
      /* already gone */
    }
  }

  // ─── Item read/write ─────────────────────────────────────────────

  private itemPath(archiveRootPath: string, uuid: string): string {
    return path.join(archiveRootPath, HARBOR_DIR, ITEMS_DIR, `${uuid}.json`);
  }

  /** Read an item by its stable UUID. Returns `null` if missing. */
  async readItemByUuid(archiveRootPath: string, uuid: string): Promise<HarborItemJson | null> {
    try {
      const raw = await fsp.readFile(this.itemPath(archiveRootPath, uuid), 'utf-8');
      return JSON.parse(raw) as HarborItemJson;
    } catch {
      return null;
    }
  }

  /** Read by current path. Convenience wrapper around the index. */
  async readItem(archiveRootPath: string, relPath: string): Promise<HarborItemJson | null> {
    const index = await this.readIndex(archiveRootPath);
    const uuid = index.paths[relPath];
    if (!uuid) return null;
    return this.readItemByUuid(archiveRootPath, uuid);
  }

  /** Write an item by UUID. */
  async writeItemByUuid(
    archiveRootPath: string,
    uuid: string,
    item: HarborItemJson,
  ): Promise<void> {
    const dir = path.join(archiveRootPath, HARBOR_DIR, ITEMS_DIR);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      this.itemPath(archiveRootPath, uuid),
      JSON.stringify({ ...item, system: { ...item.system, updatedAt: new Date().toISOString() } }, null, 2),
      'utf-8',
    );
  }

  /**
   * Merge a partial update into an existing item, creating the item
   * + index entry if it doesn't exist yet. Returns the merged item.
   *
   * `core` and `fields` are merged shallowly — pass an explicit
   * `null`/`undefined` value to clear a key.
   */
  async updateItem(
    archiveRootPath: string,
    relPath: string,
    init: { name: string; hash?: string; createdAt?: Date | null; modifiedAt?: Date | null },
    updates: { core?: Partial<HarborItemJson['core']>; fields?: Record<string, unknown> },
  ): Promise<{ uuid: string; item: HarborItemJson }> {
    const uuid = await this.getOrCreateItemId(archiveRootPath, relPath);
    const existing = await this.readItemByUuid(archiveRootPath, uuid);

    const now = new Date().toISOString();
    const base: HarborItemJson = existing ?? {
      uuid,
      system: {
        path: relPath,
        name: init.name,
        hash: init.hash,
        createdAt: init.createdAt?.toISOString(),
        modifiedAt: init.modifiedAt?.toISOString(),
        importedAt: now,
        updatedAt: now,
      },
      core: {},
      fields: {},
    };

    // Always refresh the system block with the latest filesystem facts.
    base.system = {
      ...base.system,
      path: relPath,
      name: init.name,
      hash: init.hash ?? base.system.hash,
      createdAt: init.createdAt?.toISOString() ?? base.system.createdAt,
      modifiedAt: init.modifiedAt?.toISOString() ?? base.system.modifiedAt,
      updatedAt: now,
    };

    if (updates.core) {
      base.core = pruneEmpty({ ...base.core, ...updates.core }) as HarborItemJson['core'];
    }
    if (updates.fields) {
      base.fields = pruneEmpty({ ...base.fields, ...updates.fields });
    }

    await this.writeItemByUuid(archiveRootPath, uuid, base);
    return { uuid, item: base };
  }

  // ─── Folder metadata ─────────────────────────────────────────────

  private folderMetaPath(archiveRootPath: string, folderPath: string): string {
    return path.join(archiveRootPath, HARBOR_DIR, FOLDERS_DIR, folderPath, FOLDER_META_FILE);
  }

  async readFolderMeta(archiveRootPath: string, folderPath: string): Promise<FolderMetaJson> {
    try {
      const raw = await fsp.readFile(this.folderMetaPath(archiveRootPath, folderPath), 'utf-8');
      return JSON.parse(raw) as FolderMetaJson;
    } catch {
      return {};
    }
  }

  async writeFolderMeta(archiveRootPath: string, folderPath: string, meta: FolderMetaJson): Promise<void> {
    const filePath = this.folderMetaPath(archiveRootPath, folderPath);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(
      filePath,
      JSON.stringify(pruneEmpty(meta as unknown as Record<string, unknown>), null, 2),
      'utf-8',
    );
  }

  async updateFolderMeta(
    archiveRootPath: string,
    folderPath: string,
    updates: Partial<FolderMetaJson>,
  ): Promise<FolderMetaJson> {
    const existing = await this.readFolderMeta(archiveRootPath, folderPath);
    const merged = pruneEmpty({ ...existing, ...updates } as unknown as Record<string, unknown>) as unknown as FolderMetaJson;
    await this.writeFolderMeta(archiveRootPath, folderPath, merged);
    return merged;
  }

  // ─── Bulk ops (used by indexer rebuild) ──────────────────────────

  /** List every item JSON in the archive's `.harbor/items/` directory. */
  async listAllItems(archiveRootPath: string): Promise<HarborItemJson[]> {
    const dir = path.join(archiveRootPath, HARBOR_DIR, ITEMS_DIR);
    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      return [];
    }
    const out: HarborItemJson[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const raw = await fsp.readFile(path.join(dir, entry), 'utf-8');
        out.push(JSON.parse(raw) as HarborItemJson);
      } catch {
        /* skip malformed */
      }
    }
    return out;
  }
}

/**
 * Strip `null`, `undefined`, empty strings, and empty arrays from an
 * object before persisting. The JSON file should never have noise.
 */
function pruneEmpty<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as T;
}
