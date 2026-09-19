/**
 * Deterministic seeded PRNG (xoshiro128**), seedable from a string.
 *
 * Determinism is load-bearing: a case ID is nothing but a seed, so the same
 * seed must rebuild the same case byte for byte, in Node and in the worker.
 * Nothing in `engine/` may reach for `Math.random`.
 */
export class RNG {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: string) {
    // splitmix32 over an FNV-1a string hash to fill the state
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    }
    const next = () => {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Random uint32. */
  next(): number {
    const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
    const result = rotl(Math.imul(this.s1, 5) >>> 0, 7);
    const r = Math.imul(result, 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return r;
  }

  /** Random float in [0, 1). */
  float(): number {
    return this.next() / 4294967296;
  }

  /** Random integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** One element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** In-place Fisher-Yates. Returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * An index into `weights`, chosen in proportion to them. Weights must be
   * non-negative and not all zero.
   */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let roll = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }
}

/** A short random seed string (base36). Not part of the engine's determinism. */
export function randomSeed(): string {
  const n =
    Math.floor(Math.random() * 0x100000000) * 0x10000 +
    Math.floor(Math.random() * 0x10000);
  return n.toString(36);
}
