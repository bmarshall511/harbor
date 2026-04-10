import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LocalFilesystemProvider } from './local-filesystem.provider';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;
let provider: LocalFilesystemProvider;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-test-'));
  provider = new LocalFilesystemProvider('test-id', 'Test Provider', tmpDir);

  // Create test structure
  await fs.mkdir(path.join(tmpDir, 'photos'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'documents'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'photos', 'vacation.jpg'), 'fake-jpg-data');
  await fs.writeFile(path.join(tmpDir, 'photos', 'portrait.png'), 'fake-png-data');
  await fs.writeFile(path.join(tmpDir, 'documents', 'notes.txt'), 'hello world');
  await fs.writeFile(path.join(tmpDir, 'readme.md'), '# Test Archive');
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('LocalFilesystemProvider', () => {
  it('lists root directory entries', async () => {
    const entries = [];
    for await (const entry of provider.listDirectory('')) {
      entries.push(entry);
    }
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain('photos');
    expect(names).toContain('documents');
    expect(names).toContain('readme.md');
  });

  it('lists subdirectory entries', async () => {
    const entries = [];
    for await (const entry of provider.listDirectory('photos')) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name).sort()).toEqual(['portrait.png', 'vacation.jpg']);
  });

  it('identifies directories vs files', async () => {
    const entries = [];
    for await (const entry of provider.listDirectory('')) {
      entries.push(entry);
    }
    const photos = entries.find((e) => e.name === 'photos');
    const readme = entries.find((e) => e.name === 'readme.md');
    expect(photos?.isDirectory).toBe(true);
    expect(readme?.isDirectory).toBe(false);
  });

  it('reads file content', async () => {
    const data = await provider.readFile('documents/notes.txt');
    expect(data.toString()).toBe('hello world');
  });

  it('checks file existence', async () => {
    expect(await provider.exists('documents/notes.txt')).toBe(true);
    expect(await provider.exists('nonexistent.txt')).toBe(false);
  });

  it('gets file metadata', async () => {
    const meta = await provider.getMetadata('photos/vacation.jpg');
    expect(meta.size).toBeGreaterThan(0);
    expect(meta.createdAt).toBeInstanceOf(Date);
  });

  it('creates folders', async () => {
    await provider.createFolder('new-folder');
    expect(await provider.exists('new-folder')).toBe(true);
  });

  it('writes files', async () => {
    await provider.writeFile('new-folder/test.txt', Buffer.from('test content'));
    const data = await provider.readFile('new-folder/test.txt');
    expect(data.toString()).toBe('test content');
  });

  it('renames files', async () => {
    await provider.renameFile('new-folder/test.txt', 'renamed.txt');
    expect(await provider.exists('new-folder/renamed.txt')).toBe(true);
    expect(await provider.exists('new-folder/test.txt')).toBe(false);
  });

  it('deletes files', async () => {
    await provider.deleteFile('new-folder/renamed.txt');
    expect(await provider.exists('new-folder/renamed.txt')).toBe(false);
  });

  it('moves files', async () => {
    await provider.writeFile('moveme.txt', Buffer.from('move'));
    await provider.moveFile('moveme.txt', 'documents/moved.txt');
    expect(await provider.exists('documents/moved.txt')).toBe(true);
    expect(await provider.exists('moveme.txt')).toBe(false);
  });

  it('prevents path traversal', async () => {
    await expect(provider.readFile('../../../etc/passwd')).rejects.toThrow('Path traversal');
  });

  it('searches by name', async () => {
    const results = [];
    for await (const r of provider.search('vacation')) {
      results.push(r);
    }
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('vacation.jpg');
  });

  it('returns correct capabilities', () => {
    const caps = provider.getCapabilities();
    expect(caps.canRead).toBe(true);
    expect(caps.canWrite).toBe(true);
    expect(caps.canDelete).toBe(true);
    expect(caps.canWatch).toBe(true);
  });
});
