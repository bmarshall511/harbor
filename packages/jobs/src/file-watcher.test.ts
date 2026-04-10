import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileWatcherService } from './file-watcher';

// Mock dependencies
vi.mock('@harbor/database', () => ({
  db: {
    file: { findMany: vi.fn().mockResolvedValue([]) },
    folder: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    tag: { upsert: vi.fn() },
    fileTag: { upsert: vi.fn() },
  },
  FileRepository: vi.fn().mockImplementation(() => ({
    findByPath: vi.fn().mockResolvedValue(null),
    upsertByPath: vi.fn().mockResolvedValue({ id: 'file-1' }),
    update: vi.fn(),
    delete: vi.fn(),
  })),
  FolderRepository: vi.fn().mockImplementation(() => ({
    findByPath: vi.fn().mockResolvedValue(null),
    upsertByPath: vi.fn().mockResolvedValue({ id: 'folder-1' }),
    update: vi.fn(),
    delete: vi.fn(),
  })),
  ArchiveRootRepository: vi.fn().mockImplementation(() => ({
    findAll: vi.fn().mockResolvedValue([]),
  })),
  SettingsRepository: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue('./data/preview-cache'),
  })),
}));

vi.mock('@harbor/providers', () => ({
  LocalFilesystemProvider: vi.fn().mockImplementation(() => ({
    watchChanges: vi.fn().mockReturnValue((async function* () {})()),
    computeHash: vi.fn().mockResolvedValue('abc123'),
  })),
  // Mock the v2 ArchiveMetadataService surface area used by the
  // watcher. The old v1 method names (`readFileMeta`, etc.) were
  // removed in the metadata refactor.
  ArchiveMetadataService: vi.fn().mockImplementation(() => ({
    readFolderMeta: vi.fn().mockResolvedValue({}),
    getOrCreateItemId: vi.fn().mockResolvedValue('11111111-1111-1111-1111-111111111111'),
    readItemByUuid: vi.fn().mockResolvedValue(null),
    updateItem: vi.fn().mockResolvedValue({
      uuid: '11111111-1111-1111-1111-111111111111',
      item: {
        uuid: '11111111-1111-1111-1111-111111111111',
        system: { path: '', name: '', importedAt: '', updatedAt: '' },
        core: {},
        fields: {},
      },
    }),
  })),
}));

vi.mock('@harbor/realtime', () => ({
  eventBus: {
    emit: vi.fn(),
  },
}));

vi.mock('@harbor/utils', () => ({
  guessMimeType: vi.fn().mockReturnValue('image/jpeg'),
}));

describe('FileWatcherService', () => {
  let service: FileWatcherService;

  beforeEach(() => {
    service = new FileWatcherService();
  });

  afterEach(() => {
    service.stopAll();
  });

  it('starts with no watchers', () => {
    expect(service.getWatchedRoots()).toEqual([]);
  });

  it('start() sets up watchers for active local roots', async () => {
    const { ArchiveRootRepository } = await import('@harbor/database');
    const MockRepo = ArchiveRootRepository as unknown as ReturnType<typeof vi.fn>;
    MockRepo.mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue([
        { id: 'root-1', name: 'Photos', providerType: 'LOCAL_FILESYSTEM', rootPath: '/tmp/test-photos', isActive: true },
        { id: 'root-2', name: 'Dropbox', providerType: 'DROPBOX', rootPath: '/Photos', isActive: true },
      ]),
    }));

    const svc = new FileWatcherService();
    await svc.start();
    const watched = svc.getWatchedRoots();
    // Only local roots should be watched
    expect(watched).toContain('root-1');
    expect(watched).not.toContain('root-2');
    svc.stopAll();
  });

  it('watchRoot is idempotent', () => {
    service.watchRoot('root-1', '/tmp/test');
    service.watchRoot('root-1', '/tmp/test');
    expect(service.getWatchedRoots()).toEqual(['root-1']);
  });

  it('unwatchRoot removes watcher', () => {
    service.watchRoot('root-1', '/tmp/test');
    expect(service.getWatchedRoots()).toContain('root-1');
    service.unwatchRoot('root-1');
    expect(service.getWatchedRoots()).not.toContain('root-1');
  });

  it('stopAll clears all watchers', () => {
    service.watchRoot('root-1', '/tmp/test1');
    service.watchRoot('root-2', '/tmp/test2');
    expect(service.getWatchedRoots()).toHaveLength(2);
    service.stopAll();
    expect(service.getWatchedRoots()).toHaveLength(0);
  });

  it('start() is idempotent', async () => {
    await service.start();
    await service.start();
    // Should not throw
  });
});
