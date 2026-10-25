// Seeded gradient noise (improved Perlin) and helpers.
import { Rng } from './rng.js';

export function makeNoise(seed) {
  const rng = new Rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint16Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rng.next() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rng.next();

  // Roughly in [-1, 1].
  function noise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const n00 = gx[aa] * xf + gy[aa] * yf;
    const n10 = gx[ba] * (xf - 1) + gy[ba] * yf;
    const n01 = gx[ab] * xf + gy[ab] * (yf - 1);
    const n11 = gx[bb] * (xf - 1) + gy[bb] * (yf - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.41;
  }

  function fbm2(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise2(x * f + o * 17.31, y * f - o * 9.13);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }

  // Smooth 1D value noise in [0, 1]; used for bristle profiles and contour rhythms.
  function value1(x) {
    const xi = Math.floor(x);
    const f = x - xi;
    const a = vals[xi & 255];
    const b = vals[(xi + 1) & 255];
    return a + (b - a) * f * f * (3 - 2 * f);
  }

  return { noise2, fbm2, value1 };
}

export const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);

export const lerp = (a, b, t) => a + (b - a) * t;
