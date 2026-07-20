/**
 * Generate solid-color PNG icons for VibeCheck PWA.
 * Creates icon-192.png and icon-512.png in #8b5cf6 (purple).
 *
 * Uses only Node.js built-ins (zlib, Buffer) — no dependencies.
 */
import { createDeflate } from "zlib";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public");
const PURPLE = [0x8b, 0x5c, 0xf6]; // #8b5cf6

function makePNG(w, h) {
  // Build raw image data: each row = filter byte (0) + w * 3 bytes (RGB)
  const rowLen = 1 + w * 3;
  const rawData = Buffer.alloc(rowLen * h);
  for (let y = 0; y < h; y++) {
    const offset = y * rowLen;
    rawData[offset] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const px = offset + 1 + x * 3;
      rawData[px] = PURPLE[0];
      rawData[px + 1] = PURPLE[1];
      rawData[px + 2] = PURPLE[2];
    }
  }

  return new Promise((resolve, reject) => {
    const deflate = createDeflate({ level: 9 });
    const chunks = [];
    deflate.on("data", (chunk) => chunks.push(chunk));
    deflate.on("end", () => {
      const compressed = Buffer.concat(chunks);
      resolve(buildPNGFile(w, h, compressed));
    });
    deflate.on("error", reject);
    deflate.end(rawData);
  });
}

function buildPNGFile(w, h, idatData) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk("IHDR", ihdr);

  // IDAT
  const idatChunk = makeChunk("IDAT", idatData);

  // IEND
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);

  const crc = crc32(typeAndData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([len, typeAndData, crcBuf]);
}

// CRC32 implementation (PNG uses standard CRC32)
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Generate both sizes
async function main() {
  const p192 = await makePNG(192, 192);
  writeFileSync(join(outDir, "icon-192.png"), p192);
  console.log("Created icon-192.png");

  const p512 = await makePNG(512, 512);
  writeFileSync(join(outDir, "icon-512.png"), p512);
  console.log("Created icon-512.png");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
