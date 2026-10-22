import { describe, expect, it } from 'vitest';
import { pngHeader } from '../test/fixtures';
import { readImageInfo } from './image';

/** A JPEG start: SOI, an APP0 segment to skip, then a baseline frame header. */
function jpegHeader(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0, 16, ...new Array<number>(14).fill(0)];
  const sof = [0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...new Array<number>(9).fill(0)]);
}

describe('readImageInfo', () => {
  it('reads a PNG', () => {
    expect(readImageInfo(pngHeader(3000, 2100))).toEqual({
      type: 'png',
      width: 3000,
      height: 2100,
    });
  });

  it('reads a JPEG past its other segments', () => {
    expect(readImageInfo(jpegHeader(1600, 1200))).toEqual({
      type: 'jpeg',
      width: 1600,
      height: 1200,
    });
  });

  it('rejects anything else, whatever it claims to be', () => {
    expect(readImageInfo(new TextEncoder().encode('%PDF-1.7 not an image'))).toBeUndefined();
    expect(readImageInfo(pngHeader(0, 10))).toBeUndefined();
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0x00]))).toBeUndefined();
  });
});
