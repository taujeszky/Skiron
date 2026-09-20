import { describe, expect, it } from "vitest";
import { isImage, isShellImage, precacheList, SHELL_IMAGES } from "./precache";

const BUILT = ["/_app/immutable/entry/app.js", "/_app/immutable/nodes/0.js"];

const STATIC = [
  "/favicon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
  "/robots.txt",
  "/cases/starter/manifest.json",
  "/cases/starter/SK1-E-0.json",
  "/cases/starter/SK1-E-0/p0.webp",
  "/cases/starter/SK1-E-0/p1.webp",
  "/cases/starter/SK1-E-0/scene.webp",
];

describe("what counts as a picture", () => {
  it("knows the formats a pack can hold", () => {
    expect(isImage("/a/b.webp")).toBe(true);
    expect(isImage("/a/b.PNG")).toBe(true);
    expect(isImage("/a/b.jpeg")).toBe(true);
  });

  it("does not mistake a case file for one", () => {
    expect(isImage("/cases/starter/SK1-E-0.json")).toBe(false);
    expect(isImage("/webp")).toBe(false);
    // The trap: a directory named after a case, with the extension inside it.
    expect(isImage("/cases/SK1-E-0.webp/manifest.json")).toBe(false);
  });
});

describe("the install payload", () => {
  const list = precacheList(BUILT, STATIC);

  it("keeps everything that was built", () => {
    for (const path of BUILT) expect(list).toContain(path);
  });

  it("keeps a shipped case's JSON, so it still opens offline from cold", () => {
    // The whole point of shipping a pack. A visitor with no key and no
    // network has cases somebody wrote.
    expect(list).toContain("/cases/starter/SK1-E-0.json");
    expect(list).toContain("/cases/starter/manifest.json");
  });

  it("leaves a case's pictures out — wave 7's task 8, which is a subtraction", () => {
    // The default is the opposite and was already in effect before a single
    // image existed: `files` is everything under `static/`.
    expect(list).not.toContain("/cases/starter/SK1-E-0/p0.webp");
    expect(list).not.toContain("/cases/starter/SK1-E-0/scene.webp");
    expect(list.filter((p) => p.endsWith(".webp"))).toEqual([]);
  });

  it("keeps the four shell icons, which the manifest points at", () => {
    for (const name of SHELL_IMAGES) expect(list).toContain(`/${name}`);
  });

  it("grows by one file, not by eighty, when a case gains pictures", () => {
    // The number this exists to protect: a twelve-case pack is 84 images, and
    // precaching them would put the lot in the first load.
    const plain = precacheList(BUILT, ["/cases/starter/SK1-E-0.json"]);
    const withArt = precacheList(BUILT, [
      "/cases/starter/SK1-E-0.json",
      ...Array.from({ length: 84 }, (_, i) => `/cases/starter/SK1-E-0/p${i}.webp`),
    ]);
    expect(withArt.length).toBe(plain.length);
  });
});

describe("a deployment under a sub-path", () => {
  it("still precaches the icons", () => {
    // `$service-worker` prefixes every entry with the base path. An exact
    // string comparison passes at the root and silently drops the icons
    // anywhere else — which is precisely the kind of thing that would never
    // be noticed, because nothing fails, it just looks wrong offline.
    const based = STATIC.map((p) => `/skiron${p}`);
    const list = precacheList(BUILT, based);
    for (const name of SHELL_IMAGES) expect(list).toContain(`/skiron/${name}`);
    expect(list).not.toContain("/skiron/cases/starter/SK1-E-0/p0.webp");
  });

  it("recognises a shell icon with or without a leading path", () => {
    expect(isShellImage("/favicon.png")).toBe(true);
    expect(isShellImage("/skiron/favicon.png")).toBe(true);
    expect(isShellImage("favicon.png")).toBe(true);
    // Not a shell icon just because the name ends the same way.
    expect(isShellImage("/cases/my-favicon.png")).toBe(false);
  });
});
