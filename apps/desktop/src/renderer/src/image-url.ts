/** Local files reach the renderer only through the restricted sanctuary-image protocol. */
export function localImageUrl(path: string): string {
  return `sanctuary-image://local/${encodeURIComponent(path)}`;
}

/** Original image of a gallery page record (album / artist scopes). */
export function artworkImageUrl(artwork: { path: string }): string {
  return localImageUrl(artwork.path);
}
