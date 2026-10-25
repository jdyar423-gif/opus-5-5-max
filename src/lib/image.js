// Float32 image buffers (linear light) and a few operations on them.
import { linearToSrgb255 } from './color.js';

export class Img {
  constructor(w, h, c = 3, data = null) {
    this.w = w;
    this.h = h;
    this.c = c;
    this.data = data || new Float32Array(w * h * c);
  }

  clone() {
    return new Img(this.w, this.h, this.c, this.data.slice());
  }

  fill(...v) {
    const { data, c } = this;
    for (let i = 0; i < data.length; i += c) for (let k = 0; k < c; k++) data[i + k] = v[k] ?? v[0];
    return this;
  }
}

// Bilinear sample at continuous pixel coordinates (pixel centres at i + 0.5).
export function sample(img, x, y, out) {
  const { w, h, c, data } = img;
  let fx = x - 0.5;
  let fy = y - 0.5;
  if (fx < 0) fx = 0;
  if (fy < 0) fy = 0;
  if (fx > w - 1) fx = w - 1;
  if (fy > h - 1) fy = h - 1;
  const x0 = fx | 0;
  const y0 = fy | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const tx = fx - x0;
  const ty = fy - y0;
  const i00 = (y0 * w + x0) * c;
  const i10 = (y0 * w + x1) * c;
  const i01 = (y1 * w + x0) * c;
  const i11 = (y1 * w + x1) * c;
  for (let k = 0; k < c; k++) {
    const a = data[i00 + k] + (data[i10 + k] - data[i00 + k]) * tx;
    const b = data[i01 + k] + (data[i11 + k] - data[i01 + k]) * tx;
    out[k] = a + (b - a) * ty;
  }
  return out;
}

// Nearest-pixel read of a single channel, clamped to the image.
export function at(img, x, y, k = 0) {
  let xi = x | 0;
  let yi = y | 0;
  if (xi < 0) xi = 0;
  if (yi < 0) yi = 0;
  if (xi >= img.w) xi = img.w - 1;
  if (yi >= img.h) yi = img.h - 1;
  return img.data[(yi * img.w + xi) * img.c + k];
}

function boxPass(src, dst, w, h, c, r, horizontal) {
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? c : w * c;
  const inv = 1 / (2 * r + 1);
  const acc = new Float64Array(c);
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w * c : line * c;
    acc.fill(0);
    for (let i = -r - 1; i < r; i++) {
      const j = Math.min(n - 1, Math.max(0, i));
      for (let k = 0; k < c; k++) acc[k] += src[base + j * step + k];
    }
    for (let i = 0; i < n; i++) {
      const add = Math.min(n - 1, i + r);
      const rem = Math.max(0, i - r - 1);
      for (let k = 0; k < c; k++) {
        acc[k] += src[base + add * step + k] - src[base + rem * step + k];
        dst[base + i * step + k] = acc[k] * inv;
      }
    }
  }
}

// Approximate Gaussian blur: three box passes per axis (edges clamped).
export function blur(img, sigma) {
  if (sigma < 0.5) return img.clone();
  const { w, h, c } = img;
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5));
  let a = img.data.slice();
  let b = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(a, b, w, h, c, r, true);
    [a, b] = [b, a];
  }
  for (let pass = 0; pass < 3; pass++) {
    boxPass(a, b, w, h, c, r, false);
    [a, b] = [b, a];
  }
  return new Img(w, h, c, a);
}

// Area-average downsample by an integer factor.
export function downsample(img, f) {
  if (f === 1) return img.clone();
  const w = Math.floor(img.w / f);
  const h = Math.floor(img.h / f);
  const out = new Img(w, h, img.c);
  const inv = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < img.c; k++) {
        let s = 0;
        for (let dy = 0; dy < f; dy++) {
          let i = ((y * f + dy) * img.w + x * f) * img.c + k;
          for (let dx = 0; dx < f; dx++, i += img.c) s += img.data[i];
        }
        out.data[(y * w + x) * img.c + k] = s * inv;
      }
    }
  }
  return out;
}

export function crop(img, x0, y0, w, h) {
  const out = new Img(w, h, img.c);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.w + x0) * img.c;
    out.data.set(img.data.subarray(src, src + w * img.c), y * w * img.c);
  }
  return out;
}

// Linear RGB -> 8-bit sRGB with a little ordered dither to avoid banding in the sky.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

export function toSrgb8(img) {
  const { w, h, data } = img;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * img.c;
      const o = (y * w + x) * 3;
      const d = BAYER[(y & 3) * 4 + (x & 3)];
      for (let k = 0; k < 3; k++) {
        const v = linearToSrgb255(data[i + (img.c === 1 ? 0 : k)]) + d;
        out[o + k] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5;
      }
    }
  }
  return out;
}

// Map a single-channel image with values in [lo, hi] to grey sRGB bytes (debug output).
export function grey8(img, lo = 0, hi = 1, k = 0) {
  const out = new Uint8Array(img.w * img.h * 3);
  for (let i = 0; i < img.w * img.h; i++) {
    const v = Math.max(0, Math.min(1, (img.data[i * img.c + k] - lo) / (hi - lo))) * 255;
    out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = v;
  }
  return out;
}
