/** What an uploaded file really is, read from its header rather than trusting its name. */
export type ImageInfo = { type: 'png' | 'jpeg'; width: number; height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG's or JPEG's type and pixel size; undefined for anything else, or a broken header. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return valid({ type: 'png', width: view.getUint32(16), height: view.getUint32(20) });
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk the segments to the frame header (SOF0–SOF15, except DHT, JPG and DAC).
    let at = 2;
    while (at + 9 <= bytes.length) {
      if (bytes[at] !== 0xff) return undefined;
      const marker = bytes[at + 1]!;
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) {
        const [height, width] = [view.getUint16(at + 5), view.getUint16(at + 7)];
        return valid({ type: 'jpeg', width, height });
      }
      at += 2 + view.getUint16(at + 2);
    }
  }
  return undefined;
}

function valid(info: ImageInfo): ImageInfo | undefined {
  return info.width > 0 && info.height > 0 ? info : undefined;
}
