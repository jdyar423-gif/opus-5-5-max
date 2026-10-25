// The reference: what the painter "sees". A colour image plus per-pixel style maps
// (object class, stroke angle, depth, glitter, cast shadow, rim light, impasto wish).
import { Img } from '../lib/image.js';
import { OBJ } from './objects.js';
import { renderPrimitives, renderLines } from './raycast.js';

export class Reference {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.color = new Img(w, h, 3);
    this.obj = new Uint8Array(n);
    this.angle = new Float32Array(n);
    this.depth = new Float32Array(n).fill(Infinity);
    this.coverage = new Float32Array(n);
    this.glint = new Float32Array(n);
    this.shadow = new Float32Array(n);
    this.light = new Float32Array(n);
    this.impasto = new Float32Array(n);
    this.spray = new Float32Array(n);
    this.primId = new Int32Array(n).fill(-1);
  }

  setStyle(pi, prim, info) {
    this.obj[pi] = info.obj ?? prim.obj ?? 0;
    if (info.angle !== undefined) this.angle[pi] = info.angle;
    this.light[pi] = info.light ?? 0;
    this.impasto[pi] = info.impasto ?? 0.3;
    this.primId[pi] = prim.id ?? -1;
  }
}

export function renderReference(ctx, scene) {
  const { W, H, region, camera, sky, sea, pavement } = ctx;
  const rw = region.x1 - region.x0;
  const rh = region.y1 - region.y0;
  const ref = new Reference(rw, rh);
  const eye = camera.eye;
  const d = [0, 0, 0];
  const col = [0, 0, 0];
  const parts = {};
  const seaInfo = {};
  const pavInfo = {};
  const sunPx = camera.project([0, Math.sin((ctx.L.sun.elevationDeg * Math.PI) / 180) * 1e6, 1e6]);

  // Background: sky, slab walk, sea.
  for (let py = 0; py < rh; py++) {
    const y = (region.y0 + py + 0.5) / H;
    for (let px = 0; px < rw; px++) {
      const x = (region.x0 + px + 0.5) / H;
      camera.dir(x, y, d);
      const pi = py * rw + px;
      const o = pi * 3;
      if (d[1] >= 0) {
        sky.color(d, col, parts);
        ref.obj[pi] = parts.disc > 0.5 ? OBJ.SUN : OBJ.SKY;
        // Strokes sweep around the sun near it, settle to horizontals elsewhere.
        const rx = x - sunPx[0];
        const ry = y - sunPx[1];
        const dist = Math.hypot(rx, ry);
        const tang = Math.atan2(ry, rx) + Math.PI / 2;
        const w = Math.exp(-dist / 0.18) * 0.55;
        ref.angle[pi] = blendAngles(0, tang, w);
        ref.light[pi] = parts.glow;
        ref.impasto[pi] = 0.15 + parts.disc * 0.8 + parts.glow * 0.8;
      } else {
        const tp = pavement.hit(eye, d);
        if (tp < Infinity) {
          pavement.shade(eye, d, tp, col, pavInfo, ctx.shadowAt);
          ref.obj[pi] = OBJ.PAVEMENT;
          ref.angle[pi] = pavInfo.angle;
          ref.depth[pi] = tp;
          ref.shadow[pi] = pavInfo.shadow;
          ref.impasto[pi] = 0.15;
        } else {
          const t = sea.shade(eye, d, col, seaInfo);
          ref.obj[pi] = OBJ.SEA;
          ref.angle[pi] = 0;
          ref.depth[pi] = t;
          ref.glint[pi] = seaInfo.glint * (0.25 + 0.75 * seaInfo.sparkle);
          ref.impasto[pi] = 0.2 + Math.min(1, ref.glint[pi]);
        }
      }
      ref.color.data[o] = col[0];
      ref.color.data[o + 1] = col[1];
      ref.color.data[o + 2] = col[2];
    }
  }

  const bgDepth = (dir) => {
    if (dir[1] >= 0) return Infinity;
    const tp = pavement.hit(eye, dir);
    if (tp < Infinity) return tp;
    return (ctx.L.seaLevel - eye[1]) / dir[1];
  };

  if (scene.prims.length) {
    renderPrimitives({ prims: scene.prims, camera, W, H, region, ref, shadeHit: ctx.shader.shadeHit, bgDepth });
  }
  if (scene.lines.length) renderLines({ lines: scene.lines, camera, H, region, ref });
  if (scene.overlays) for (const f of scene.overlays) f(ref);
  return ref;
}

// Blend two undirected stroke angles (mod pi) with weight w toward b.
export function blendAngles(a, b, w) {
  const x = Math.cos(2 * a) * (1 - w) + Math.cos(2 * b) * w;
  const y = Math.sin(2 * a) * (1 - w) + Math.sin(2 * b) * w;
  return Math.atan2(y, x) / 2;
}
