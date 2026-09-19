import { describe, it, expect } from "vitest";
import { RNG } from "./rng";

describe("RNG", () => {
  it("gives the same sequence for the same seed", () => {
    const a = new RNG("SK1-normal-abc");
    const b = new RNG("SK1-normal-abc");
    const one = Array.from({ length: 64 }, () => a.next());
    const two = Array.from({ length: 64 }, () => b.next());
    expect(one).toEqual(two);
  });

  it("gives a different sequence for a different seed", () => {
    const a = Array.from({ length: 16 }, (_, i) => new RNG("a").next() + i);
    const b = Array.from({ length: 16 }, (_, i) => new RNG("b").next() + i);
    expect(a).not.toEqual(b);
  });

  it("produces uint32 values and floats in [0, 1)", () => {
    const r = new RNG("range");
    for (let i = 0; i < 2000; i++) {
      const n = r.next();
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(0xffffffff);
    }
    const f = new RNG("floats");
    for (let i = 0; i < 2000; i++) {
      const x = f.float();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("int(n) stays in range and covers it", () => {
    const r = new RNG("ints");
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = r.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
  });

  it("shuffle is a permutation and is seed-stable", () => {
    const base = Array.from({ length: 20 }, (_, i) => i);
    const a = new RNG("shuffle").shuffle([...base]);
    const b = new RNG("shuffle").shuffle([...base]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(base);
  });

  it("weighted respects zero weights and rough proportions", () => {
    const r = new RNG("weights");
    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[r.weighted([3, 1, 0])]++;
    expect(counts[2]).toBe(0);
    // 3:1 over 6000 draws: sampling noise is far below this margin.
    expect(counts[0] / counts[1]).toBeGreaterThan(2.5);
    expect(counts[0] / counts[1]).toBeLessThan(3.5);
  });
});
