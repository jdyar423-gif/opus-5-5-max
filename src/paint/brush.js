// The brush engine. A stroke is a centreline with a width profile; each covered pixel
// gets (s along, t across) from its nearest segment and is shaded as paint:
// bristle streaks, depletion and dry-brush breakup on the canvas tooth, wet pickup,
// ragged edges, and deposited thickness with lips at the edges and a pile where it lifts.
import { Rng } from '../lib/rng.js';

const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class Painter {
  constructor(canvas, noise) {
    this.c = canvas;
    this.noise = noise;
    const n = canvas.w * canvas.h;
    this.stamp = new Int32Array(n).fill(-1);
    this.tS = new Float32Array(n);
    this.tT = new Float32Array(n);
    this.tK = new Float32Array(n);
    this.tW = new Float32Array(n);
    this.list = new Int32Array(1 << 20);
    this.id = 0;
    this.pixels = 0;
    this.count = 0;
  }

  // Catmull-Rom resample of control points [[x, y], ...] with matching half-widths.
  static resample(ctrl, widths, spacing) {
    const pts = [];
    const ws = [];
    const n = ctrl.length;
    if (n === 1) return { pts: [ctrl[0][0], ctrl[0][1], ctrl[0][0] + 0.01, ctrl[0][1]], ws: [widths[0], widths[0]] };
    for (let i = 0; i < n - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)];
      const p1 = ctrl[i];
      const p2 = ctrl[i + 1];
      const p3 = ctrl[Math.min(n - 1, i + 2)];
      const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.max(1, Math.ceil(segLen / spacing));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        pts.push(x, y);
        ws.push(widths[i] + (widths[i + 1] - widths[i]) * t);
      }
    }
    pts.push(ctrl[n - 1][0], ctrl[n - 1][1]);
    ws.push(widths[n - 1]);
    return { pts, ws };
  }

  /**
   * S: { ctrl: [[x,y],...], width: half-width px (number or per-point array), color, color2?,
   *      alpha, thick (mm), wet, dry, load, deplete (px), pickup, plow, kind, bristles, rag,
   *      streakMix, streakLen, valueJitter, gloss, taper: [start, end] fractions, breaks, seed }
   */
  stroke(S) {
    const c = this.c;
    const W = c.w;
    const H = c.h;
    const kind = S.kind || 'brush';
    const ctrl = S.ctrl;
    const widths = Array.isArray(S.width) ? S.width : ctrl.map(() => S.width);
    const maxW0 = Math.max(...widths);
    const spacing = Math.max(1.2, Math.min(10, maxW0 * 0.45));
    const { pts, ws } = Painter.resample(ctrl, widths, spacing);
    const np = pts.length / 2;
    // Arc length.
    const sAt = new Float32Array(np);
    for (let i = 1; i < np; i++) sAt[i] = sAt[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    const L = Math.max(1e-3, sAt[np - 1]);
    // Taper the width at the ends (attack and release).
    const taper = S.taper || (kind === 'knife' ? [0, 0] : [0.08, 0.18]);
    const flatCaps = S.caps === 'flat' || kind === 'knife';
    for (let i = 0; i < np; i++) {
      const sn = sAt[i] / L;
      let f = 1;
      if (taper[0] > 0 && sn < taper[0]) f = 0.55 + 0.45 * (sn / taper[0]);
      if (taper[1] > 0 && sn > 1 - taper[1]) f *= 0.35 + 0.65 * ((1 - sn) / taper[1]);
      ws[i] *= f;
    }
    let maxW = 0;
    for (let i = 0; i < np; i++) maxW = Math.max(maxW, ws[i]);
    const rag = S.rag ?? (kind === 'knife' ? 0.25 : Math.min(1.2, 0.25 + maxW * 0.05));
    const reach = maxW + rag + 2;

    // --- pass 1: nearest-segment coordinates for every covered pixel
    const id = ++this.id;
    const stamp = this.stamp;
    const tS = this.tS;
    const tT = this.tT;
    const tK = this.tK;
    const tW = this.tW;
    let list = this.list;
    let count = 0;
    for (let i = 0; i < np - 1; i++) {
      const ax = pts[2 * i];
      const ay = pts[2 * i + 1];
      const ex = pts[2 * i + 2] - ax;
      const ey = pts[2 * i + 3] - ay;
      const el2 = ex * ex + ey * ey || 1e-9;
      const len = Math.sqrt(el2);
      const w0 = ws[i];
      const w1 = ws[i + 1];
      const x0 = Math.max(0, Math.floor(Math.min(ax, ax + ex) - reach));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, ax + ex) + reach));
      const y0 = Math.max(0, Math.floor(Math.min(ay, ay + ey) - reach));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, ay + ey) + reach));
      const s0 = sAt[i];
      for (let py = y0; py <= y1; py++) {
        const qy = py + 0.5 - ay;
        let idx = py * W + x0;
        for (let px = x0; px <= x1; px++, idx++) {
          const qx = px + 0.5 - ax;
          let u = (qx * ex + qy * ey) / el2;
          if (flatCaps) {
            const su = s0 + u * len;
            if (su < 0 || su > sAt[np - 1]) continue;
          }
          if (u < 0) u = 0;
          else if (u > 1) u = 1;
          const dx = qx - ex * u;
          const dy = qy - ey * u;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const wv = w0 + (w1 - w0) * u;
          const key = dist - wv;
          if (key > rag + 1) continue;
          if (stamp[idx] !== id) {
            stamp[idx] = id;
            if (count >= list.length) {
              const bigger = new Int32Array(list.length * 2);
              bigger.set(list);
              list = this.list = bigger;
            }
            list[count++] = idx;
          } else if (key >= tK[idx]) continue;
          tK[idx] = key;
          tS[idx] = s0 + u * len;
          tT[idx] = (ex * qy - ey * qx >= 0 ? dist : -dist) / Math.max(wv, 0.35);
          tW[idx] = wv;
        }
      }
    }
    if (count === 0) return 0;

    // --- per-stroke tables
    const rng = new Rng(S.seed ?? id);
    const NB = Math.max(2, Math.min(48, S.bristles ?? Math.round(maxW * 0.9) + 2));
    const BL = new Float32Array(NB + 2);
    const BE = new Float32Array(NB + 2);
    const BC = new Float32Array(NB + 2);
    // Bristles come in clumps that carry more or less paint.
    let clumpLoad = rng.range(0.75, 1.25);
    let clumpColor = 0;
    const streakMix = S.streakMix ?? 0.18;
    for (let b = 0; b < NB + 2; b++) {
      // Bristles come in clumps that carry more or less paint, and some carry the second note.
      if (b === 0 || rng.chance(0.28)) {
        clumpLoad = rng.range(0.75, 1.25);
        clumpColor = rng.chance(streakMix) ? rng.range(0.35, 0.9) : 0;
      }
      BL[b] = clumpLoad * rng.range(0.92, 1.08);
      BE[b] = rng.next();
      BC[b] = clumpColor;
    }
    const color = S.color;
    const color2 = S.color2 || S.color;
    const alphaMax = S.alpha ?? 0.9;
    const thick = S.thick ?? 0.08;
    const wet = S.wet ?? 0.2;
    const dry = S.dry ?? 0.2;
    const load0 = S.load ?? 1;
    const deplete = S.deplete ?? L * 1.6;
    const pickup = S.pickup ?? 0.25;
    const plow = S.plow ?? 0.35;
    const streakLen = S.streakLen ?? Math.max(6, maxW * 3);
    const vj = S.valueJitter ?? 0.05;
    const glossAmt = S.gloss ?? (kind === 'knife' ? 0.8 : thick > 0.3 ? 0.35 : 0.08);
    const breaks = S.breaks ?? 0;
    const clip = S.mask || null;
    const clipKeep = 1 - (S.maskHard ?? 1);
    const seedOff = rng.range(0, 200);
    const noise = this.noise;

    // Reservoir: the colour the brush picks up as it travels (sampled before painting).
    const nRes = Math.max(2, Math.ceil(L / Math.max(3, maxW)) + 1);
    const res = new Float32Array(nRes * 3);
    const paint = c.paint;
    {
      let r = 0;
      let g = 0;
      let b = 0;
      const lambda = Math.max(4, maxW * 2.5);
      for (let k = 0; k < nRes; k++) {
        const s = (L * k) / (nRes - 1);
        // Position along the resampled centreline.
        let j = 0;
        while (j < np - 2 && sAt[j + 1] < s) j++;
        const f = (s - sAt[j]) / Math.max(1e-6, sAt[j + 1] - sAt[j]);
        const x = pts[2 * j] + (pts[2 * j + 2] - pts[2 * j]) * f;
        const y = pts[2 * j + 1] + (pts[2 * j + 3] - pts[2 * j + 1]) * f;
        const xi = Math.min(W - 1, Math.max(0, x | 0));
        const yi = Math.min(H - 1, Math.max(0, y | 0));
        const o = (yi * W + xi) * 3;
        if (k === 0) {
          r = paint[o];
          g = paint[o + 1];
          b = paint[o + 2];
        } else {
          const rate = Math.min(1, (L / (nRes - 1)) / lambda);
          r += (paint[o] - r) * rate;
          g += (paint[o + 1] - g) * rate;
          b += (paint[o + 2] - b) * rate;
        }
        res[k * 3] = r;
        res[k * 3 + 1] = g;
        res[k * 3 + 2] = b;
      }
    }

    // --- pass 2: shade and deposit
    const height = c.height;
    const tooth = c.tooth;
    const gloss = c.gloss;
    const opacity = c.opacity;
    // Opacity of this stroke's film: thin scumbles stay translucent over the ground.
    const filmOp = 1 - Math.exp(-thick / 0.035);
    const invStreak = 1 / streakLen;
    const invDash = 1 / Math.max(2.5, maxW * 0.7);
    const isKnife = kind === 'knife';
    const tau = 0.32 + dry * 0.5;
    let painted = 0;
    for (let k = 0; k < count; k++) {
      const idx = list[k];
      const s = tS[idx];
      const tn = tT[idx];
      const wv = tW[idx];
      const atn = tn < 0 ? -tn : tn;
      let bi = ((tn + 1) * 0.5 * NB) | 0;
      if (bi < 0) bi = 0;
      else if (bi > NB - 1) bi = NB - 1;
      const st = noise.value1(s * invStreak + bi * 7.31 + seedOff);
      const sn = s / L;
      // Surface the brush meets: canvas weave (filled in as paint builds), old ridges, and
      // short dashes along each bristle so breakup runs with the stroke, not in a grid.
      const h0 = height[idx];
      const dash = noise.value1(s * invDash + bi * 13.1 + seedOff * 0.7);
      const px = idx % W;
      const py = (idx / W) | 0;
      const blot = noise.noise2(px * 0.11 + seedOff, py * 0.11) * 0.5 + 0.5;
      const weave = tooth[idx] * Math.exp(-h0 * 12);
      const z = 0.35 * weave + 0.4 * dash + 0.25 * blot + (h0 > 0.5 ? 0.4 : h0 * 0.8);
      let a;
      let ld;
      if (isKnife) {
        ld = load0 * Math.exp(-s / deplete);
        // The blade rides higher as it empties, catching only the high points: irregular skips.
        const island = noise.noise2(px * 0.03 - seedOff, py * 0.03 + seedOff) * 0.5 + 0.5;
        const plane = -0.3 + (1 - ld) * 1.25 + (island - 0.5) * 0.6;
        a = c01((weave * 0.25 + blot * 0.3 + island * 0.45 + (h0 > 0.4 ? 0.3 : h0) - plane) * 6);
      } else {
        ld = load0 * BL[bi] * Math.exp(-s / deplete) * (0.85 + 0.3 * st);
        a = c01(5 * (ld + 0.55 * z - tau));
      }
      // Ragged anti-aliased edge (pixels), bristles that run out early at the tail.
      const edge = c01((1 - atn) * wv + rag * (st - 0.5) + 0.5);
      const endB = L * (1 - 0.14 * BE[bi]);
      const tail = c01((endB - s) * 0.5 + 0.5);
      a *= edge * tail * alphaMax;
      if (breaks > 0) a *= c01(1.6 * noise.value1(s * 0.02 + seedOff * 3) + 0.6 - breaks * 1.4);
      if (clip && !clip[idx]) a *= clipKeep;
      if (a < 0.002) continue;
      painted++;
      // Colour on the brush: mostly the mix, some bristles carrying the second note.
      const mixC = BC[bi] * c01((dash - 0.3) * 2.5);
      const vjit = 1 + (st - 0.5) * vj;
      let cr = (color[0] + (color2[0] - color[0]) * mixC) * vjit;
      let cg = (color[1] + (color2[1] - color[1]) * mixC) * vjit;
      let cb = (color[2] + (color2[2] - color[2]) * mixC) * vjit;
      // Pickup: the brush drags what it has crossed.
      const pk = pickup * c01(sn * 3) * (1 - ld * 0.5);
      if (pk > 0) {
        const fr = sn * (nRes - 1);
        const r0 = Math.min(nRes - 2, fr | 0);
        const ft = fr - r0;
        const o0 = r0 * 3;
        cr += (res[o0] + (res[o0 + 3] - res[o0]) * ft - cr) * pk;
        cg += (res[o0 + 1] + (res[o0 + 4] - res[o0 + 1]) * ft - cg) * pk;
        cb += (res[o0 + 2] + (res[o0 + 5] - res[o0 + 2]) * ft - cb) * pk;
      }
      const o = idx * 3;
      // Wet-into-wet: as the brush empties it pushes the paint already there.
      const wm = wet * (1 - c01(ld));
      cr += (paint[o] - cr) * wm;
      cg += (paint[o + 1] - cg) * wm;
      cb += (paint[o + 2] - cb) * wm;
      paint[o] += (cr - paint[o]) * a;
      paint[o + 1] += (cg - paint[o + 1]) * a;
      paint[o + 2] += (cb - paint[o + 2]) * a;
      // Thickness: lips at the edges, a pile where the brush lifts, grooves between bristles.
      let dep;
      if (isKnife) {
        const lip = 1 + 0.7 * c01((atn - 0.86) * 7);
        dep = thick * lip;
        height[idx] = h0 + (dep - h0) * a * 0.85;
      } else {
        // A soft lip inside the edge, thinning to nothing at the very edge.
        const ridge = (0.88 + 0.18 * c01((atn - 0.5) * 2.5)) * c01((1.02 - atn) * 5);
        const pile = 1 + 0.45 * c01((sn - 0.86) * 7);
        dep = thick * c01(ld) * ridge * pile * (0.7 + 0.6 * st);
        height[idx] = h0 * (1 - a * plow) + a * dep;
      }
      const gl = gloss[idx];
      gloss[idx] = gl + (glossAmt - gl) * a;
      const op = opacity[idx];
      opacity[idx] = op + (1 - op) * a * filmOp;
    }
    this.pixels += count;
    this.count++;
    return painted;
  }
}
