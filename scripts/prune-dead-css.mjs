// Removes CSS selectors whose class names no longer appear anywhere in the renderer source.
// Usage: node scripts/prune-dead-css.mjs            (report only)
//        node scripts/prune-dead-css.mjs --write    (rewrite the stylesheet modules)
// A class counts as used when it appears as a token in any string or template literal in
// renderer .ts/.tsx files (tests excluded), including quoted strings inside `${...}`, or matches a
// dynamic prefix such as `status-${x}`.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const write = process.argv.includes("--write");
const rendererRoot = resolve("apps/desktop/src/renderer/src");
const stylesRoot = join(rendererRoot, "styles");

// ---- Collect used class tokens and dynamic prefixes from source -------------------------
const tokens = new Set();
const prefixes = new Set();
for (const file of walk(rendererRoot)) {
  if (!/\.(tsx?|mjs)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  for (const literal of stringLiterals(source)) {
    for (const part of literal.split(/\$\{[^}]*\}/)) for (const token of part.split(/[^\w-]+/)) if (token) tokens.add(token);
    // `foo-${x}` keeps every class starting with "foo-" alive.
    for (const match of literal.matchAll(/([\w-]+-)\$\{/g)) prefixes.add(match[1]);
  }
}
const used = (name) => tokens.has(name) || [...prefixes].some((prefix) => name.startsWith(prefix));

// ---- Prune each stylesheet --------------------------------------------------------------
const manifest = readFileSync(join(rendererRoot, "styles.css"), "utf8");
const legacy = [...manifest.matchAll(/@import "\.\/styles\/([^"]+)" layer\(legacy\);/g)].map((m) => m[1]);
let totalBefore = 0, totalAfter = 0;
const report = [];
for (const name of legacy) {
  const path = join(stylesRoot, name);
  const css = readFileSync(path, "utf8");
  const removed = [];
  const pruned = pruneBlock(css, removed).replace(/\n{3,}/g, "\n\n");
  const before = css.split("\n").length, after = pruned.trim() ? pruned.split("\n").length : 0;
  totalBefore += before; totalAfter += after;
  if (removed.length) report.push({ file: name, before, after, removedSelectors: removed.length });
  if (write && pruned !== css) writeFileSync(path, pruned.trim() ? pruned.trimEnd() + "\n" : "");
}
console.table(report);
console.log(`legacy lines: ${totalBefore} -> ${totalAfter}${write ? " (written)" : " (dry run)"}`);

// ---- CSS walker: keeps comments/at-rule preludes, filters selector lists ----------------
function pruneBlock(css, removed) {
  let out = "", i = 0;
  while (i < css.length) {
    const start = i;
    // Copy whitespace and comments verbatim.
    if (/\s/.test(css[i])) { out += css[i++]; continue; }
    if (css.startsWith("/*", i)) { const end = css.indexOf("*/", i + 2); i = end < 0 ? css.length : end + 2; out += css.slice(start, i); continue; }
    const brace = findTopLevel(css, i, "{"), semi = findTopLevel(css, i, ";");
    if (semi >= 0 && (brace < 0 || semi < brace)) { i = semi + 1; out += css.slice(start, i); continue; } // e.g. @charset
    if (brace < 0) { out += css.slice(i); break; }
    const prelude = css.slice(i, brace);
    const close = matchingBrace(css, brace);
    const body = css.slice(brace + 1, close);
    i = close + 1;
    const trimmed = prelude.trim();
    if (trimmed.startsWith("@")) {
      if (/^@(media|supports|layer|container|document)\b/.test(trimmed)) {
        const inner = pruneBlock(body, removed);
        if (inner.replace(/\/\*[\s\S]*?\*\//g, "").trim()) out += `${prelude}{${inner}}`;
      } else out += css.slice(start, i); // @keyframes, @font-face, @property: keep
      continue;
    }
    const selectors = splitSelectors(prelude);
    const alive = selectors.filter((selector) => {
      const classes = [...selector.replace(/\[[^\]]*\]/g, "").replace(/:not\([^)]*\)|:has\([^)]*\)/g, "").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
      const ok = classes.every(used);
      if (!ok) removed.push(selector.trim());
      return ok;
    });
    if (alive.length === selectors.length) out += css.slice(start, i);
    else if (alive.length) out += `${alive.map((s) => s.trim()).join(",\n")} {${body}}`;
  }
  return out;
}
function findTopLevel(css, from, char) {
  let depth = 0, quote = "";
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (css.startsWith("/*", i)) { i = css.indexOf("*/", i + 2) + 1; if (i <= 0) return -1; continue; }
    if (c === "(") depth++; else if (c === ")") depth--;
    else if (c === char && depth === 0) return i;
    else if (c === "}" ) return -1;
  }
  return -1;
}
function matchingBrace(css, open) {
  let depth = 0, quote = "";
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (css.startsWith("/*", i)) { i = css.indexOf("*/", i + 2) + 1; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error(`Unbalanced braces near offset ${open}`);
}
function splitSelectors(prelude) {
  const parts = []; let depth = 0, current = "";
  for (const c of prelude.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (c === "(" || c === "[") depth++; else if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) { parts.push(current); current = ""; } else current += c;
  }
  parts.push(current);
  return parts.filter((part) => part.trim());
}
function* stringLiterals(source) {
  for (const match of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    const literal = match[1] ?? match[2] ?? match[3] ?? "";
    yield literal;
    // Quoted classes inside a template expression, e.g. `explore-surface ${open ? "with-drawer" : ""}`.
    if (match[3] !== undefined) for (const expression of literal.matchAll(/\$\{([^}]*)\}/g)) yield* stringLiterals(expression[1]);
  }
}
function* walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* walk(path); else yield path;
  }
}
