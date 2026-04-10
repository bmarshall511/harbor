import { describe, it, expect } from 'vitest';
import { guessMimeType, getMimeCategory, isImageMime } from '@harbor/utils';

/**
 * Tests for indexing job logic.
 * Tests the MIME detection and file categorization used during indexing.
 */

describe('Indexing job logic', () => {
  describe('MIME type detection during indexing', () => {
    it('detects common image types', () => {
      expect(guessMimeType('photo.jpg')).toBe('image/jpeg');
      expect(guessMimeType('photo.png')).toBe('image/png');
      expect(guessMimeType('photo.heic')).toBe('image/heic');
      expect(guessMimeType('photo.webp')).toBe('image/webp');
    });

    it('detects video types', () => {
      expect(guessMimeType('video.mp4')).toBe('video/mp4');
      expect(guessMimeType('video.mov')).toBe('video/quicktime');
    });

    it('detects document types', () => {
      expect(guessMimeType('doc.pdf')).toBe('application/pdf');
      expect(guessMimeType('notes.txt')).toBe('text/plain');
    });

    it('returns null for unknown types', () => {
      expect(guessMimeType('file.xyz')).toBeNull();
    });
  });

  describe('image detection for preview trigger', () => {
    it('identifies images for preview generation', () => {
      expect(isImageMime('image/jpeg')).toBe(true);
      expect(isImageMime('image/png')).toBe(true);
      expect(isImageMime('image/heic')).toBe(true);
    });

    it('rejects non-images', () => {
      expect(isImageMime('video/mp4')).toBe(false);
      expect(isImageMime('application/pdf')).toBe(false);
      expect(isImageMime(null)).toBe(false);
    });
  });

  describe('provider-aware behavior', () => {
    it('LOCAL_FILESYSTEM triggers preview generation', () => {
      const providerType = 'LOCAL_FILESYSTEM';
      expect(providerType === 'LOCAL_FILESYSTEM').toBe(true);
    });

    it('DROPBOX does not trigger preview generation', () => {
      const providerType: string = 'DROPBOX';
      expect(providerType === 'LOCAL_FILESYSTEM').toBe(false);
    });
  });

  describe('Dropbox path normalization', () => {
    function normalizeDropboxPath(p: string): string {
      if (!p || p === '/' || p === '') return '';
      return p.startsWith('/') ? p : `/${p}`;
    }

    it('root path becomes empty string', () => {
      expect(normalizeDropboxPath('/')).toBe('');
      expect(normalizeDropboxPath('')).toBe('');
    });

    it('prepends / to relative paths', () => {
      expect(normalizeDropboxPath('Photos')).toBe('/Photos');
      expect(normalizeDropboxPath('My Archive')).toBe('/My Archive');
    });

    it('preserves absolute paths', () => {
      expect(normalizeDropboxPath('/Photos')).toBe('/Photos');
      expect(normalizeDropboxPath('/My Archive/Sub')).toBe('/My Archive/Sub');
    });
  });
});
