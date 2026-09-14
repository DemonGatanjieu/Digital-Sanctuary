import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
  ensureStandardStorageDirectories,
  getSanctuaryBaseDirectory,
  getStandardStorageDirectories,
  resolveArtworkDirectory,
  resolveTargetGalleryDirectory,
  sanitizeFolderName
} from "./storage-path-utils";

describe("storage-path-utils", () => {
  describe("sanitizeFolderName", () => {
    it("preserves standard safe artist names", () => {
      expect(sanitizeFolderName("米山舞", "fallback")).toBe("米山舞");
      expect(sanitizeFolderName("Lack@お仕事募集中", "fallback")).toBe("Lack@お仕事募集中");
      expect(sanitizeFolderName("anmi (C102)", "fallback")).toBe("anmi (C102)");
    });

    it("replaces illegal Windows characters with underscores", () => {
      expect(sanitizeFolderName("Artist/Slash\\Back:Colon*Star?Question\"Quote<Less>Greater|Pipe", "fallback"))
        .toBe("Artist_Slash_Back_Colon_Star_Question_Quote_Less_Greater_Pipe");
      expect(sanitizeFolderName("Title / 2026", "fallback")).toBe("Title_2026");
    });

    it("removes control characters and collapses consecutive underscores", () => {
      expect(sanitizeFolderName("Test\x00Name\x1F_Here", "fallback")).toBe("Test_Name_Here");
    });

    it("strips leading and trailing dots and spaces", () => {
      expect(sanitizeFolderName("  Artist Name.  ", "fallback")).toBe("Artist Name");
      expect(sanitizeFolderName("...Artist...", "fallback")).toBe("Artist");
      expect(sanitizeFolderName("Artist. . .", "fallback")).toBe("Artist");
    });

    it("escapes Windows reserved device names", () => {
      expect(sanitizeFolderName("con", "fallback")).toBe("_con");
      expect(sanitizeFolderName("CON", "fallback")).toBe("_CON");
      expect(sanitizeFolderName("prn", "fallback")).toBe("_prn");
      expect(sanitizeFolderName("aux", "fallback")).toBe("_aux");
      expect(sanitizeFolderName("nul", "fallback")).toBe("_nul");
      expect(sanitizeFolderName("com1", "fallback")).toBe("_com1");
      expect(sanitizeFolderName("lpt9", "fallback")).toBe("_lpt9");
    });

    it("falls back when name is null, empty, whitespace, or exclusively illegal symbols", () => {
      expect(sanitizeFolderName(null, "author_123")).toBe("author_123");
      expect(sanitizeFolderName(undefined, "author_123")).toBe("author_123");
      expect(sanitizeFolderName("", "author_123")).toBe("author_123");
      expect(sanitizeFolderName("   ", "author_123")).toBe("author_123");
      expect(sanitizeFolderName("???", "author_123")).toBe("author_123");
      expect(sanitizeFolderName("///", "author_123")).toBe("author_123");
      expect(sanitizeFolderName("***", "author_123")).toBe("author_123");
      expect(sanitizeFolderName("<>:|", "author_123")).toBe("author_123");
    });

    it("truncates names exceeding 80 characters without leaving trailing dots or spaces", () => {
      const veryLong = "A".repeat(100);
      const sanitized = sanitizeFolderName(veryLong, "fallback");
      expect(sanitized).toHaveLength(80);
      expect(sanitized).toBe("A".repeat(80));

      const longWithDotAtCutoff = "A".repeat(79) + ". " + "B".repeat(20);
      const sanitizedDot = sanitizeFolderName(longWithDotAtCutoff, "fallback");
      expect(sanitizedDot).toBe("A".repeat(79));
    });
  });

  describe("resolveTargetGalleryDirectory", () => {
    it("structures drive root selections under Digital Sanctuary/Pixiv", () => {
      const eDrive = resolve("E:\\");
      const resolved = resolveTargetGalleryDirectory(eDrive);
      expect(resolved).toBe(join(eDrive, "Digital Sanctuary", "Pixiv"));
    });

    it("nests Pixiv when Digital Sanctuary directory is selected", () => {
      const sanctuaryDir = resolve("E:\\MyStorage\\Digital Sanctuary");
      expect(resolveTargetGalleryDirectory(sanctuaryDir)).toBe(
        join(sanctuaryDir, "Pixiv")
      );
    });

    it("keeps existing Pixiv directory or custom folder directly", () => {
      const pixivDir = resolve("E:\\MyStorage\\Digital Sanctuary\\Pixiv");
      expect(resolveTargetGalleryDirectory(pixivDir)).toBe(pixivDir);

      const customDir = resolve("D:\\ArtGallery");
      expect(resolveTargetGalleryDirectory(customDir)).toBe(customDir);
    });

    it("redirects project codebase directory to Digital Sanctuary/Pixiv to prevent polluting source tree", () => {
      const projectRoot = resolve(".");
      const redirected = resolveTargetGalleryDirectory(projectRoot);
      expect(redirected).toBe(join(resolve("/"), "Digital Sanctuary", "Pixiv"));
    });
  });

  describe("getStandardStorageDirectories", () => {
    it("generates the complete hierarchy: Pixiv, avatars, Generated/ComfyUI, Backups, Exports", () => {
      const pixivDir = resolve("E:\\Digital Sanctuary\\Pixiv");
      const base = resolve("E:\\Digital Sanctuary");
      const dirs = getStandardStorageDirectories(pixivDir);

      expect(getSanctuaryBaseDirectory(pixivDir)).toBe(base);
      expect(dirs).toEqual([
        pixivDir,
        join(base, "avatars"),
        join(base, "Generated", "ComfyUI"),
        join(base, "Backups"),
        join(base, "Exports")
      ]);
    });
  });

  describe("resolveArtworkDirectory", () => {
    const baseDir = resolve("E:\\Digital Sanctuary\\Pixiv");

    it("resolves to author subfolder when legacy flat folder does not exist", () => {
      const result = resolveArtworkDirectory(
        baseDir,
        "米山舞",
        "12345",
        "987654",
        () => false
      );

      expect(result.isLegacy).toBe(false);
      expect(result.authorFolderName).toBe("米山舞");
      expect(result.artworkDirectory).toBe(join(baseDir, "米山舞", "987654"));
    });

    it("falls back to author_{id} for blank or symbol-only names", () => {
      const result = resolveArtworkDirectory(
        baseDir,
        "???",
        "12345",
        "987654",
        () => false
      );

      expect(result.authorFolderName).toBe("author_12345");
      expect(result.artworkDirectory).toBe(join(baseDir, "author_12345", "987654"));
    });

    it("preserves legacy flat folder if it already exists on disk", () => {
      const legacyPath = join(baseDir, "987654");
      const result = resolveArtworkDirectory(
        baseDir,
        "米山舞",
        "12345",
        "987654",
        (p) => p === legacyPath
      );

      expect(result.isLegacy).toBe(true);
      expect(result.artworkDirectory).toBe(legacyPath);
    });
  });
});
