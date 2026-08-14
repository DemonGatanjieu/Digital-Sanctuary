import { net, protocol, type Session } from "electron";
import { pathToFileURL } from "node:url";
import type { FontService } from "./font-service.js";

/**
 * Registers the 'sanctuary-font' custom protocol handler on the given Electron session.
 * Enforces strict host/path structure: sanctuary-font://custom/<fontId>
 */
export function registerFontProtocol(targetSession: Session, fontService: FontService): void {
  targetSession.protocol.handle("sanctuary-font", async (request) => {
    try {
      const parsedUrl = new URL(request.url);

      // Verify host is 'custom'
      if (parsedUrl.host !== "custom") {
        return new Response("Invalid font source", {
          status: 400,
          headers: { "Content-Type": "text/plain" }
        });
      }

      // Extract fontId from pathname (e.g. /custom_123456 -> custom_123456)
      const fontId = parsedUrl.pathname.replace(/^\/+/, "").trim();
      if (!fontId || !/^[a-zA-Z0-9_-]{1,64}$/.test(fontId)) {
        return new Response("Invalid font ID format", {
          status: 400,
          headers: { "Content-Type": "text/plain" }
        });
      }

      const resolvedPath = fontService.resolveFontPath(fontId);
      if (!resolvedPath) {
        return new Response("Font not found", {
          status: 404,
          headers: { "Content-Type": "text/plain" }
        });
      }

      const fileUrl = pathToFileURL(resolvedPath).toString();
      const response = await net.fetch(fileUrl);
      const mimeType = resolvedPath.endsWith(".otf") ? "font/otf" : "font/ttf";

      const headers = new Headers(response.headers);
      headers.set("Content-Type", mimeType);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Cache-Control", "public, max-age=31536000, immutable");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (err) {
      return new Response("Internal font protocol error", {
        status: 500,
        headers: { "Content-Type": "text/plain" }
      });
    }
  });
}
