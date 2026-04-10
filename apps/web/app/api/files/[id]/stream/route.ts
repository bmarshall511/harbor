import { NextResponse } from 'next/server';
import { FileRepository, ArchiveRootRepository, db } from '@harbor/database';
import { DropboxProvider } from '@harbor/providers';
import { requireAuth } from '@/lib/auth';
import { getSecret } from '@/lib/secrets';
import { getSetting } from '@/lib/settings';
import { toProviderPath } from '@/lib/provider-paths';
import { isCloudMode } from '@/lib/deployment';

const fileRepo = new FileRepository();
const rootRepo = new ArchiveRootRepository();

/**
 * Many video container formats — `.m4v`, `.mts`, `.m2ts`, `.flv` —
 * have technically-correct MIME types (`video/x-m4v`, `video/mp2t`,
 * `video/x-flv`) that browsers refuse to play even when the underlying
 * codec is fine. Re-label them with a pragmatic equivalent that the
 * `<video>` element will actually accept. This only changes the
 * Content-Type header on the response; the bytes are unmodified, and
 * the canonical MIME stored in the DB stays accurate for indexing.
 */
function browserPlayableMime(mime: string | null): string {
  if (!mime) return 'application/octet-stream';
  switch (mime) {
    case 'video/x-m4v': return 'video/mp4';
    case 'video/mp2t':  return 'video/mp4'; // .mts/.m2ts are H.264 in MPEG-TS; some browsers honor mp4
    case 'video/x-flv': return 'video/mp4';
    case 'video/quicktime': return 'video/quicktime'; // Safari plays this
    default: return mime;
  }
}

/**
 * Parse an HTTP `Range: bytes=START-END` header.
 * Returns `{ start, end }` (end is inclusive) or `null` for unparseable values.
 */
function parseRangeHeader(range: string | null, totalSize: number): { start: number; end: number } | null {
  if (!range) return null;
  const m = range.match(/^bytes=(\d+)-(\d*)$/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : totalSize - 1;
  if (start >= totalSize || start > end) return null;
  return { start, end: Math.min(end, totalSize - 1) };
}

/**
 * Return a full or partial (206) response from a Buffer, honouring
 * the `Range` header the browser sends when seeking in `<video>`.
 */
function rangeAwareResponse(
  data: Buffer | Uint8Array,
  mime: string,
  rangeHeader: string | null,
): NextResponse {
  const total = data.length;
  const range = parseRangeHeader(rangeHeader, total);

  if (!range) {
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(total),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  const { start, end } = range;
  const slice = new Uint8Array(data.slice(start, end + 1));
  return new NextResponse(slice, {
    status: 206,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(slice.byteLength),
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/**
 * GET /api/files/:id/stream — Serve file content inline for media playback.
 *
 * Supports HTTP Range requests (RFC 7233) so `<video>` elements can
 * seek without re-downloading the entire file. The browser sends
 * `Range: bytes=START-END`, we respond with `206 Partial Content`
 * and the requested slice.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const file = await fileRepo.findById(id);
  if (!file) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const root = await rootRepo.findById(file.archiveRootId);
  if (!root) return NextResponse.json({ message: 'Archive root not found' }, { status: 404 });

  const rangeHeader = request.headers.get('range');
  const mime = browserPlayableMime(file.mimeType);

  if (root.providerType === 'LOCAL_FILESYSTEM' && isCloudMode) {
    return NextResponse.json({ message: 'Local archives not available in cloud mode' }, { status: 501 });
  }

  if (root.providerType === 'LOCAL_FILESYSTEM') {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const fullPath = path.resolve(root.rootPath, file.path);

    try {
      const stat = await fs.stat(fullPath);
      if (stat.size === 0) {
        return NextResponse.json({ message: 'File is empty (offline stub)' }, { status: 404 });
      }

      const data = await fs.readFile(fullPath);
      return rangeAwareResponse(Buffer.from(data), mime, rangeHeader);
    } catch {
      return NextResponse.json({ message: 'File not found on disk' }, { status: 404 });
    }
  }

  if (root.providerType === 'DROPBOX') {
    // Check Harbor offline cache first
    try {
      const cacheDir = await getSetting('preview.cacheDir');
      const path = await import('node:path');
      const cachePath = path.join(cacheDir, 'offline', id);
      const fsCached = await import('node:fs/promises');
      const stat = await fsCached.stat(cachePath);
      if (stat.size > 0) {
        const data = await fsCached.readFile(cachePath);
        return rangeAwareResponse(Buffer.from(data), mime, rangeHeader);
      }
    } catch { /* not cached, fall through to Dropbox API */ }

    try {
      const token = await db.providerToken.findFirst({
        where: { providerType: 'DROPBOX', userId: auth.userId },
        orderBy: { updatedAt: 'desc' },
      });
      if (!token) return NextResponse.json({ message: 'Dropbox not connected' }, { status: 401 });

      const appKey = await getSecret('dropbox.appKey') ?? '';
      const appSecret = await getSecret('dropbox.appSecret') ?? '';
      const tokenMeta = (token.metadata as Record<string, unknown>) ?? {};
      const pathRoot = (tokenMeta.rootNamespaceId as string) ?? undefined;

      const provider = new DropboxProvider('stream', 'Stream', {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? undefined,
        appKey, appSecret, pathRoot,
      });

      const dropboxPath = toProviderPath(file.path, { providerType: root.providerType, rootPath: root.rootPath });
      const data = await provider.readFile(dropboxPath);
      return rangeAwareResponse(Buffer.from(data), mime, rangeHeader);
    } catch {
      return NextResponse.json({ message: 'Failed to stream from Dropbox' }, { status: 502 });
    }
  }

  return NextResponse.json({ message: 'Provider not supported' }, { status: 501 });
}
