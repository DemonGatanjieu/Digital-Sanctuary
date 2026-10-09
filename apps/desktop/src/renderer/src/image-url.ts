/** Local files reach the renderer only through the restricted sanctuary-image protocol. */
export function localImageUrl(path: string): string {
  return `sanctuary-image://local/${encodeURIComponent(path)}`;
}
