import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArchiveMetadataService } from './archive-metadata';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;
let svc: ArchiveMetadataService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-meta-test-'));
  svc = new ArchiveMetadataService();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ArchiveMetadataService v2', () => {
  describe('item ID resolution', () => {
    it('allocates a stable UUID per relative path', async () => {
      const id1 = await svc.getOrCreateItemId(tmpDir, 'photos/sunset.jpg');
      const id2 = await svc.getOrCreateItemId(tmpDir, 'photos/sunset.jpg');
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('allocates distinct UUIDs for distinct paths', async () => {
      const a = await svc.getOrCreateItemId(tmpDir, 'photos/a.jpg');
      const b = await svc.getOrCreateItemId(tmpDir, 'photos/b.jpg');
      expect(a).not.toBe(b);
    });

    it('persists the index between calls', async () => {
      await svc.getOrCreateItemId(tmpDir, 'photos/sunset.jpg');
      const index = await svc.readIndex(tmpDir);
      expect(Object.keys(index.paths)).toEqual(['photos/sunset.jpg']);
    });
  });

  describe('item read/write', () => {
    it('returns null when no item exists', async () => {
      expect(await svc.readItem(tmpDir, 'photos/sunset.jpg')).toBeNull();
    });

    it('writes and reads an item via updateItem', async () => {
      const { uuid, item } = await svc.updateItem(
        tmpDir,
        'photos/sunset.jpg',
        { name: 'sunset.jpg' },
        {
          core: { title: 'Beach Sunset', rating: 5 },
          fields: { people: [{ kind: 'free', name: 'Aunt Linda' }] },
        },
      );

      expect(item.uuid).toBe(uuid);
      expect(item.system.path).toBe('photos/sunset.jpg');
      expect(item.system.name).toBe('sunset.jpg');
      expect(item.core.title).toBe('Beach Sunset');
      expect(item.core.rating).toBe(5);
      expect(item.fields.people).toEqual([{ kind: 'free', name: 'Aunt Linda' }]);

      const reread = await svc.readItem(tmpDir, 'photos/sunset.jpg');
      expect(reread?.core.title).toBe('Beach Sunset');
      expect(reread?.fields.people).toEqual([{ kind: 'free', name: 'Aunt Linda' }]);
    });

    it('merges core and fields shallowly', async () => {
      await svc.updateItem(
        tmpDir,
        'photos/sunset.jpg',
        { name: 'sunset.jpg' },
        { core: { title: 'A', rating: 5 }, fields: { adult_content: ['none'] } },
      );
      await svc.updateItem(
        tmpDir,
        'photos/sunset.jpg',
        { name: 'sunset.jpg' },
        { core: { description: 'B' }, fields: { mood: 'happy' } },
      );

      const item = await svc.readItem(tmpDir, 'photos/sunset.jpg');
      expect(item?.core.title).toBe('A');
      expect(item?.core.description).toBe('B');
      expect(item?.core.rating).toBe(5);
      expect(item?.fields.adult_content).toEqual(['none']);
      expect(item?.fields.mood).toBe('happy');
    });

    it('persists the JSON file under .harbor/items/', async () => {
      const { uuid } = await svc.updateItem(
        tmpDir,
        'photos/sunset.jpg',
        { name: 'sunset.jpg' },
        { core: { title: 'X' } },
      );
      const exists = await fs
        .access(path.join(tmpDir, '.harbor', 'items', `${uuid}.json`))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('rename', () => {
    it('updates the index entry without touching the JSON file id', async () => {
      const { uuid: original } = await svc.updateItem(
        tmpDir,
        'photos/sunset.jpg',
        { name: 'sunset.jpg' },
        { core: { title: 'Beach Sunset' } },
      );

      await svc.renameItem(tmpDir, 'photos/sunset.jpg', 'photos/2024-sunset.jpg');

      // Index points the new path at the same UUID.
      const index = await svc.readIndex(tmpDir);
      expect(index.paths['photos/2024-sunset.jpg']).toBe(original);
      expect(index.paths['photos/sunset.jpg']).toBeUndefined();

      // The item JSON survived and now reflects the new path.
      const reread = await svc.readItem(tmpDir, 'photos/2024-sunset.jpg');
      expect(reread?.uuid).toBe(original);
      expect(reread?.core.title).toBe('Beach Sunset');
      expect(reread?.system.path).toBe('photos/2024-sunset.jpg');
      expect(reread?.system.name).toBe('2024-sunset.jpg');
    });

    it('is a no-op for an unknown source path', async () => {
      await svc.renameItem(tmpDir, 'photos/missing.jpg', 'photos/whatever.jpg');
      const index = await svc.readIndex(tmpDir);
      expect(index.paths).toEqual({});
    });
  });

  describe('remove', () => {
    it('drops both the index entry and the JSON file', async () => {
      const { uuid } = await svc.updateItem(
        tmpDir,
        'photos/sunset.jpg',
        { name: 'sunset.jpg' },
        { core: { title: 'Beach Sunset' } },
      );
      await svc.removeItem(tmpDir, 'photos/sunset.jpg');

      const index = await svc.readIndex(tmpDir);
      expect(index.paths).toEqual({});

      const exists = await fs
        .access(path.join(tmpDir, '.harbor', 'items', `${uuid}.json`))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('folder metadata', () => {
    it('returns empty object when no folder meta exists', async () => {
      expect(await svc.readFolderMeta(tmpDir, 'photos')).toEqual({});
    });

    it('writes and reads folder meta', async () => {
      await svc.writeFolderMeta(tmpDir, 'photos', {
        description: 'Vacation photos',
        eventDate: '2024-07-15',
        tags: ['vacation'],
      });
      const meta = await svc.readFolderMeta(tmpDir, 'photos');
      expect(meta.description).toBe('Vacation photos');
      expect(meta.tags).toEqual(['vacation']);
    });

    it('merges partial updates and prunes empty values', async () => {
      await svc.updateFolderMeta(tmpDir, 'photos', { description: 'A', tags: ['x'] });
      await svc.updateFolderMeta(tmpDir, 'photos', { description: '', location: 'Hawaii' });
      const meta = await svc.readFolderMeta(tmpDir, 'photos');
      expect(meta.description).toBeUndefined(); // pruned
      expect(meta.location).toBe('Hawaii');
      expect(meta.tags).toEqual(['x']);
    });
  });

  describe('listAllItems', () => {
    it('returns every item written into the archive', async () => {
      await svc.updateItem(tmpDir, 'a.jpg', { name: 'a.jpg' }, { core: { title: 'A' } });
      await svc.updateItem(tmpDir, 'b.jpg', { name: 'b.jpg' }, { core: { title: 'B' } });
      const items = await svc.listAllItems(tmpDir);
      const titles = items.map((i) => i.core.title).sort();
      expect(titles).toEqual(['A', 'B']);
    });

    it('returns [] when there is no .harbor directory', async () => {
      expect(await svc.listAllItems(tmpDir)).toEqual([]);
    });
  });
});
