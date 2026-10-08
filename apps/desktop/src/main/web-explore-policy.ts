import { isIP } from "node:net";

export function publicWebUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("网址过长或格式无效");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("请输入完整网址或搜索关键词"); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".") && !isIP(host) || isPrivateAddress(host)) throw new Error("这里只能打开公开的 HTTP 或 HTTPS 网站");
  return url.href;
}
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a,b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && b === 168 || a === 100 && b! >= 64 && b! <= 127 || a! >= 224;
  }
  if (isIP(address) === 6) return /^(::|fc|fd|fe[89ab])/i.test(address) || address.includes(".");
  return false;
}
export function exploreInputUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) throw new Error("先输入网址或搜索关键词");
  const text = value.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) return publicWebUrl(text);
  if (/^[\w-]+(?:\.[\w-]+)+(?:[/:?#]|$)/.test(text) && !/\s/.test(text)) return publicWebUrl(`https://${text}`);
  return `https://www.bing.com/images/search?q=${encodeURIComponent(text)}`;
}
