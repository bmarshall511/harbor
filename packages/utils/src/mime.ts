const EXTENSION_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.ico': 'image/x-icon',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.3gp': 'video/3gpp',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wma': 'audio/x-ms-wma',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
};

export function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === 0) return '';
  return filename.slice(dotIndex).toLowerCase();
}

export function guessMimeType(filename: string): string | null {
  const ext = getFileExtension(filename);
  return EXTENSION_MAP[ext] ?? null;
}

export function isImageMime(mime: string | null): boolean {
  return mime?.startsWith('image/') ?? false;
}

export function isVideoMime(mime: string | null): boolean {
  return mime?.startsWith('video/') ?? false;
}

export function isAudioMime(mime: string | null): boolean {
  return mime?.startsWith('audio/') ?? false;
}

export function isPdfMime(mime: string | null): boolean {
  return mime === 'application/pdf';
}

export function isTextMime(mime: string | null): boolean {
  if (!mime) return false;
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml'
  );
}

export type MimeCategory = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'document' | 'archive' | 'other';

export function getMimeCategory(mime: string | null): MimeCategory {
  if (!mime) return 'other';
  if (isImageMime(mime)) return 'image';
  if (isVideoMime(mime)) return 'video';
  if (isAudioMime(mime)) return 'audio';
  if (isPdfMime(mime)) return 'pdf';
  if (isTextMime(mime)) return 'text';
  if (mime.includes('document') || mime.includes('sheet') || mime.includes('presentation')) return 'document';
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar') || mime.includes('7z') || mime.includes('gzip')) return 'archive';
  return 'other';
}
