export type PhotoMountStyle = "corners" | "washi-tape" | "gallery-float" | "polaroid";

export type PhotobookKeyboardAction = "none" | "toggle-toc" | "next" | "previous" | "home";

const PHOTO_MOUNT_STYLES: readonly PhotoMountStyle[] = [
  "corners",
  "washi-tape",
  "gallery-float",
  "polaroid"
];

export function normalizePhotoMountStyle(value: string | null): PhotoMountStyle {
  return PHOTO_MOUNT_STYLES.includes(value as PhotoMountStyle)
    ? (value as PhotoMountStyle)
    : "corners";
}

export function getPhotobookTotalSpreads(itemCount: number): number {
  return itemCount <= 1 ? 1 : 1 + Math.ceil((itemCount - 1) / 2);
}

export function getPhotobookSpreadForArtworkIndex(artworkIndex: number): number {
  return artworkIndex <= 0 ? 0 : 1 + Math.floor((artworkIndex - 1) / 2);
}

export function getPhotobookArtworkIndex(
  spreadIndex: number,
  side: "left" | "right",
  itemCount: number
): number | null {
  if (spreadIndex === 0) {
    return side === "right" && itemCount > 0 ? 0 : null;
  }

  const artworkIndex = (spreadIndex - 1) * 2 + (side === "left" ? 1 : 2);
  return artworkIndex < itemCount ? artworkIndex : null;
}

export function resolvePhotobookKeyboardAction({
  key,
  code,
  targetIsEditable,
  interactionSuspended,
  tocOpen
}: {
  key: string;
  code: string;
  targetIsEditable: boolean;
  interactionSuspended: boolean;
  tocOpen: boolean;
}): PhotobookKeyboardAction {
  if (interactionSuspended || targetIsEditable) return "none";
  if (code === "KeyT" || code === "KeyM") return "toggle-toc";
  if (tocOpen) return "none";
  if (key === "ArrowRight" || code === "KeyD" || key === " ") return "next";
  if (key === "ArrowLeft" || code === "KeyA") return "previous";
  if (key === "Home") return "home";
  return "none";
}
