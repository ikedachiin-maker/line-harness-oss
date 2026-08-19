import { describe, it, expect } from 'vitest';
import { detectImageMeta, validateRichMenuImage } from './image-validator.js';

// PNG (2500x1686) header — first 33 bytes are enough to read IHDR.
const PNG_2500x1686_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, // IHDR length = 13
  0x49, 0x48, 0x44, 0x52, // 'IHDR'
  0x00, 0x00, 0x09, 0xc4, // width  = 2500 (0x000009c4)
  0x00, 0x00, 0x06, 0x96, // height = 1686 (0x00000696)
  0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
  0x00, 0x00, 0x00, 0x00, // CRC placeholder
]);

const PNG_2500x843_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x09, 0xc4, // 2500
  0x00, 0x00, 0x03, 0x4b, // 843
  0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

// Minimal JPEG with SOF0 marker carrying width=2500, height=1686.
function buildJpeg2500x1686(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    0x00, 0x11, // segment length
    0x08,       // sample precision
    0x06, 0x96, // height = 1686
    0x09, 0xc4, // width  = 2500
    0x03,       // components
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
}

describe('detectImageMeta', () => {
  it('PNG IHDR から 2500x1686 を読む', () => {
    const meta = detectImageMeta(PNG_2500x1686_HEADER);
    expect(meta).toEqual({ format: 'png', width: 2500, height: 1686 });
  });

  it('PNG IHDR から 2500x843 を読む', () => {
    const meta = detectImageMeta(PNG_2500x843_HEADER);
    expect(meta).toEqual({ format: 'png', width: 2500, height: 843 });
  });

  it('JPEG SOF0 から 2500x1686 を読む', () => {
    const meta = detectImageMeta(buildJpeg2500x1686());
    expect(meta).toEqual({ format: 'jpeg', width: 2500, height: 1686 });
  });

  it('未知のフォーマットは null', () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(detectImageMeta(garbage)).toBeNull();
  });

  it('短すぎるバイト列は null', () => {
    expect(detectImageMeta(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe('validateRichMenuImage', () => {
  it('Large (2500x1686) PNG は OK', () => {
    const result = validateRichMenuImage(PNG_2500x1686_HEADER, 100 * 1024);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.size).toBe('large');
      expect(result.format).toBe('png');
    }
  });

  it('Compact (2500x843) PNG は OK', () => {
    const result = validateRichMenuImage(PNG_2500x843_HEADER, 100 * 1024);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.size).toBe('compact');
  });

  it('Large JPEG も OK', () => {
    const result = validateRichMenuImage(buildJpeg2500x1686(), 50 * 1024);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.size).toBe('large');
      expect(result.format).toBe('jpeg');
    }
  });

  it('1MB 超は拒否', () => {
    const result = validateRichMenuImage(PNG_2500x1686_HEADER, 2 * 1024 * 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/file size/i);
  });

  it('規定外のサイズは拒否', () => {
    // 256x256 PNG
    const odd = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x01, 0x00, // 256
      0x00, 0x00, 0x01, 0x00, // 256
      0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const result = validateRichMenuImage(odd, 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/dimensions/i);
  });

  it('未知のフォーマットは拒否', () => {
    const result = validateRichMenuImage(new Uint8Array([0x00, 0x01, 0x02, 0x03]), 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/format/i);
  });
});
