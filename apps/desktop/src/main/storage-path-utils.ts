import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join, parse, resolve } from "node:path";

const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
]);

/**
 * Sanitizes a string to be safely used as a Windows/cross-platform folder name.
 * Strips illegal characters: < > : " / \ | ? * and control characters 0x00-0x1F.
 * Strips trailing/leading spaces and periods.
 * Avoids reserved Windows device names.
 * Truncates overly long names.
 */
export function sanitizeFolderName(name: string | null | undefined, fallback: string): string {
  if (!name || typeof name !== "string") return fallback;

  let cleaned = name
    // Replace illegal characters (and adjacent whitespace) with underscore
    .replace(/[\s]*[<>:"/\\|?*\x00-\x1F]+[\s]*/g, "_")
    // Collapse consecutive underscores
    .replace(/_+/g, "_")
    // Remove trailing periods and spaces (prohibited in Windows folders)
    .replace(/[\s.]+$/, "")
    // Remove leading periods and spaces
    .replace(/^[\s.]+/, "")
    .trim();

  // If the string only contained underscores or became empty after stripping
  if (cleaned.length === 0 || cleaned.replace(/_/g, "").length === 0) {
    return fallback;
  }

  // Handle Windows reserved device names
  if (WINDOWS_RESERVED_NAMES.has(cleaned.toLowerCase())) {
    cleaned = `_${cleaned}`;
  }

  // Restrict to max 80 chars
  if (cleaned.length > 80) {
    cleaned = cleaned.slice(0, 80).trim().replace(/[\s.]+$/, "");
  }

  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Resolves a selected folder into the effective Pixiv gallery folder.
 * If the user selected the drive root itself (e.g. "E:\", "D:\", or "/"),
 * avoids dumping loose files on the disk root by automatically targeting
 * "[DriveRoot]\Digital Sanctuary\Pixiv".
 * If the user selected a directory named "Digital Sanctuary", targets its "Pixiv" subfolder.
 */
export function resolveTargetGalleryDirectory(chosenPath: string): string {
  const resolved = resolve(chosenPath);
  const parsed = parse(resolved);

  // If user selected the drive root directly
  if (parsed.root.toLowerCase() === resolved.toLowerCase()) {
    return join(resolved, "Digital Sanctuary", "Pixiv");
  }

  // If user selected "Digital Sanctuary", place inside "Pixiv"
  if (basename(resolved).toLowerCase() === "digital sanctuary") {
    return join(resolved, "Pixiv");
  }

  // Guardrail: if user selected the software source repository directory (contains package.json & apps)
  // NEVER dump pictures directly into the code repository; redirect to a clean Digital Sanctuary/Pixiv instead!
  if (existsSync(join(resolved, "package.json")) && existsSync(join(resolved, "apps"))) {
    return join(parsed.root || resolved, "Digital Sanctuary", "Pixiv");
  }

  return resolved;
}

/**
 * Gets the base sanctuary directory from the Pixiv directory.
 * E.g., for "E:\Digital Sanctuary\Pixiv", returns "E:\Digital Sanctuary".
 */
export function getSanctuaryBaseDirectory(pixivDirectory: string): string {
  return resolve(pixivDirectory, "..");
}

/**
 * Gets the list of all standard Digital Sanctuary directories based on the Pixiv directory.
 */
export function getStandardStorageDirectories(pixivDirectory: string): string[] {
  const resolvedPixiv = resolve(pixivDirectory);
  const base = getSanctuaryBaseDirectory(resolvedPixiv);
  return [
    resolvedPixiv,
    join(base, "avatars"),
    join(base, "Generated", "ComfyUI"),
    join(base, "Backups"),
    join(base, "Exports")
  ];
}

/**
 * Ensures all standard Digital Sanctuary directories exist on disk.
 */
export async function ensureStandardStorageDirectories(pixivDirectory: string): Promise<string[]> {
  const dirs = getStandardStorageDirectories(pixivDirectory);
  for (const dir of dirs) {
    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      console.warn(`[storage] Unable to ensure directory "${dir}":`, err);
    }
  }
  return dirs;
}

export interface ResolvedArtworkDirectoryResult {
  artworkDirectory: string;
  authorFolderName: string;
  isLegacy: boolean;
}

/**
 * Resolves the destination directory for a Pixiv artwork.
 * Prioritizes author subfolder: "Pixiv / [Artist Name] / [Artwork ID]".
 * If the artwork already exists in the legacy flat folder "Pixiv / [Artwork ID]",
 * reuses the legacy folder to maintain stability and avoid duplicating files.
 */
export function resolveArtworkDirectory(
  basePixivDirectory: string,
  authorName: string | null | undefined,
  authorId: string,
  artworkId: string,
  exists: (path: string) => boolean = existsSync
): ResolvedArtworkDirectoryResult {
  const legacyDir = join(basePixivDirectory, artworkId);
  const authorFolderName = sanitizeFolderName(authorName, `author_${authorId}`);
  const authorWorkDir = join(basePixivDirectory, authorFolderName, artworkId);

  if (exists(legacyDir)) {
    return {
      artworkDirectory: legacyDir,
      authorFolderName,
      isLegacy: true
    };
  }

  return {
    artworkDirectory: authorWorkDir,
    authorFolderName,
    isLegacy: false
  };
}
