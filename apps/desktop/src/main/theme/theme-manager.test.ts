import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeManagerService } from "./theme-manager.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ThemeManagerService", () => {
  it("discovers valid themes, ignores damaged packages, and falls back to default", async () => {
    const fixture = await createFixture();
    await writeTheme(join(fixture.bundled, "default"), manifest("default", "Default", "light"), "");
    await writeTheme(join(fixture.users, "author.night"), manifest("author.night", "Night", "dark"), ":root { --ds-primary: #111827; }");
    await mkdir(join(fixture.users, "broken"), { recursive: true });
    await writeFile(join(fixture.users, "broken", "theme.json"), "{");
    fixture.setActive("missing.theme");

    const themes = await fixture.manager.getInstalledThemes();
    expect(themes.map((theme) => theme.id)).toEqual(["default", "author.night"]);
    expect(themes.find((theme) => theme.id === "default")?.isActive).toBe(true);
    expect(fixture.getActive()).toBe("default");
  });

  it("installs atomically from a folder, activates CSS, and deletes with fallback", async () => {
    const fixture = await createFixture();
    await writeTheme(join(fixture.bundled, "default"), manifest("default", "Default", "light"), "");
    const source = join(fixture.root, "incoming");
    await writeTheme(source, manifest("artist.candy", "Candy", "light"), ":root { --ds-primary: #fb7185; }");

    const installed = await fixture.manager.installThemeFromFolder(source);
    expect(installed.id).toBe("artist.candy");
    expect(await readFile(join(fixture.users, "artist.candy", "theme.css"), "utf8")).toContain("#fb7185");
    expect((await fixture.manager.setActiveTheme("artist.candy")).cssContent).toContain("--ds-primary");
    expect(fixture.getActive()).toBe("artist.candy");
    expect(await fixture.manager.deleteTheme("artist.candy")).toBe(true);
    expect(fixture.getActive()).toBe("default");
    expect(await fixture.manager.deleteTheme("default")).toBe(false);
  });

  it("installs a bounded ZIP and rejects traversal entries", async () => {
    const fixture = await createFixture();
    await writeTheme(join(fixture.bundled, "default"), manifest("default", "Default", "light"), "");
    const zip = createStoredZip({
      "wrapper/theme.json": Buffer.from(JSON.stringify(manifest("artist.zip", "Zip Theme", "dark"))),
      "wrapper/theme.css": Buffer.from(":root { --ds-primary: #22d3ee; }"),
    });
    expect((await fixture.manager.installThemeFromZip(zip)).id).toBe("artist.zip");
    const malicious = createStoredZip({
      "theme.json": Buffer.from(JSON.stringify(manifest("artist.bad", "Bad", "dark"))),
      "../theme.css": Buffer.from("body {}"),
    });
    await expect(fixture.manager.installThemeFromZip(malicious)).rejects.toThrow("unsafe path");
  });

  it("rejects installed CSS that can make external requests", async () => {
    const fixture = await createFixture();
    await writeTheme(join(fixture.bundled, "default"), manifest("default", "Default", "light"), "");
    const source = join(fixture.root, "incoming-bad");
    await writeTheme(source, manifest("artist.tracker", "Tracker", "dark"), ".x { background: url(https://tracker.invalid/pixel); }");
    await expect(fixture.manager.installThemeFromFolder(source)).rejects.toThrow("external resources");
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "sanctuary-theme-manager-"));
  temporaryRoots.push(root);
  const bundled = join(root, "bundled");
  const users = join(root, "users");
  await Promise.all([mkdir(bundled, { recursive: true }), mkdir(users, { recursive: true })]);
  let active = "default";
  return {
    root,
    bundled,
    users,
    manager: new ThemeManagerService({
      bundledThemesPath: bundled,
      userThemesPath: users,
      readActiveThemeId: () => active,
      writeActiveThemeId: (themeId) => { active = themeId; },
      now: () => 1_000,
    }),
    getActive: () => active,
    setActive: (themeId: string) => { active = themeId; },
  };
}

function manifest(id: string, name: string, colorScheme: "light" | "dark") {
  return {
    id,
    name,
    version: "1.0.0",
    author: "Fixture",
    description: `${name} fixture`,
    colorScheme,
  };
}

async function writeTheme(root: string, data: ReturnType<typeof manifest>, css: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(join(root, "theme.json"), JSON.stringify(data)),
    writeFile(join(root, "theme.css"), css),
  ]);
}

function createStoredZip(files: Record<string, Buffer>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    localParts.push(local, nameBytes, content);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}
