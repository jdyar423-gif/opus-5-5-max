// The painting, pass by pass: big masses first, then the sky and sea in long wet sweeps
// and knife drags, the stones and the long shadow, the spray, the flock in single strokes,
// the rider and his bicycle built up from loose to exact, rim lights, lost edges.
import { OBJ } from '../scene/objects.js';
import { mixPaint, linearToOklab } from '../lib/color.js';
import { rngFor } from '../lib/rng.js';
import { RefSampler, trace, jitter, shiftL, lerpColor, forCells, canvasColor, colorDiff, edgeField } from './strokes.js';

const set = (...a) => new Set(a);
const SKYS = set(OBJ.SKY, OBJ.SUN);
const SEA = set(OBJ.SEA);
const PAVE = set(OBJ.PAVEMENT);
const STONE = set(OBJ.STONE);
const SPRAY = set(OBJ.SPRAY);
const RIDER = set(OBJ.PLUMAGE, OBJ.HEAD, OBJ.BILL, OBJ.POUCH, OBJ.EYE, OBJ.FEET);
const BIKE = set(OBJ.BIKE, OBJ.SPOKE, OBJ.TIRE, OBJ.RUST);
const FLOCK = set(OBJ.FLOCK);
const FIGURE = new Set([...RIDER, ...BIKE]);
const PRECISE = set(OBJ.HEAD, OBJ.BILL, OBJ.POUCH, OBJ.EYE, OBJ.FEET);

// Which mass a class belongs to (lay-in strokes stay inside their mass).
function massOf(o) {
  if (SKYS.has(o)) return SKYS;
  if (SEA.has(o)) return SEA;
  if (PAVE.has(o) || STONE.has(o)) return new Set([...PAVE, ...STONE]);
  if (SPRAY.has(o)) return set(OBJ.SPRAY, OBJ.SEA, OBJ.SKY);
  if (FLOCK.has(o)) return SKYS; // the flock is laid in as sky; birds are drawn later
  return FIGURE;
}

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const L_OF = (c) => linearToOklab(Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2]))[0];

export function paintAll({ ctx, ref, canvas, painter, region, scene, until = null }) {
  const S = new RefSampler(ref, { sky: SKYS, sea: new Set([...SEA, ...SPRAY]), ground: new Set([...PAVE, ...STONE]), figure: FIGURE, flock: FLOCK });
  const massName = (o) => (SKYS.has(o) || FLOCK.has(o) ? 'sky' : SEA.has(o) || SPRAY.has(o) ? 'sea' : PAVE.has(o) || STONE.has(o) ? 'ground' : 'figure');
  const figureMask = S.mask(FIGURE);
  const bikeMask = S.mask(BIKE);
  const groundMask = S.mask(new Set([...SKYS, ...SEA, ...PAVE, ...STONE, ...SPRAY, ...FLOCK])); // all but the figure
  const objMasks = new Map();
  const maskOf = (o) => {
    if (!objMasks.has(o)) objMasks.set(o, S.mask(set(o)));
    return objMasks.get(o);
  };
  const mm = canvas.pxPerMM;
  const px = (v) => v * mm; // millimetres -> pixels
  const seed = ctx.seed;
  const H = ctx.H;
  const W = canvas.w;
  const Hc = canvas.h;
  const { camera, L } = ctx;
  const toRegion = (p) => [p[0] * H - region.x0, p[1] * H - region.y0];
  const horizonY = L.horizon * H - region.y0;
  const vp = [L.vpX * H - region.x0, horizonY];
  const sunP = toRegion(camera.project([0, Math.sin((L.sun.elevationDeg * Math.PI) / 180) * 1e6, 1e6]));
  const sunR = L.sun.radius * H;
  const depthF = (y) => Math.max(0, Math.min(1, (y + region.y0 - L.horizon * H) / (H * (1 - L.horizon))));
  const rider = scene.rider.landmarks;
  const headP = toRegion(camera.project(rider.head));
  const cc = [0, 0, 0];
  const cr = [0, 0, 0];
  const stroke = (o) => painter.stroke(o);
  const stats = {};
  const tick = (name, t0) => (stats[name] = { strokes: painter.count, ms: Date.now() - t0 });
  const stop = (name) => until === name;

  // ---------------------------------------------------------------- 1. lay-in
  let t0 = Date.now();
  {
    const half = { [OBJ.SKY]: 24, [OBJ.SUN]: 14, [OBJ.SEA]: 15, [OBJ.PAVEMENT]: 14, [OBJ.STONE]: 9, [OBJ.SPRAY]: 12, [OBJ.FLOCK]: 20 };
    forCells({ region, spacing: px(13), margin: px(120), seed, pass: 1 }, (x, y, rng) => {
      const o = S.obj(x, y);
      const hw = px(half[o] ?? 6) * rng.range(0.8, 1.2);
      if (!rng.chance(Math.min(1, (px(13) / (2 * hw)) * 1.6))) return;
      const objs = massOf(o);
      const pts = trace(S, x, y, { step: Math.max(2, hw * 0.6), maxLen: hw * rng.range(4, 9), sigma: hw, maxDiff: 0.45, minLen: hw, objs, curl: 0.2 });
      const c = shiftL(jitter(S.color(x, y, hw, cc, massName(o)), rng, { value: 0.02, temp: 0.012 }), -0.025);
      stroke({ ctrl: pts, width: hw, color: c, alpha: 0.75, thick: 0.028, wet: 0.35, dry: 0.35, load: 0.75, pickup: 0.3, taper: [0.05, 0.25], seed: rng.int(0, 1e9) });
    });
  }
  tick('layin', t0);
  if (stop('layin')) return stats;

  // ---------------------------------------------------------------- 2. sky
  t0 = Date.now();
  // Long double-loaded sweeps, wet into wet; arcs around the sun settle into horizontals.
  forCells({ region, spacing: px(15), margin: px(250), seed, pass: 2 }, (x, y, rng) => {
    if (!SKYS.has(S.obj(x, y))) return;
    const hw = px(rng.range(9, 15));
    const maxLen = px(rng.range(110, 340));
    const pts = trace(S, x, y, { step: Math.max(3, hw * 0.5), maxLen, sigma: hw, maxDiff: 0.65, minLen: maxLen * 0.45, objs: SKYS, curl: 0.05, dir0: [rng.chance(0.5) ? 1 : -1, 0] });
    const c1 = jitter(S.color(x, y - hw * 0.55, hw * 0.6, cc, 'sky'), rng, { value: 0.008, temp: 0.006 });
    const c2 = jitter(S.color(x, y + hw * 0.55, hw * 0.6, cr, 'sky'), rng, { value: 0.008, temp: 0.006 });
    const thick = 0.045 + 0.09 * Math.min(1, lum(c1) * 1.5);
    stroke({ ctrl: pts, width: hw, color: c1, color2: c2, streakMix: 0.35, alpha: 0.92, thick, wet: 0.4, pickup: 0.42, dry: 0.12, load: 1, taper: [0.16, 0.34], mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
  });
  // Cloud streaks: long, narrower strokes laid along the stratus where the sweeps lost it.
  forCells({ region, spacing: px(5), margin: px(160), seed, pass: 60 }, (x, y, rng) => {
    if (!SKYS.has(S.obj(x, y))) return;
    const hw = px(rng.range(2.2, 4.6));
    const target = S.color(x, y, hw * 0.5, cc, 'sky');
    if (colorDiff(target, canvasColor(canvas, S.idx(x, y), cr)) < 0.075) return;
    const maxLen = px(rng.range(50, 210));
    const pts = trace(S, x, y, { step: Math.max(2, hw * 0.6), maxLen, sigma: hw * 0.5, maxDiff: 0.085, minLen: hw * 7, objs: SKYS, curl: 0.05, dir0: [rng.chance(0.5) ? 1 : -1, 0] });
    stroke({ ctrl: pts, width: hw, color: jitter(target, rng, { value: 0.006, temp: 0.005 }), alpha: 0.82, thick: 0.05, wet: 0.3, pickup: 0.3, dry: 0.2, taper: [0.2, 0.35], mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
  });
  // Refine: correct values where the sweeps wandered.
  forCells({ region, spacing: px(6), margin: px(40), seed, pass: 3 }, (x, y, rng) => {
    if (!SKYS.has(S.obj(x, y))) return;
    const hw = px(rng.range(4, 8));
    const target = S.color(x, y, hw * 0.6, cc, 'sky');
    const now = canvasColor(canvas, S.idx(x, y), cr);
    if (colorDiff(target, now) < 0.13) return;
    const pts = trace(S, x, y, { step: Math.max(2, hw * 0.6), maxLen: px(rng.range(40, 130)), sigma: hw * 0.6, maxDiff: 0.16, minLen: hw * 5, objs: SKYS, curl: 0.08 });
    stroke({ ctrl: pts, width: hw, color: jitter(target, rng, { value: 0.008, temp: 0.006 }), alpha: 0.85, thick: 0.06, wet: 0.28, pickup: 0.25, dry: 0.15, mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
  });
  // Haze strata hugging the horizon.
  {
    const rng = rngFor(seed, 4);
    for (let i = 0; i < 70; i++) {
      const y = horizonY - px(rng.range(1, 45)) * Math.pow(rng.next(), 0.6);
      const x = rng.range(-px(100), W + px(100));
      if (y < 0 || y > Hc) continue;
      if (!SKYS.has(S.obj(Math.max(0, Math.min(W - 1, x)), y))) continue;
      const len = px(rng.range(80, 260));
      const hw = px(rng.range(1.5, 4));
      const c = S.color(Math.max(0, Math.min(W - 1, x)), y, px(5), cc, 'sky');
      stroke({ ctrl: [[x - len / 2, y + rng.normal()], [x, y + rng.normal() * 2], [x + len / 2, y + rng.normal()]], width: hw, color: jitter(c, rng, { value: 0.008, temp: 0.01 }), alpha: 0.45, thick: 0.04, wet: 0.5, pickup: 0.45, dry: 0.2, taper: [0.2, 0.35], mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
    }
  }
  // Palette-knife drags in the glow and the cloud bands, kept clear of the head.
  {
    const rng = rngFor(seed, 5);
    for (let i = 0; i < 12; i++) {
      const nearSun = rng.chance(0.7);
      let x;
      let y;
      if (nearSun) {
        x = sunP[0] + rng.normal() * px(160);
        y = sunP[1] - Math.abs(rng.normal()) * px(120) - px(10);
      } else {
        x = rng.range(0, W);
        y = rng.range(0, horizonY - px(20));
      }
      if (x < 0 || x >= W || y < 0 || y >= horizonY) continue;
      if (!SKYS.has(S.obj(x, y))) continue;
      if (Math.hypot(x - headP[0], y - headP[1]) < px(110)) continue;
      const len = px(rng.range(60, 170));
      const hw = px(rng.range(5, 10));
      const ang = rng.normal() * 0.04;
      const c = shiftL(S.color(x, y, px(5), cc, 'sky'), 0.004);
      const ex = Math.cos(ang) * len;
      const ey = Math.sin(ang) * len;
      stroke({ kind: 'knife', ctrl: [[x, y], [x + ex, y + ey]], width: hw, color: jitter(c, rng, { value: 0.006, temp: 0.008 }), alpha: 0.9, thick: 0.18, load: 0.95, deplete: len * rng.range(0.35, 0.7), pickup: 0.55, mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
    }
  }
  // The sun: a few short, heavily loaded horizontal pulls of near-white (not swirls: their
  // ridges would read as a whorl under the gallery light), veiled by haze across its foot.
  {
    const rng = rngFor(seed, 6);
    const core = S.color(sunP[0], sunP[1], 1, cc).slice();
    for (let i = 0; i < 4; i++) {
      const y = sunP[1] + sunR * (i / 3 - 0.5) * 1.1 + rng.normal() * sunR * 0.06;
      const half = sunR * Math.sqrt(Math.max(0.05, 1 - ((y - sunP[1]) / (sunR * 0.95)) ** 2)) * rng.range(0.75, 0.95);
      const x = sunP[0] + rng.normal() * sunR * 0.08;
      stroke({ ctrl: [[x - half, y], [x + half, y + rng.normal() * sunR * 0.04]], width: sunR * rng.range(0.24, 0.32), color: shiftL(core, 0.02), alpha: 1, thick: 0.55, wet: 0.12, dry: 0.12, taper: [0.25, 0.3], mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
    }
    for (let i = 0; i < 2; i++) {
      const y = sunP[1] + sunR * rng.range(0.35, 0.8);
      const c = S.color(sunP[0], sunP[1] + sunR * 1.6, px(2), cr);
      stroke({ ctrl: [[sunP[0] - sunR * 3, y], [sunP[0] + sunR * 3, y + rng.normal()]], width: sunR * 0.22, color: c, alpha: 0.45, thick: 0.05, wet: 0.5, pickup: 0.5, mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
    }
    for (let i = 0; i < 40; i++) {
      const a = rng.range(Math.PI * 0.95, Math.PI * 2.05);
      const r = sunR * rng.range(1.25, 3.5);
      const x = sunP[0] + Math.cos(a) * r;
      const y = sunP[1] + Math.sin(a) * r * 0.85;
      if (y > horizonY - 1) continue;
      // Arcs that turn with the aureole, close in value to it: the glow is swept round, not rayed.
      const len = px(rng.range(25, 70));
      const da = len / (2 * r);
      const arc = [];
      for (let k = 0; k <= 6; k++) {
        const ak = a - da + (2 * da * k) / 6;
        arc.push([sunP[0] + Math.cos(ak) * r, Math.min(horizonY - 1, sunP[1] + Math.sin(ak) * r * 0.85)]);
      }
      const c = shiftL(S.color(x, y, px(1.5), cr), 0.008);
      stroke({ ctrl: arc, width: px(rng.range(1.5, 3.2)), color: c, alpha: 0.6, thick: 0.12, wet: 0.35, pickup: 0.3, taper: [0.25, 0.35], mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
    }
  }
  tick('sky', t0);
  if (stop('sky')) return stats;

  // ---------------------------------------------------------------- 3. sea
  t0 = Date.now();
  // Zorn water: long horizontal strokes, wider toward us, with a gentle undulation;
  // dark wave faces and sky reflections alternate.
  forCells({ region, spacing: px(6), margin: px(180), seed, pass: 7 }, (x, y, rng) => {
    if (!SEA.has(S.obj(x, y))) return;
    const f = depthF(y);
    const hw = px(1.2 + 16 * Math.pow(f, 0.9)) * rng.range(0.8, 1.2);
    const len = hw * rng.range(6, 12);
    if (!rng.chance(Math.min(1, ((px(6) * px(6)) / (hw * len)) * 3.2))) return;
    const phase = rng.range(0, 6.28);
    const n = 6;
    const ctrl = [];
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1) - 0.5;
      ctrl.push([x + t * len, y + 0.3 * hw * Math.sin((2 * Math.PI * (t * len)) / (4 * hw) + phase)]);
    }
    const c = jitter(S.color(x, y, hw * 0.7, cc, 'sea'), rng, { value: 0.015, temp: 0.008 });
    stroke({ ctrl, width: hw, color: c, color2: S.color(x, y + hw * 0.8, hw * 0.5, cr, 'sea'), streakMix: 0.3, alpha: 0.9, thick: 0.05 + 0.06 * Math.min(1, lum(c) * 2), wet: 0.22, pickup: 0.28, dry: 0.2, taper: [0.1, 0.25], mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
  });
  forCells({ region, spacing: px(4), margin: px(30), seed, pass: 8 }, (x, y, rng) => {
    if (!SEA.has(S.obj(x, y))) return;
    const f = depthF(y);
    const hw = px(0.9 + 5 * f);
    const target = S.color(x, y, hw * 0.6, cc, 'sea');
    if (colorDiff(target, canvasColor(canvas, S.idx(x, y), cr)) < 0.08) return;
    const len = hw * rng.range(5, 10);
    stroke({ ctrl: [[x - len / 2, y], [x + len / 2, y + rng.normal() * hw * 0.2]], width: hw, color: jitter(target, rng, { value: 0.01, temp: 0.006 }), alpha: 0.85, thick: 0.05, wet: 0.2, dry: 0.25, mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
  });
  // Glitter: clustered impasto flecks along wave crests, brightest and thickest last.
  {
    const gold = mixPaint({ W: 0.86, O: 0.13, V: 0.01 });
    const silver = mixPaint({ W: 0.97, O: 0.025, K: 0.002 });
    const flecks = [];
    for (let y = horizonY + 1; y < Hc; ) {
      const f = depthF(y);
      const rowRng = rngFor(seed, 9, Math.round(y + region.y0));
      const stepX = Math.max(1.5, px(1 + 6 * f));
      for (let x = rowRng.range(0, stepX); x < W; x += stepX * rowRng.range(0.6, 1.4)) {
        if (!SEA.has(S.obj(x, y)) && !SPRAY.has(S.obj(x, y))) continue;
        const g = ref.glint[S.idx(x, y)];
        if (g < 0.04) continue;
        if (!rowRng.chance(Math.min(0.9, 0.55 * Math.pow(g, 0.6)))) continue;
        const kids = rowRng.int(1, 4);
        for (let k = 0; k < kids; k++) {
          const wd = px(0.45 + 3.2 * f) * rowRng.range(0.6, 1.3);
          flecks.push({ x: x + rowRng.normal() * wd * 3, y: y + rowRng.normal() * wd * 0.5, wd, g, f, seed: rowRng.int(0, 1e9), knife: rowRng.chance(0.07), silver: rowRng.chance(0.3) });
        }
      }
      y += Math.max(1.5, 0.06 * (y - horizonY) + 1);
    }
    flecks.sort((a, b) => a.g - b.g);
    for (const fl of flecks) {
      const rng = rngFor(fl.seed, 1);
      const len = fl.wd * rng.range(2.5, 7) * (fl.knife ? 1.6 : 1);
      const base = fl.silver ? silver : gold;
      const c = lerpColor(S.color(fl.x, fl.y, 1, cc), base, Math.min(1, 0.45 + fl.g * 0.5));
      stroke({ kind: fl.knife ? 'knife' : 'brush', ctrl: [[fl.x - len / 2, fl.y], [fl.x + len / 2, fl.y + rng.normal() * fl.wd * 0.3]], width: fl.wd, color: c, alpha: 1, thick: 0.45 + 0.7 * Math.min(1, fl.g), wet: 0.05, dry: 0.15, rag: 0.6, taper: [0.15, 0.35], mask: groundMask, maskHard: 0.9, seed: fl.seed });
    }
    stats.glitter = flecks.length;
  }
  tick('sea', t0);
  if (stop('sea')) return stats;

  // ---------------------------------------------------------------- 4. slabs and stones
  t0 = Date.now();
  forCells({ region, spacing: px(6), margin: px(90), seed, pass: 10 }, (x, y, rng) => {
    if (!PAVE.has(S.obj(x, y))) return;
    const f = depthF(y);
    const hw = px(1.2 + 12 * Math.pow(f, 1.1)) * rng.range(0.8, 1.25);
    const len = hw * rng.range(4, 8);
    if (!rng.chance(Math.min(1, ((px(6) * px(6)) / (hw * len)) * 3))) return;
    const across = rng.chance(0.28);
    const pts = trace(S, x, y, { step: Math.max(2, hw * 0.5), maxLen: len, sigma: hw * 0.6, maxDiff: 0.2, minLen: hw, objs: PAVE, curl: 0.1, angleOffset: across ? Math.PI / 2 : 0 });
    const c = jitter(S.color(x, y, hw * 0.6, cc, 'ground'), rng, { value: 0.025, temp: 0.012 });
    const lightness = Math.min(1, lum(c) * 2.5);
    stroke({ ctrl: pts, width: hw, color: c, alpha: 0.85, thick: 0.03 + 0.07 * lightness, wet: 0.25, dry: 0.45 + 0.2 * (1 - lightness), load: 0.85, pickup: 0.3, mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
  });
  forCells({ region, spacing: px(3.5), margin: px(40), seed, pass: 11 }, (x, y, rng) => {
    const o = S.obj(x, y);
    if (!STONE.has(o) && !PAVE.has(o)) return;
    const f = depthF(y);
    const hw = px(0.7 + 4.5 * f) * rng.range(0.8, 1.2);
    const target = S.color(x, y, hw * 0.5, cc, 'ground');
    const err = colorDiff(target, canvasColor(canvas, S.idx(x, y), cr));
    if (err < (STONE.has(o) ? 0.07 : 0.15)) return;
    const pts = trace(S, x, y, { step: Math.max(1.5, hw * 0.5), maxLen: hw * rng.range(2, 4.5), sigma: hw * 0.5, maxDiff: 0.15, minLen: hw * 0.5, objs: STONE.has(o) ? STONE : PAVE, curl: 0.05, angleOffset: rng.chance(0.4) ? Math.PI / 2 : 0 });
    stroke({ ctrl: pts, width: hw, color: jitter(target, rng, { value: 0.015, temp: 0.01 }), alpha: 0.9, thick: 0.06, wet: 0.15, dry: 0.3, caps: STONE.has(o) ? 'flat' : undefined, mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
  });
  // Sun-caught edges of the coping stones: small, loaded, decisive.
  forCells({ region, spacing: px(2.5), margin: px(10), seed, pass: 12 }, (x, y, rng) => {
    const i = S.idx(x, y);
    if (!STONE.has(ref.obj[i]) || ref.light[i] < 0.3) return;
    if (!rng.chance(0.5)) return;
    const hw = px(rng.range(0.5, 1.4));
    const len = hw * rng.range(3, 7);
    const a = S.angle(x, y);
    const c = shiftL(S.color(x, y, 0.8, cc), 0.05);
    stroke({ ctrl: [[x - (Math.cos(a) * len) / 2, y - (Math.sin(a) * len) / 2], [x + (Math.cos(a) * len) / 2, y + (Math.sin(a) * len) / 2]], width: hw, color: c, alpha: 1, thick: 0.4, wet: 0.05, mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
  });
  tick('stones', t0);
  if (stop('stones')) return stats;

  // ---------------------------------------------------------------- 5. spray
  t0 = Date.now();
  forCells({ region, spacing: px(3.5), margin: px(60), seed, pass: 13 }, (x, y, rng) => {
    const i = S.idx(x, y);
    if (ref.spray[i] < 0.45) return;
    // Broken dabs and flicks along the droplets' paths: water, not rays.
    const hw = px(rng.range(0.6, 2.4)) * (0.6 + 0.6 * ref.spray[i]);
    const len = hw * rng.range(1.2, ref.spray[i] > 0.8 && rng.chance(0.25) ? 6 : 3);
    const a = S.angle(x, y) + rng.normal() * 0.35;
    const c = shiftL(S.color(x, y, hw * 0.5, cc), 0.03);
    stroke({ ctrl: [[x - Math.cos(a) * len * 0.5, y - Math.sin(a) * len * 0.5], [x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5]], width: hw, color: c, alpha: 0.95, thick: 0.3 + 0.5 * ref.spray[i], wet: 0.1, dry: 0.55, load: 0.85, rag: 0.9, taper: [0.2, 0.4], mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
  });
  forCells({ region, spacing: px(12), margin: px(60), seed, pass: 14 }, (x, y, rng) => {
    const i = S.idx(x, y);
    if (ref.spray[i] < 0.15) return;
    const hw = px(rng.range(7, 14));
    const len = px(rng.range(30, 90));
    const c = S.color(x, y, px(8), cc);
    stroke({ ctrl: [[x - len / 2, y + rng.normal() * hw], [x + len / 2, y + rng.normal() * hw]], width: hw, color: c, alpha: 0.16, thick: 0.02, wet: 0.5, pickup: 0.5, dry: 0.3, mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
  });
  tick('spray', t0);
  if (stop('spray')) return stats;

  // ---------------------------------------------------------------- 6. the long shadow
  t0 = Date.now();
  forCells({ region, spacing: px(4), margin: px(60), seed, pass: 15 }, (x, y, rng) => {
    const i = S.idx(x, y);
    if (ref.shadow[i] < 0.22 || !PAVE.has(ref.obj[i])) return;
    const f = depthF(y);
    const hw = px(1.2 + 6 * f) * rng.range(0.8, 1.2);
    const len = px(rng.range(15, 55));
    const ax = x - vp[0];
    const ay = y - vp[1];
    const al = Math.hypot(ax, ay) || 1;
    const c = jitter(S.color(x, y, hw * 0.5, cc, 'ground'), rng, { value: 0.015, temp: 0.008 });
    stroke({ ctrl: [[x - (ax / al) * len * 0.3, y - (ay / al) * len * 0.3], [x + (ax / al) * len * 0.7, y + (ay / al) * len * 0.7]], width: hw, color: c, alpha: 0.75, thick: 0.03, wet: 0.3, dry: 0.5, load: 0.8, mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
  });
  // Corrections on the ground: put back the joints, the coping edges and the shape of the
  // cast shadow where the broad strokes smeared them. Strokes run along the local edges.
  {
    const GROUND = new Set([...PAVE, ...STONE]);
    for (const [hwMM, thr, pass] of [[2.6, 0.1, 62], [1.3, 0.12, 63]]) {
      const hw0 = Math.max(0.6, px(hwMM));
      const spacing = Math.max(1.6, hw0 * 1.6);
      const field = edgeField(S, hw0 * 0.6, 0.012);
      forCells({ region, spacing, margin: hw0 * 6, seed, pass }, (x, y, rng) => {
        let best = -1;
        let bx = 0;
        let by = 0;
        for (let k = 0; k < 3; k++) {
          const sx = x + rng.range(-0.5, 0.5) * spacing;
          const sy = y + rng.range(-0.5, 0.5) * spacing;
          if (sx < 0 || sy < 0 || sx >= W || sy >= Hc || !GROUND.has(S.obj(sx, sy))) continue;
          const e = colorDiff(S.color(sx, sy, hw0 * 0.4, cc, 'ground'), canvasColor(canvas, S.idx(sx, sy), cr));
          if (e > best) {
            best = e;
            bx = sx;
            by = sy;
          }
        }
        if (best < thr) return;
        const hw = hw0 * (0.6 + 0.6 * depthF(by)) * rng.range(0.85, 1.15);
        const target = S.color(bx, by, hw * 0.4, cc, 'ground');
        const pts = trace(S, bx, by, { step: Math.max(1.2, hw * 0.55), maxLen: hw * rng.range(3, 8), sigma: hw * 0.4, maxDiff: 0.1, minLen: hw, objs: GROUND, curl: 0.2, field });
        stroke({ ctrl: pts, width: hw, color: jitter(target, rng, { value: 0.01, temp: 0.006 }), alpha: 0.9, thick: 0.05, wet: 0.12, dry: 0.3, rag: 0.35, taper: [0.1, 0.25], mask: groundMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
      });
    }
  }
  tick('shadow', t0);
  if (stop('shadow')) return stats;

  // ---------------------------------------------------------------- 7. flock
  t0 = Date.now();
  const flockMask = S.mask(FLOCK);
  const birds = [...scene.flock.birds].sort((a, b) => b.index - a.index);
  for (const b of birds) {
    const rng = rngFor(seed, 16, b.index);
    const P = (x, y, z) => toRegion(camera.project(b.xf.p(x, y, z)));
    const body = P(0, 0.02, 0);
    const spanPx = b.span * H;
    if (b.index <= 1) {
      // The two nearest birds are painted from life, small and exact, inside their silhouettes.
      const x0 = body[0] - spanPx * 0.6;
      const x1 = body[0] + spanPx * 0.6;
      const y0 = body[1] - spanPx * 0.25;
      const y1 = body[1] + spanPx * 0.25;
      for (const [lv, hwMM] of [[0, 1.3], [1, 0.7], [2, 0.42]]) {
        const hw0 = Math.max(0.5, px(hwMM));
        const spacing = Math.max(1.4, hw0 * 1.6);
        for (let y = y0; y < y1; y += spacing) {
          for (let x = x0; x < x1; x += spacing) {
            const r2 = rngFor(seed, 17, b.index * 10 + lv, Math.round((x + region.x0) / spacing), Math.round((y + region.y0) / spacing));
            const sx = x + r2.next() * spacing;
            const sy = y + r2.next() * spacing;
            if (sx < 0 || sy < 0 || sx >= W || sy >= Hc || !FLOCK.has(S.obj(sx, sy))) continue;
            const target = S.color(sx, sy, hw0 * 0.4, cc, 'flock');
            if (colorDiff(target, canvasColor(canvas, S.idx(sx, sy), cr)) < 0.05) continue;
            const pts = trace(S, sx, sy, { step: Math.max(1, hw0 * 0.6), maxLen: hw0 * r2.range(2, 5), sigma: hw0 * 0.4, maxDiff: 0.2, minLen: hw0, objs: FLOCK, curl: 0.3 });
            stroke({ ctrl: pts, width: hw0, color: target, alpha: 0.96, thick: 0.08, wet: 0.12, dry: 0.15, rag: 0.25, mask: flockMask, maskHard: 0.85, seed: r2.int(0, 1e9) });
          }
        }
      }
    } else {
      // Distant birds: one stroke per wing from the body out, loaded at the root, dry at the tip.
      const bodyCol = S.color(body[0], body[1], 0.7, cc, 'flock').slice();
      const root = Math.max(0.6, spanPx * 0.012);
      for (const side of [1, -1]) {
        const ctrl = [body, P(0.13, 0.08, side * 0.4), P(0.16, 0.07, side * 0.68), P(0.02, -0.05, side * 1.02)];
        stroke({ ctrl, width: [root, root * 0.85, root * 0.6, root * 0.22], color: bodyCol, alpha: 0.95, thick: 0.12, wet: 0.12 + 0.06 * b.index, dry: 0.3, load: 1, deplete: spanPx * 1.1, rag: 0.3, taper: [0, 0.3], seed: rng.int(0, 1e9) });
      }
      stroke({ ctrl: [P(-0.18, 0.0, 0), P(0.05, 0.03, 0), P(0.26, 0.12, 0)], width: Math.max(0.6, spanPx * 0.03), color: bodyCol, alpha: 0.95, thick: 0.13, wet: 0.1, taper: [0.2, 0.3], seed: rng.int(0, 1e9) });
    }
    // Burning edges: a broken pale-gold line along the upper edge of each wing.
    const rimC = shiftL(S.color(body[0], body[1] - spanPx * 0.08, 2, cr, 'sky'), 0.025);
    for (const side of [1, -1]) {
      const ctrl = [P(0.15, 0.12, side * 0.18), P(0.14, 0.13, side * 0.42), P(0.18, 0.11, side * 0.66)];
      stroke({ ctrl, width: Math.max(0.45, spanPx * 0.0045), color: rimC, alpha: 0.5 - b.index * 0.05, thick: 0.08, wet: 0.08, breaks: 0.45, seed: rng.int(0, 1e9) });
    }
    // The glare eats the farthest birds.
    if (b.index >= 3) {
      const veil = S.color(body[0], body[1] - spanPx * 0.1, px(4), cr, 'sky');
      stroke({ ctrl: [[body[0] - spanPx * 0.6, body[1]], [body[0] + spanPx * 0.6, body[1] + 1]], width: spanPx * 0.12, color: veil, alpha: 0.08 + 0.04 * (b.index - 3), thick: 0.02, wet: 0.5, pickup: 0.5, seed: rng.int(0, 1e9) });
    }
  }
  tick('flock', t0);
  if (stop('flock')) return stats;

  // ---------------------------------------------------------------- 8. rider and bicycle
  t0 = Date.now();
  const levels = [
    { hw: 4.2, thr: 0.09, objs: FIGURE, len: [3, 6], pass: 20 },
    { hw: 2.3, thr: 0.075, objs: FIGURE, len: [3, 6], pass: 21 },
    { hw: 1.25, thr: 0.06, objs: FIGURE, len: [2.5, 5], pass: 22 },
    { hw: 0.7, thr: 0.05, objs: PRECISE, len: [2, 4.5], pass: 23 },
    { hw: 0.42, thr: 0.045, objs: set(OBJ.EYE, OBJ.HEAD, OBJ.BILL), len: [2, 4], pass: 24 },
  ];
  const projR = (P, r) => {
    const p = camera.project(P);
    return [p[0] * H - region.x0, p[1] * H - region.y0, (camera.f * r * H) / p[2]];
  };
  // Per-channel median of the reference along a polyline: a tube's own colour, unswayed by
  // the light catching one edge or by the sky at its ends.
  const medianAlong = (pts, n) => {
    const ch = [[], [], []];
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      const seg = Math.min(pts.length - 2, Math.floor(f * (pts.length - 1)));
      const t = f * (pts.length - 1) - seg;
      const qx = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t;
      const qy = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t;
      if (qx < 0 || qy < 0 || qx >= W || qy >= Hc || !BIKE.has(S.obj(qx, qy))) continue;
      const q = S.color(qx, qy, 0, cr);
      for (let c = 0; c < 3; c++) ch[c].push(q[c]);
    }
    if (ch[0].length < 2) return null;
    return ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
  };
  // Underpainting for the bicycle where it is large enough to need it: one long stroke per
  // tube and a few arcs per tyre, so the passes below only find the light along the edges
  // (instead of building every tube out of dabs).
  {
    const rng = rngFor(seed, 29);
    for (const prim of scene.bike.prims) {
      if (!prim.ba || prim.mat === 'tyre' || prim.mat === 'rim') continue;
      const a = projR(prim.a, prim.r);
      const b = projR(prim.b, prim.r);
      if (Math.max(a[2], b[2]) <= 3) continue; // thin tubes are drawn after the passes
      const c = medianAlong([a, b], 7);
      if (!c) continue;
      stroke({ ctrl: [[a[0], a[1]], [b[0], b[1]]], width: [a[2] * 0.95, b[2] * 0.95], color: c, alpha: 0.95, thick: 0.07, wet: 0.08, dry: 0.08, rag: 0.15, taper: [0.02, 0.05], caps: 'flat', mask: bikeMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
    }
    for (const ring of ['tyre', 'rim']) {
      const segs = scene.bike.prims.filter((p) => p.mat === ring);
      for (let w0 = 0; w0 < segs.length; w0 += 72) {
        const pts = [];
        let r = 0;
        for (let k = 0; k <= 72; k += 3) {
          const sg = segs[w0 + (k % 72)];
          const p = projR(sg.a, sg.r);
          pts.push([p[0], p[1]]);
          r += p[2];
        }
        r /= pts.length;
        if (r <= 4) continue; // small wheels are drawn after the passes
        for (let arc = 0; arc < 6; arc++) {
          const part = pts.slice(arc * 4, arc * 4 + 5);
          const c = medianAlong(part, 9);
          if (!c) continue;
          stroke({ ctrl: part, width: r * (ring === 'tyre' ? 0.95 : 0.8), color: c, alpha: 0.95, thick: ring === 'tyre' ? 0.08 : 0.06, wet: 0.08, dry: 0.08, rag: 0.15, taper: [0.04, 0.04], mask: bikeMask, maskHard: 0.9, seed: rng.int(0, 1e9) });
        }
      }
    }
  }
  for (const lv of levels) {
    const hw0 = Math.max(0.55, px(lv.hw));
    const spacing = Math.max(1.6, hw0 * 1.7);
    forCells({ region, spacing, margin: hw0 * 8, seed, pass: lv.pass }, (x, y, rng) => {
      // Look at a few points in the cell and paint where the canvas is most wrong.
      let best = -1;
      let bx = 0;
      let by = 0;
      for (let k = 0; k < 4; k++) {
        const sx = x + rng.range(-0.5, 0.5) * spacing;
        const sy = y + rng.range(-0.5, 0.5) * spacing;
        if (sx < 0 || sy < 0 || sx >= W || sy >= Hc) continue;
        if (!lv.objs.has(S.obj(sx, sy))) continue;
        const e = colorDiff(S.color(sx, sy, hw0 * 0.5, cc, 'figure'), canvasColor(canvas, S.idx(sx, sy), cr));
        if (e > best) {
          best = e;
          bx = sx;
          by = sy;
        }
      }
      if (best < lv.thr) return;
      const o = S.obj(bx, by);
      const objs = BIKE.has(o) ? BIKE : PRECISE.has(o) && lv.objs === PRECISE ? PRECISE : FIGURE;
      const hw = hw0 * rng.range(0.85, 1.15);
      // On the bicycle a touch runs the length of the tube or round the tyre, as one pull.
      const onBike = BIKE.has(o);
      const len = onBike ? [6, 14] : lv.len;
      const pts = trace(S, bx, by, { step: Math.max(1.2, hw * 0.55), maxLen: hw * rng.range(len[0], len[1]), sigma: hw * 0.5, maxDiff: 0.14, minLen: hw * 0.6, objs, curl: onBike ? 0.45 : 0.3 });
      const precise = PRECISE.has(o) && lv.objs !== FIGURE;
      const c = jitter(S.color(bx, by, precise ? hw * 0.3 : hw * 0.4, cc, 'figure'), rng, { value: precise ? 0.004 : 0.01, temp: 0.005 });
      const light = ref.light[S.idx(bx, by)];
      const mask = precise ? maskOf(o) : BIKE.has(o) ? bikeMask : figureMask;
      stroke({ ctrl: pts, width: hw, color: c, alpha: 0.96, thick: 0.07 + Math.min(0.5, light * 0.35), wet: 0.12, dry: 0.12, pickup: 0.12, rag: precise ? 0.2 : 0.45, taper: [0.1, 0.25], mask, maskHard: precise ? 1 : 0.92, seed: rng.int(0, 1e9) });
    });
  }
  tick('figure', t0);
  if (stop('figure')) return stats;

  // The bicycle drawn from its true geometry: tubes, tyres, spokes (rigger), chain.
  t0 = Date.now();
  {
    const rng = rngFor(seed, 30);
    // Tubes too thin for the error-driven passes get explicit strokes.
    for (const prim of scene.bike.prims) {
      if (!prim.ba || prim.mat === 'tyre' || prim.mat === 'rim') continue;
      const a = projR(prim.a, prim.r);
      const b = projR(prim.b, prim.r);
      if (Math.max(a[2], b[2]) > 3) continue;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (mid[0] < -50 || mid[1] < -50 || mid[0] > W + 50 || mid[1] > Hc + 50) continue;
      // The tube's own colour: the darkest of a few samples that land on the bicycle.
      let c = null;
      let best = Infinity;
      for (let k = 1; k < 6; k++) {
        const qx = Math.max(0, Math.min(W - 1, a[0] + ((b[0] - a[0]) * k) / 6));
        const qy = Math.max(0, Math.min(Hc - 1, a[1] + ((b[1] - a[1]) * k) / 6));
        if (!BIKE.has(S.obj(qx, qy))) continue;
        const q = S.color(qx, qy, 0, cr);
        if (lum(q) < best) {
          best = lum(q);
          c = q.slice();
        }
      }
      if (!c) continue;
      stroke({ ctrl: [[a[0], a[1]], [b[0], b[1]]], width: [Math.max(0.6, a[2] * 0.95), Math.max(0.6, b[2] * 0.95)], color: c, alpha: 0.95, thick: 0.06, wet: 0.08, rag: 0.2, bristles: 4, taper: [0.02, 0.05], caps: 'flat', mask: bikeMask, maskHard: 0.8, seed: rng.int(0, 1e9) });
    }
    // Tyres and rims as single curved strokes around each wheel.
    for (const ring of ['tyre', 'rim']) {
      const segs = scene.bike.prims.filter((p) => p.mat === ring);
      for (let w0 = 0; w0 < segs.length; w0 += 72) {
        const pts = [];
        let r = 0;
        for (let k = 0; k < 72; k += 3) {
          const s = segs[w0 + k];
          const p = projR(s.a, s.r);
          pts.push([p[0], p[1]]);
          r += p[2];
        }
        pts.push(pts[0]);
        r /= 24;
        if (r > 4) continue;
        const c = S.color(Math.max(0, Math.min(W - 1, pts[0][0])), Math.max(0, Math.min(Hc - 1, pts[0][1])), 0.6, cc);
        for (let half = 0; half < 2; half++) {
          const part = pts.slice(half * 12, half * 12 + 13);
          stroke({ ctrl: part, width: Math.max(0.6, r * (ring === 'tyre' ? 0.95 : 0.8)), color: c, alpha: 0.95, thick: ring === 'tyre' ? 0.07 : 0.05, wet: 0.08, rag: 0.25, breaks: ring === 'rim' ? 0.12 : 0.05, taper: [0.02, 0.02], seed: rng.int(0, 1e9) });
        }
      }
    }
    for (const line of scene.bike.lines) {
      const a = projR(line.a, line.r);
      const b = projR(line.b, line.r);
      const mx = Math.max(0, Math.min(W - 1, (a[0] + b[0]) / 2));
      const my = Math.max(0, Math.min(Hc - 1, (a[1] + b[1]) / 2));
      const glint = ref.light[S.idx(mx, my)];
      const c = S.color(mx, my, 0, cc).slice();
      const w = Math.max(0.42, a[2] * 1.1);
      stroke({ kind: 'rigger', ctrl: [[a[0], a[1]], [b[0], b[1]]], width: w, color: c, alpha: line.kind === 'chain' ? 0.95 : 0.85, thick: 0.03, wet: 0.05, bristles: 3, rag: 0.15, breaks: line.kind === 'spoke' ? 0.32 : 0.1, taper: [0.05, 0.1], seed: rng.int(0, 1e9) });
      if (glint > 0.6 && rng.chance(0.6)) {
        stroke({ kind: 'rigger', ctrl: [[a[0], a[1]], [b[0], b[1]]], width: w * 0.8, color: shiftL(c, 0.06), alpha: 0.6, thick: 0.06, breaks: 0.6, bristles: 2, rag: 0.1, seed: rng.int(0, 1e9) });
      }
    }
  }
  tick('bike', t0);
  if (stop('bike')) return stats;

  // ---------------------------------------------------------------- 9. rim lights
  t0 = Date.now();
  // Thick, loaded touches of light along the burning contours of the rider and bicycle:
  // only where a lit pixel sits on the silhouette, laid along it and kept inside it.
  {
    const near = (x, y, r) => {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]]) {
        const qx = x + dx;
        const qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= W || qy >= Hc) continue;
        if (!figureMask[S.idx(qx, qy)]) return true;
      }
      return false;
    };
    const field = edgeField(S, 1.2, 0.004);
    forCells({ region, spacing: Math.max(1.4, px(1.1)), margin: px(6), seed, pass: 40 }, (x, y, rng) => {
      if (x < 0 || y < 0 || x >= W || y >= Hc) return;
      const i = S.idx(x, y);
      const o = ref.obj[i];
      if (!FIGURE.has(o)) return;
      // Lit by the shading model, or simply brighter than the sky behind it (the fringe of a
      // contour burning against the light is often only a pixel wide in the reference).
      const light = ref.light[i];
      let c = null;
      let cL = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = S.color(Math.min(W - 1, Math.max(0, x + dx)), Math.min(Hc - 1, Math.max(0, y + dy)), 0, cr);
        const qL = L_OF(q);
        if (qL > cL && FIGURE.has(S.obj(x + dx, y + dy))) {
          cL = qL;
          c = q.slice();
        }
      }
      if (!c) return;
      const p = Math.max(light - 0.35, (cL - 0.8) * 3);
      if (p <= 0 || !rng.chance(Math.min(1, p))) return;
      const hw = Math.max(0.5, px(rng.range(0.3, 0.7)));
      if (!near(x, y, Math.max(1.5, hw * 2.5))) return;
      const a = field(x, y);
      const len = hw * rng.range(3, 8);
      c = shiftL(c, 0.02);
      stroke({ ctrl: [[x - (Math.cos(a) * len) / 2, y - (Math.sin(a) * len) / 2], [x + (Math.cos(a) * len) / 2, y + (Math.sin(a) * len) / 2]], width: hw, color: c, alpha: 1, thick: 0.35 + 0.4 * Math.min(1, light), wet: 0.04, dry: 0.1, rag: 0.2, taper: [0.2, 0.3], mask: figureMask, maskHard: 1, seed: rng.int(0, 1e9) });
    });
  }
  tick('rim', t0);
  if (stop('rim')) return stats;

  // ---------------------------------------------------------------- 10. lost edges
  t0 = Date.now();
  {
    // The horizon dissolves into the glare near the sun; the far breakwater melts into it.
    const rng = rngFor(seed, 50);
    for (let i = 0; i < 40; i++) {
      const x = sunP[0] + rng.normal() * px(130);
      const y = horizonY + rng.normal() * px(2.5);
      if (x < 0 || x >= W || y < 0 || y >= Hc) continue;
      const len = px(rng.range(30, 140));
      const c = S.color(x, y, px(5), cc);
      stroke({ ctrl: [[x - len / 2, y], [x + len / 2, y + rng.normal()]], width: px(rng.range(2, 5)), color: c, alpha: 0.5, thick: 0.03, wet: 0.6, pickup: 0.55, dry: 0.15, mask: groundMask, maskHard: 1, seed: rng.int(0, 1e9) });
    }
  }
  {
    // Elsewhere the horizon is found, but not drawn with a ruler: a light, broken softening.
    const rng = rngFor(seed, 51);
    for (let i = 0; i < 26; i++) {
      const x = rng.range(0, W);
      const y = horizonY + rng.normal() * px(1.5);
      if (y < 0 || y >= Hc || Math.abs(x - sunP[0]) < px(150)) continue;
      const len = px(rng.range(40, 120));
      stroke({ ctrl: [[x - len / 2, y], [x + len / 2, y + rng.normal() * 0.5]], width: px(rng.range(1.2, 2.5)), color: S.color(x, y, px(4), cc, 'sea'), alpha: 0.35, thick: 0.02, wet: 0.6, pickup: 0.6, mask: groundMask, maskHard: 1, seed: rng.int(0, 1e9) });
    }
  }
  tick('edges', t0);
  return stats;
}
