// The support: plain-weave linen under a warm grey imprimatura.
// Everything is sized in millimetres on a 150 x 100 cm canvas, so a preview is the
// same painting, smaller.
import { mixPaint } from '../lib/color.js';
import { makeNoise, smoothstep } from '../lib/noise.js';

export const CANVAS_MM = [1500, 1000];

export function makeCanvas({ W, region, seed }) {
  const pxPerMM = W / CANVAS_MM[0];
  const w = region.x1 - region.x0;
  const h = region.y1 - region.y0;
  const n = w * h;
  const noise = makeNoise(seed ^ 0x11e7);
  const ground = mixPaint({ W: 0.75, O: 0.19, V: 0.05, K: 0.008 }); // warm grey-brown imprimatura
  const groundImg = new Float32Array(n * 3);
  const paint = new Float32Array(n * 3);
  const height = new Float32Array(n); // paint thickness, mm
  const opacity = new Float32Array(n); // how much the paint film hides the ground
  const gloss = new Float32Array(n);
  const tooth = new Float32Array(n); // surface relief of the bare canvas, 0..1
  const weaveVis = smoothstep(1.4, 3.2, 1.1 * pxPerMM); // band-limit the weave in small previews
  const pitch = 1.1; // mm per thread
  for (let y = 0; y < h; y++) {
    const ymm = (region.y0 + y + 0.5) / pxPerMM;
    for (let x = 0; x < w; x++) {
      const xmm = (region.x0 + x + 0.5) / pxPerMM;
      const i = y * w + x;
      // Plain weave: threads wobble and swell; warp and weft alternate over and under.
      const u = xmm / pitch + noise.noise2(ymm * 0.02, xmm * 0.003) * 0.6;
      const v = ymm / pitch + noise.noise2(xmm * 0.02 + 40, ymm * 0.003) * 0.6;
      const iu = Math.floor(u);
      const iv = Math.floor(v);
      const fu = u - iu;
      const fv = v - iv;
      const thickU = 0.75 + 0.5 * noise.value1(iu * 0.37 + 3);
      const thickV = 0.75 + 0.5 * noise.value1(iv * 0.41 + 9);
      const warp = Math.max(0, 1 - Math.abs(2 * fu - 1) ** 1.5 / thickU);
      const weft = Math.max(0, 1 - Math.abs(2 * fv - 1) ** 1.5 / thickV);
      const over = (iu + iv) & 1;
      const weave = over ? Math.max(warp * (0.55 + 0.45 * Math.sin(Math.PI * fv)), weft * 0.55) : Math.max(weft * (0.55 + 0.45 * Math.sin(Math.PI * fu)), warp * 0.55);
      // Marks of the brush that laid the ground, and slubs.
      const marks = noise.fbm2(xmm * 0.06, ymm * 0.25, 3) * 0.5 + 0.5;
      const slub = noise.noise2(xmm * 0.5, ymm * 0.5) * 0.5 + 0.5;
      tooth[i] = (0.6 * weave * weaveVis + 0.6 * (1 - weaveVis) * 0.5) + 0.28 * marks + 0.12 * slub;
      const tone = 1 + noise.fbm2(xmm * 0.004, ymm * 0.004, 3) * 0.08 + (marks - 0.5) * 0.05;
      groundImg[i * 3] = ground[0] * tone;
      groundImg[i * 3 + 1] = ground[1] * tone;
      groundImg[i * 3 + 2] = ground[2] * tone;
      paint[i * 3] = groundImg[i * 3];
      paint[i * 3 + 1] = groundImg[i * 3 + 1];
      paint[i * 3 + 2] = groundImg[i * 3 + 2];
    }
  }
  return { w, h, pxPerMM, region, ground: groundImg, paint, height, opacity, gloss, tooth };
}

// How opaque a film of thickness h (mm) is over the ground.
export const HIDE_MM = 0.035;
export const cover = (h) => 1 - Math.exp(-h / HIDE_MM);
