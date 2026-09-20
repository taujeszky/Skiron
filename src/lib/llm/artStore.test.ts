import { describe, expect, it } from "vitest";
import { artKey, memoryArt, parseImage, type StoredImage } from "./artStore";
import { DB_VERSION, STORES } from "./idb";

const BYTES = new Uint8Array([137, 80, 78, 71]);
const IMAGE: StoredImage = { mime: "image/png", bytes: BYTES };

describe("the database", () => {
  it("has a store for art as well as skins", () => {
    expect([...STORES]).toContain("art");
    expect([...STORES]).toContain("skins");
  });

  it("is at a version above the one that had only skins", () => {
    // The trap this is here for: `onupgradeneeded` fires only when the
    // version rises, so a second store added at version 1 is never created
    // for anybody who has opened the app before — which is everybody with a
    // saved case, and nobody running the tests.
    expect(DB_VERSION).toBeGreaterThan(1);
  });
});

describe("the key", () => {
  it("joins a case and a subject unambiguously", () => {
    expect(artKey("SK1-E-abc", "p0")).toBe("SK1-E-abc:p0");
  });
});

describe("reading a record back", () => {
  it("takes a well-formed one", () => {
    expect(parseImage({ mime: "image/webp", bytes: BYTES })).toEqual({
      mime: "image/webp",
      bytes: BYTES,
    });
  });

  it("takes an ArrayBuffer, which is what an older build may have written", () => {
    const back = parseImage({ mime: "image/png", bytes: BYTES.buffer });
    expect(back?.bytes).toEqual(BYTES);
  });

  it("refuses anything that is not an image type", () => {
    // A picture is put straight into a Blob and then into an <img>; the MIME
    // type is the only thing standing between a corrupt record and whatever
    // the browser decides to do with it.
    expect(parseImage({ mime: "text/html", bytes: BYTES })).toBeNull();
    expect(parseImage({ mime: "", bytes: BYTES })).toBeNull();
    expect(parseImage({ bytes: BYTES })).toBeNull();
  });

  it("refuses an empty or absurd payload", () => {
    expect(parseImage({ mime: "image/png", bytes: new Uint8Array(0) })).toBeNull();
    expect(parseImage({ mime: "image/png", bytes: "not bytes" })).toBeNull();
    expect(parseImage(null)).toBeNull();
    expect(parseImage("a string")).toBeNull();
  });
});

describe("the store", () => {
  it("keeps images apart by case and by subject", async () => {
    const store = memoryArt();
    await store.put("CASE-A", "p0", IMAGE);
    await store.put("CASE-A", "p1", { mime: "image/webp", bytes: new Uint8Array([1]) });
    await store.put("CASE-B", "p0", IMAGE);

    expect((await store.get("CASE-A", "p1"))!.mime).toBe("image/webp");
    expect(await store.get("CASE-A", "p2")).toBeNull();
    expect(await store.get("CASE-C", "p0")).toBeNull();
  });

  it("lists what a case already has, which is what stops a resume paying twice", async () => {
    const store = memoryArt();
    await store.put("CASE-A", "p0", IMAGE);
    await store.put("CASE-A", "scene", IMAGE);
    await store.put("CASE-B", "p0", IMAGE);
    expect((await store.keys("CASE-A")).sort()).toEqual(["p0", "scene"]);
    expect(await store.keys("CASE-C")).toEqual([]);
  });

  it("forgets one case without touching another", async () => {
    const store = memoryArt();
    await store.put("CASE-A", "p0", IMAGE);
    await store.put("CASE-B", "p0", IMAGE);
    await store.removeCase("CASE-A");
    expect(await store.get("CASE-A", "p0")).toBeNull();
    expect(await store.get("CASE-B", "p0")).not.toBeNull();
  });
});
