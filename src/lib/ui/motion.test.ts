import { afterEach, describe, expect, it } from "vitest";

import { prefersReducedMotion, useReducedMotion } from "./motion";

afterEach(() => useReducedMotion(null));

describe("reduced motion", () => {
  it("is false where there is no matchMedia, which is Node", () => {
    // The safe direction: a test that cares sets it, and nothing in Node
    // animates anyway.
    expect(prefersReducedMotion()).toBe(false);
  });

  it("can be forced either way, which is how the replay is tested", () => {
    useReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    useReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("survives a matchMedia that throws", () => {
    const real = (globalThis as { matchMedia?: unknown }).matchMedia;
    (globalThis as { matchMedia?: unknown }).matchMedia = () => {
      throw new Error("no");
    };
    try {
      expect(prefersReducedMotion()).toBe(false);
    } finally {
      if (real === undefined) delete (globalThis as { matchMedia?: unknown }).matchMedia;
      else (globalThis as { matchMedia?: unknown }).matchMedia = real;
    }
  });

  it("reads the media query when there is one", () => {
    const real = (globalThis as { matchMedia?: unknown }).matchMedia;
    (globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({
      matches: q.includes("prefers-reduced-motion"),
    });
    try {
      expect(prefersReducedMotion()).toBe(true);
    } finally {
      if (real === undefined) delete (globalThis as { matchMedia?: unknown }).matchMedia;
      else (globalThis as { matchMedia?: unknown }).matchMedia = real;
    }
  });
});
