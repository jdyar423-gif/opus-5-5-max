// From paint state to the photographed painting: thin films let the ground through,
// a gallery light rakes the impasto, the weave shows where paint is thin, and every
// colour is held inside the Zorn palette (only the pouch may be saturated).
import { Img } from '../lib/image.js';
import { zornClamp } from '../lib/color.js';
import { OBJ } from '../scene/objects.js';

const CHROMA_CAP = new Float32Array(32).fill(0.062);
CHROMA_CAP[OBJ.POUCH] = 0.21;
CHROMA_CAP[OBJ.RUST] = 0.085;
CHROMA_CAP[OBJ.HEAD] = 0.075;
CHROMA_CAP[OBJ.EYE] = 0.11;
CHROMA_CAP[OBJ.BILL] = 0.07;

export function finish(canvas, ref, { relief = 0.45, lightDir = [-0.55, -0.62, 0.56] } = {}) {
  const { w, h, paint, height, opacity, gloss, tooth, ground, pxPerMM } = canvas;
  const out = new Img(w, h, 3);
  // Surface relief in mm: paint plus the weave where the paint is thin.
  const raw = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) raw[i] = height[i] + tooth[i] * 0.05 * Math.exp(-height[i] / 0.04);
  // A touch of smoothing: paint surfaces have no one-pixel cliffs.
  const surf = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const wgt = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          s += raw[yy * w + xx] * wgt;
          n += wgt;
        }
      }
      surf[y * w + x] = s / n;
    }
  }
  const ln = Math.hypot(...lightDir);
  const lx = lightDir[0] / ln;
  const ly = lightDir[1] / ln;
  const lz = lightDir[2] / ln;
  // Half vector for a viewer straight on.
  const hl = Math.hypot(lx, ly, lz + 1);
  const hx = lx / hl;
  const hy = ly / hl;
  const hz = (lz + 1) / hl;
  const mmPerPx = 1 / pxPerMM;
  const at = (x, y) => surf[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 3;
      const cv = opacity[i];
      let r = ground[o] + (paint[o] - ground[o]) * cv;
      let g = ground[o + 1] + (paint[o + 1] - ground[o + 1]) * cv;
      let b = ground[o + 2] + (paint[o + 2] - ground[o + 2]) * cv;
      // Slope of the paint surface (mm per mm).
      const gx = (at(x + 1, y) - at(x - 1, y)) / (2 * mmPerPx);
      const gy = (at(x, y + 1) - at(x, y - 1)) / (2 * mmPerPx);
      const nx = -gx * relief;
      const ny = -gy * relief;
      const nl = Math.hypot(nx, ny, 1);
      const ndl = (nx * lx + ny * ly + lz) / nl;
      const shade = 1 + ((ndl / lz) - 1) * 0.8;
      // Cavities between bristle ridges hold a little shadow.
      const cav = Math.max(0, (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) * 0.25 - surf[i]);
      const cavity = 1 - Math.min(0.08, cav * 1.2);
      const k = shade * cavity;
      r *= k;
      g *= k;
      b *= k;
      // Oil sheen on fresh impasto and knife work.
      const ndh = Math.max(0, (nx * hx + ny * hy + hz) / nl);
      const gl = gloss[i];
      const spec = (0.025 + gl * 0.09) * Math.pow(ndh, 40 + gl * 90) * Math.min(1, height[i] * 6);
      r += spec;
      g += spec * 0.97;
      b += spec * 0.9;
      out.data[o] = r;
      out.data[o + 1] = g;
      out.data[o + 2] = b;
      zornClamp(out.data, o, ref ? CHROMA_CAP[ref.obj[i]] : 0.062);
    }
  }
  return out;
}
