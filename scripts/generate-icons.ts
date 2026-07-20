/**
 * Generates PWA icons: public/icon-192.png and public/icon-512.png
 * Solid purple (#8b5cf6) squares with "VC" text in white.
 *
 * Pure TypeScript — no image libraries needed. Produces valid PNGs via zlib deflate.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const PURPLE: [number, number, number] = [0x8b, 0x5c, 0xf6]; // #8b5cf6
const WHITE: [number, number, number] = [0xff, 0xff, 0xff];

// ─── CRC-32 ──────────────────────────────────────────────────────

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, "ascii");
  const crcVal = crc32(Buffer.concat([typeB, data]));
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

// ─── Bitmap font for "VC" ───────────────────────────────────────
// Each letter is 20w × 25h, defined as a boolean grid (true = white pixel)

const V_GLYPH: boolean[][] = [
  // 0         1
  // 01234567890123456789
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 0
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 1
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1], // 2
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1], // 3
  [0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0], // 4
  [0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0], // 5
  [0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0], // 6
  [0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0], // 7
  [0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0], // 8
  [0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0], // 9
  [0,0,0,0,1,1,0,0,0,0,0,0,0,0,1,1,0,0,0,0], // 10
  [0,0,0,0,1,1,0,0,0,0,0,0,0,0,1,1,0,0,0,0], // 11
  [0,0,0,0,0,1,1,0,0,0,0,0,0,1,1,0,0,0,0,0], // 12
  [0,0,0,0,0,1,1,0,0,0,0,0,0,1,1,0,0,0,0,0], // 13
  [0,0,0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0,0,0], // 14
  [0,0,0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0,0,0], // 15
  [0,0,0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0,0,0], // 16
  [0,0,0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0,0,0], // 17
  [0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0], // 18
  [0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0], // 19
  [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0], // 20
  [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0], // 21
  [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0], // 22
  [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0], // 23
  [0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0], // 24
];

const C_GLYPH: boolean[][] = [
  [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0], // 0
  [0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0], // 1
  [0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0], // 2
  [0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0], // 3
  [0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 4
  [0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 5
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 6
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 7
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 8
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 9
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 10
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 11
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 12
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 13
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 14
  [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 15
  [0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 16
  [0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 17
  [0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0], // 18
  [0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0], // 19
  [0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0], // 20
  [0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0], // 21
  [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0], // 22
  [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0], // 23
  [0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0], // 24
];

// ─── PNG generation ─────────────────────────────────────────────

function generateIcon(size: number): Buffer {
  const glyphW = 20;
  const glyphH = 25;
  const gap = Math.floor(size * 0.04); // gap between V and C
  const totalGlyphW = glyphW * 2 + (gap / size) * size; // in glyph-space
  // Scale glyphs to fit ~60% of the icon width
  const scale = Math.floor((size * 0.58) / totalGlyphW);
  const scaledGlyphW = glyphW * scale;
  const scaledGlyphH = glyphH * scale;
  const scaledGap = Math.floor(gap);

  const totalW = scaledGlyphW * 2 + scaledGap;
  const offsetX = Math.floor((size - totalW) / 2);
  const offsetY = Math.floor((size - scaledGlyphH) / 2);

  // Build pixel data: rows of (filter_byte + RGB * width)
  const rowSize = 1 + size * 3;
  const rawData = Buffer.alloc(size * rowSize);

  for (let y = 0; y < size; y++) {
    const rowOff = y * rowSize;
    rawData[rowOff] = 0; // filter: None

    for (let x = 0; x < size; x++) {
      const color = getPixel(x, y);
      const pxOff = rowOff + 1 + x * 3;
      rawData[pxOff] = color[0];
      rawData[pxOff + 1] = color[1];
      rawData[pxOff + 2] = color[2];
    }
  }

  function getPixel(x: number, y: number): [number, number, number] {
    // V glyph
    if (x >= offsetX && x < offsetX + scaledGlyphW &&
        y >= offsetY && y < offsetY + scaledGlyphH) {
      const gx = Math.floor((x - offsetX) / scale);
      const gy = Math.floor((y - offsetY) / scale);
      if (gy >= 0 && gy < glyphH && gx >= 0 && gx < glyphW && V_GLYPH[gy][gx]) {
        return WHITE;
      }
    }
    // C glyph
    const cxStart = offsetX + scaledGlyphW + scaledGap;
    if (x >= cxStart && x < cxStart + scaledGlyphW &&
        y >= offsetY && y < offsetY + scaledGlyphH) {
      const gx = Math.floor((x - cxStart) / scale);
      const gy = Math.floor((y - offsetY) / scale);
      if (gy >= 0 && gy < glyphH && gx >= 0 && gx < glyphW && C_GLYPH[gy][gx]) {
        return WHITE;
      }
    }
    return PURPLE;
  }

  const compressed = deflateSync(rawData);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdr = createChunk("IHDR", ihdrData);
  const idat = createChunk("IDAT", compressed);
  const iend = createChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// ─── Main ───────────────────────────────────────────────────────

const publicDir = join(import.meta.dirname, "..", "public");

const icon192 = generateIcon(192);
writeFileSync(join(publicDir, "icon-192.png"), icon192);
console.log(`✅ Wrote icon-192.png (${icon192.length} bytes)`);

const icon512 = generateIcon(512);
writeFileSync(join(publicDir, "icon-512.png"), icon512);
console.log(`✅ Wrote icon-512.png (${icon512.length} bytes)`);
