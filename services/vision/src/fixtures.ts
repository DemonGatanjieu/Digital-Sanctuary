import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = createCrcTable();

function calculateCrc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i]!;
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const bodyToCrc = Buffer.concat([typeBuffer, data]);
  const crc = calculateCrc32(bodyToCrc);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([lengthBuffer, bodyToCrc, crcBuffer]);
}

/**
 * Creates an uncompressed 24-bit RGB PNG buffer deterministically in memory.
 */
export function createRgbPng(width: number, height: number, pixelFn: (x: number, y: number) => [number, number, number]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk: 13 bytes
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth 8
  ihdrData.writeUInt8(2, 9); // color type 2 (RGB)
  ihdrData.writeUInt8(0, 10); // compression method 0
  ihdrData.writeUInt8(0, 11); // filter method 0
  ihdrData.writeUInt8(0, 12); // interlace method 0
  const ihdrChunk = createPngChunk("IHDR", ihdrData);

  // Raw image scanlines: each line starts with a filter byte (0 = None)
  const rawScanlines = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;

  for (let y = 0; y < height; y++) {
    rawScanlines.writeUInt8(0, offset++); // Filter type 0
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      rawScanlines.writeUInt8(r, offset++);
      rawScanlines.writeUInt8(g, offset++);
      rawScanlines.writeUInt8(b, offset++);
    }
  }

  const compressedData = deflateSync(rawScanlines);
  const idatChunk = createPngChunk("IDAT", compressedData);
  const iendChunk = createPngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

export function createSolidColorPng(width: number, height: number, r: number, g: number, b: number): Buffer {
  return createRgbPng(width, height, () => [r, g, b]);
}

export function createGradientLinearPng(width: number, height: number): Buffer {
  return createRgbPng(width, height, (x, y) => {
    const v = Math.round(((x / width + y / height) / 2) * 255);
    return [v, Math.round(v * 0.7), 255 - v];
  });
}

export function createCheckerboardPng(width: number, height: number, squareSize = 8): Buffer {
  return createRgbPng(width, height, (x, y) => {
    const isWhite = (Math.floor(x / squareSize) + Math.floor(y / squareSize)) % 2 === 0;
    return isWhite ? [255, 255, 255] : [0, 0, 0];
  });
}

export function createCorruptedImageBuffer(): Buffer {
  const invalid = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  // Truncated corrupted byte stream
  return Buffer.concat([invalid, Buffer.from("CORRUPTED_PAYLOAD_NOT_IMAGE")]);
}

export function createDummyGifBuffer(): Buffer {
  // Minimal valid 1x1 transparent GIF header
  return Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
    0x44, 0x01, 0x00, 0x3b
  ]);
}

export interface StandardTestFixtures {
  solidWhite: Buffer;
  solidBlack: Buffer;
  solidColor: Buffer;
  gradientLinear: Buffer;
  checkerboard: Buffer;
  corrupted: Buffer;
  animatedGif: Buffer;
}

export function generateStandardTestFixtures(): StandardTestFixtures {
  return {
    solidWhite: createSolidColorPng(64, 64, 255, 255, 255),
    solidBlack: createSolidColorPng(64, 64, 0, 0, 0),
    solidColor: createSolidColorPng(64, 64, 230, 80, 140),
    gradientLinear: createGradientLinearPng(64, 64),
    checkerboard: createCheckerboardPng(64, 64, 8),
    corrupted: createCorruptedImageBuffer(),
    animatedGif: createDummyGifBuffer()
  };
}

export interface StandardTestFixturePaths {
  solidWhite: string;
  solidBlack: string;
  solidColor: string;
  gradientLinear: string;
  checkerboard: string;
  corrupted: string;
  animatedGif: string;
}

export function writeTestFixturesToDisk(outputDirectory: string): StandardTestFixturePaths {
  mkdirSync(outputDirectory, { recursive: true });
  const fixtures = generateStandardTestFixtures();
  const filePaths: StandardTestFixturePaths = {
    solidWhite: join(outputDirectory, "solid_white.png"),
    solidBlack: join(outputDirectory, "solid_black.png"),
    solidColor: join(outputDirectory, "solid_color.png"),
    gradientLinear: join(outputDirectory, "gradient_linear.png"),
    checkerboard: join(outputDirectory, "checkerboard.png"),
    corrupted: join(outputDirectory, "corrupted.png"),
    animatedGif: join(outputDirectory, "animated_dummy.gif")
  };

  writeFileSync(filePaths.solidWhite, fixtures.solidWhite);
  writeFileSync(filePaths.solidBlack, fixtures.solidBlack);
  writeFileSync(filePaths.solidColor, fixtures.solidColor);
  writeFileSync(filePaths.gradientLinear, fixtures.gradientLinear);
  writeFileSync(filePaths.checkerboard, fixtures.checkerboard);
  writeFileSync(filePaths.corrupted, fixtures.corrupted);
  writeFileSync(filePaths.animatedGif, fixtures.animatedGif);

  return filePaths;
}

