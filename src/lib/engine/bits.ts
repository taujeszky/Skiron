/** Bitmask helpers. Rooms, people and slots all fit in a 32-bit int. */

export function bit(i: number): number {
  return 1 << i;
}

export function has(mask: number, i: number): boolean {
  return (mask & (1 << i)) !== 0;
}

export function popcount(mask: number): number {
  let m = mask - ((mask >> 1) & 0x55555555);
  m = (m & 0x33333333) + ((m >> 2) & 0x33333333);
  m = (m + (m >> 4)) & 0x0f0f0f0f;
  return (m * 0x01010101) >> 24;
}

/** The index of the single set bit, or -1 if the mask does not hold exactly one. */
export function onlyBit(mask: number): number {
  if (mask === 0 || (mask & (mask - 1)) !== 0) return -1;
  return 31 - Math.clz32(mask);
}

/** The set bits, ascending. */
export function bitsOf(mask: number): number[] {
  const out: number[] = [];
  let m = mask;
  while (m !== 0) {
    const low = m & -m;
    out.push(31 - Math.clz32(low));
    m ^= low;
  }
  return out;
}

/** A mask with bits 0..n-1 set. */
export function fullMask(n: number): number {
  return n >= 32 ? -1 : (1 << n) - 1;
}
