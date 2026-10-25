// Seeded randomness. Every random decision in the renderer flows from here, so a
// given seed always produces the same painting.

export function hash32(...keys) {
  let h = 0x9e3779b9 ^ keys.length;
  for (let k of keys) {
    k = Math.imul(k | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// sfc32: small, fast, good statistical quality.
export class Rng {
  constructor(seed) {
    this.a = hash32(seed, 1);
    this.b = hash32(seed, 2);
    this.c = hash32(seed, 3);
    this.d = hash32(seed, 4);
    for (let i = 0; i < 12; i++) this.next();
  }

  next() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  range(lo, hi) {
    return lo + (hi - lo) * this.next();
  }

  int(lo, hi) {
    return lo + Math.floor((hi - lo + 1) * this.next());
  }

  normal() {
    let u = 0;
    while (u === 0) u = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

// An independent stream keyed by integers, e.g. rngFor(seed, pass, cellX, cellY).
// Keyed streams keep cropped renders identical to the matching region of a full render.
export const rngFor = (...keys) => new Rng(hash32(...keys));
