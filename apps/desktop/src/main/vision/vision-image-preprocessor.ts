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

  const maxEdge = options.maxLongEdge ?? 1568;
  let outputBuffer: Buffer<ArrayBufferLike> = rawBuffer;
  let width = 0;
  let height = 0;

  try {
    const electronModule = await import("electron");
    const image = electronModule.nativeImage?.createFromPath(filePath);
    if (image && !image.isEmpty()) {
      const originalSize = image.getSize();
      const scale = Math.min(1, maxEdge / Math.max(originalSize.width, originalSize.height));
      const prepared = scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(originalSize.width * scale)),
            height: Math.max(1, Math.round(originalSize.height * scale)),
            quality: "best"
          })
        : image;
      const preparedSize = prepared.getSize();
      width = preparedSize.width;
      height = preparedSize.height;
      if (mimeType === "image/jpeg") {
        outputBuffer = prepared.toJPEG(88);
      } else {
        outputBuffer = prepared.toPNG();
        mimeType = "image/png";
      }
    }
  } catch {
    // Unit tests and non-Electron tools safely retain the original bytes.
  }
  if (outputBuffer.length > 24 * 1024 * 1024) {
    throw new Error("图片预处理后仍超过 24 MiB，已停止视觉评论以避免内存压力。");
  }

  const hash = createHash("sha256").update(rawBuffer).digest("hex");

  // Fingerprint combines content hash and preprocessing maxLongEdge parameter
  const fingerprint = `prep_v2_${hash.slice(0, 16)}_max${maxEdge}_${width}x${height}`;

  return {
    buffer: outputBuffer,
    mimeType,
    width,
    height,
    byteLength: outputBuffer.length,
    fingerprint,
    cleanup: () => {
      // Memory cleanup hook
    }
  };
}
