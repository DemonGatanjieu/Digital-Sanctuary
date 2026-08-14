/**
 * Manages dynamic FontFace loading and lifecycle for custom local fonts.
 */

const loadedFaces = new Map<string, FontFace>();

export function getInternalFontFamily(fontId: string): string {
  const cleanId = fontId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `ds-custom-${cleanId}`;
}

export async function loadCustomFontFace(fontId: string): Promise<string> {
  const internalFamily = getInternalFontFamily(fontId);
  const existing = loadedFaces.get(fontId);
  if (existing) {
    if (existing.status === "loaded") return internalFamily;
    if (existing.status === "loading") {
      await existing.loaded;
      return internalFamily;
    }
  }

  const fontUrl = `url(sanctuary-font://custom/${encodeURIComponent(fontId)})`;
  const face = new FontFace(internalFamily, fontUrl, {
    display: "swap"
  });

  loadedFaces.set(fontId, face);

  try {
    const loaded = await face.load();
    document.fonts.add(loaded);
    return internalFamily;
  } catch (err) {
    loadedFaces.delete(fontId);
    throw new Error(`Failed to load custom font face for ID '${fontId}': ${(err as Error).message}`);
  }
}

export function cleanupUnusedFontFaces(activeFontIds: Set<string>): void {
  for (const [fontId, face] of loadedFaces.entries()) {
    if (!activeFontIds.has(fontId)) {
      document.fonts.delete(face);
      loadedFaces.delete(fontId);
    }
  }
}
