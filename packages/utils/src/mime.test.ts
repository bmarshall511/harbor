import { describe, it, expect } from 'vitest';
import { getFileExtension, guessMimeType, isImageMime, isVideoMime, isAudioMime, isPdfMime, isTextMime, getMimeCategory } from './mime';

describe('getFileExtension', () => {
  it('returns lowercase extension', () => {
    expect(getFileExtension('photo.JPG')).toBe('.jpg');
    expect(getFileExtension('document.PDF')).toBe('.pdf');
    expect(getFileExtension('video.mp4')).toBe('.mp4');
  });

  it('returns empty string for no extension', () => {
    expect(getFileExtension('README')).toBe('');
    expect(getFileExtension('.hidden')).toBe('');
  });

  it('handles multiple dots', () => {
    expect(getFileExtension('archive.tar.gz')).toBe('.gz');
  });
});

describe('guessMimeType', () => {
  it('returns correct mime for common image types', () => {
    expect(guessMimeType('photo.jpg')).toBe('image/jpeg');
    expect(guessMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(guessMimeType('photo.png')).toBe('image/png');
    expect(guessMimeType('photo.gif')).toBe('image/gif');
    expect(guessMimeType('photo.webp')).toBe('image/webp');
  });

  it('returns correct mime for video types', () => {
    expect(guessMimeType('video.mp4')).toBe('video/mp4');
    expect(guessMimeType('video.mov')).toBe('video/quicktime');
    expect(guessMimeType('video.mkv')).toBe('video/x-matroska');
  });

  it('returns correct mime for audio types', () => {
    expect(guessMimeType('song.mp3')).toBe('audio/mpeg');
    expect(guessMimeType('song.flac')).toBe('audio/flac');
  });

  it('returns correct mime for documents', () => {
    expect(guessMimeType('doc.pdf')).toBe('application/pdf');
    expect(guessMimeType('doc.txt')).toBe('text/plain');
    expect(guessMimeType('data.json')).toBe('application/json');
  });

  it('returns null for unknown extensions', () => {
    expect(guessMimeType('file.xyz')).toBeNull();
    expect(guessMimeType('README')).toBeNull();
  });
});

describe('mime category helpers', () => {
  it('isImageMime', () => {
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('video/mp4')).toBe(false);
    expect(isImageMime(null)).toBe(false);
  });

  it('isVideoMime', () => {
    expect(isVideoMime('video/mp4')).toBe(true);
    expect(isVideoMime('image/png')).toBe(false);
  });

  it('isAudioMime', () => {
    expect(isAudioMime('audio/mpeg')).toBe(true);
    expect(isAudioMime('video/mp4')).toBe(false);
  });

  it('isPdfMime', () => {
    expect(isPdfMime('application/pdf')).toBe(true);
    expect(isPdfMime('text/plain')).toBe(false);
  });

  it('isTextMime', () => {
    expect(isTextMime('text/plain')).toBe(true);
    expect(isTextMime('text/markdown')).toBe(true);
    expect(isTextMime('application/json')).toBe(true);
    expect(isTextMime('application/pdf')).toBe(false);
  });
});

describe('getMimeCategory', () => {
  it('categorizes correctly', () => {
    expect(getMimeCategory('image/jpeg')).toBe('image');
    expect(getMimeCategory('video/mp4')).toBe('video');
    expect(getMimeCategory('audio/mpeg')).toBe('audio');
    expect(getMimeCategory('application/pdf')).toBe('pdf');
    expect(getMimeCategory('text/plain')).toBe('text');
    expect(getMimeCategory('application/zip')).toBe('archive');
    expect(getMimeCategory('application/octet-stream')).toBe('other');
    expect(getMimeCategory(null)).toBe('other');
  });
});
