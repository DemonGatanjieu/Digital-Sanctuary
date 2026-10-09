import { deflateRawSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractTrustedZip } from "./secure-zip.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("extractTrustedZip", () => {
  it("extracts stored and deflated files inside the destination", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-zip-"));
    roots.push(root);
    const archive = join(root, "runtime.zip");
    await writeFile(archive, makeZip([
      { name: "llama-server.exe", content: Buffer.from("server"), method: 0 },
      { name: "runtime/ggml.dll", content: Buffer.from("library"), method: 8 }
    ]));

    const output = join(root, "output");
    await extractTrustedZip(archive, output);
    await expect(readFile(join(output, "llama-server.exe"), "utf8")).resolves.toBe("server");
    await expect(readFile(join(output, "runtime", "ggml.dll"), "utf8")).resolves.toBe("library");
  });

  it("handles frozen runtimes with thousands of files, including empty ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-zip-many-"));
    roots.push(root);
    const archive = join(root, "runtime.zip");
    const files = Array.from({ length: 1200 }, (_, index) => ({ name: `rt/_internal/m${index}.py`, content: Buffer.from(`# ${index}`), method: 8 as const }));
    await writeFile(archive, makeZip([...files, { name: "rt/_internal/__init__.py", content: Buffer.alloc(0), method: 8 }]));
    const extracted = await extractTrustedZip(archive, join(root, "output"));
    expect(extracted).toHaveLength(1201);
    await expect(readFile(join(root, "output", "rt", "_internal", "m1199.py"), "utf8")).resolves.toBe("# 1199");
    await expect(readFile(join(root, "output", "rt", "_internal", "__init__.py"), "utf8")).resolves.toBe("");
  });

  it("rejects entries that point past the end of the archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-zip-truncated-"));
    roots.push(root);
    const archive = join(root, "runtime.zip");
    const zip = makeZip([{ name: "a.dll", content: Buffer.from("library"), method: 0 }]);
    zip.writeUInt32LE(4096, zip.length - 22 - 46 - 5 + 20);
    await writeFile(archive, zip);
    await expect(extractTrustedZip(archive, join(root, "output"))).rejects.toThrow("越界");
  });

  it("rejects archive traversal paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-zip-traversal-"));
    roots.push(root);
    const archive = join(root, "runtime.zip");
    await writeFile(archive, makeZip([{ name: "../escape.dll", content: Buffer.from("bad"), method: 0 }]));
    await expect(extractTrustedZip(archive, join(root, "output"))).rejects.toThrow("越出安装目录");
  });
});

function makeZip(files: { name: string; content: Buffer; method: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = file.method === 8 ? deflateRawSync(file.content) : file.content;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(file.method, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(file.method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }
  const localData = Buffer.concat(locals);
  const centralData = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, end]);
}
