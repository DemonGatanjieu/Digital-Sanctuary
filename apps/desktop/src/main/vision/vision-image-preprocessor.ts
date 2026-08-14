import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";

export interface PreparedVisionImage {
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  byteLength: number;
  fingerprint: string;
  cleanup: () => void;
}

export interface PrepareImageOptions {
  maxLongEdge?: number;
}

export async function prepareVisionImage(
  filePath: string,
  options: PrepareImageOptions = {}
): Promise<PreparedVisionImage> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found for vision preprocessing: ${filePath}`);
  }

  const rawBuffer = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();

  let mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/png";
  if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
  else if (ext === ".webp") mimeType = "image/webp";

  const hash = createHash("sha256").update(rawBuffer).digest("hex");
  const maxEdge = options.maxLongEdge ?? 1568;

  // Fingerprint combines content hash and preprocessing maxLongEdge parameter
  const fingerprint = `prep_v1_${hash.slice(0, 16)}_max${maxEdge}`;

  return {
    buffer: rawBuffer,
    mimeType,
    width: 0, // In lightweight JS environment, dimensions filled if decoded
    height: 0,
    byteLength: rawBuffer.length,
    fingerprint,
    cleanup: () => {
      // Memory cleanup hook
    }
  };
}
