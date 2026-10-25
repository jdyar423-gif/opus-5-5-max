// What the painter looks at and how a stroke finds its way: a reference sampler with
// cached blur levels, field tracing, and colour jitter in temperature rather than value.
import { Img, blur, sample, downsample } from '../lib/image.js';
import { linearToOklab, oklabToLinear } from '../lib/color.js';
import { rngFor } from '../lib/rng.js';

export class RefSampler {
  constructor(ref, masses = {}) {
    this.ref = ref;
    this.w = ref.w;
    this.h = ref.h;
    this.levels = new Map();
    // Named masses (sets of object classes) for colour sampling that does not bleed
    // across the silhouettes: normalised convolution of colour x mask by the mask.
    this.masses = masses;
    this.maskCache = new Map();
  }

  static snap(sigma) {
    return sigma < 0.6 ? 0 : Math.round(Math.pow(1.35, Math.round(Math.log(sigma) / Math.log(1.35))) * 100) / 100;
  }

  // Large blurs are computed on a downsampled copy (cheap) and sampled with scaling.
  blurred(img, sigma) {
    if (sigma === 0) return { img, f: 1 };
    const f = sigma >= 16 ? 4 : sigma >= 6 ? 2 : 1;
    const small = f > 1 ? downsample(img, f) : img;
    return { img: blur(small, sigma / f), f };
  }

  level(sigma) {
    const key = RefSampler.snap(sigma);
    if (!this.levels.has(key)) this.levels.set(key, this.blurred(this.ref.color, key));
    return this.levels.get(key);
  }

  massLevel(mass, sigma) {
    const key = `${mass}:${RefSampler.snap(sigma)}`;
    if (this.levels.has(key)) return this.levels.get(key);
    let mask = this.maskCache.get(mass);
    if (!mask) {
      const objs = this.masses[mass];
      mask = new Img(this.w, this.h, 1);
      const masked = new Img(this.w, this.h, 4);
      for (let i = 0; i < this.w * this.h; i++) {
        const m = objs.has(this.ref.obj[i]) ? 1 : 0;
        mask.data[i] = m;
        masked.data[i * 4] = this.ref.color.data[i * 3] * m;
        masked.data[i * 4 + 1] = this.ref.color.data[i * 3 + 1] * m;
        masked.data[i * 4 + 2] = this.ref.color.data[i * 3 + 2] * m;
        masked.data[i * 4 + 3] = m;
      }
      mask = masked;
      this.maskCache.set(mass, mask);
    }
    const sg = Math.max(0.8, RefSampler.snap(sigma));
    const lv = this.blurred(mask, sg);
    const plain = this.level(sigma);
    // Normalise, falling back to the plain blur where the mass is absent.
    const d = lv.img.data;
    const out = new Img(lv.img.w, lv.img.h, 3);
    const pd = plain.f === lv.f ? plain.img.data : null;
    for (let i = 0; i < lv.img.w * lv.img.h; i++) {
      const m = d[i * 4 + 3];
      if (m > 1e-3) {
        out.data[i * 3] = d[i * 4] / m;
        out.data[i * 3 + 1] = d[i * 4 + 1] / m;
        out.data[i * 3 + 2] = d[i * 4 + 2] / m;
      } else if (pd) {
        out.data[i * 3] = pd[i * 3];
        out.data[i * 3 + 1] = pd[i * 3 + 1];
        out.data[i * 3 + 2] = pd[i * 3 + 2];
      }
    }
    const res = { img: out, f: lv.f };
    this.levels.set(key, res);
    return res;
  }

  // Colour at (x, y) blurred by sigma; with `mass`, only that mass contributes.
  color(x, y, sigma, out = [0, 0, 0], mass = null) {
    const lv = mass ? this.massLevel(mass, sigma) : this.level(sigma);
    return sample(lv.img, x / lv.f, y / lv.f, out);
  }

  idx(x, y) {
    const xi = Math.min(this.w - 1, Math.max(0, x | 0));
    const yi = Math.min(this.h - 1, Math.max(0, y | 0));
    return yi * this.w + xi;
  }

  obj(x, y) {
    return this.ref.obj[this.idx(x, y)];
  }

  angle(x, y) {
    return this.ref.angle[this.idx(x, y)];
  }

  // Binary mask (Uint8) of pixels whose class is in `objs`.
  mask(objs) {
    const m = new Uint8Array(this.w * this.h);
    for (let i = 0; i < m.length; i++) m[i] = objs.has(this.ref.obj[i]) ? 1 : 0;
    return m;
  }
}

// Direction along the strongest local edge of the reference (perpendicular to the luminance
// gradient at blur sigma), or the reference's own stroke field where the image is flat.
export function edgeField(S, sigma, minGrad = 0.01) {
  const c = [0, 0, 0];
  const lumAt = (x, y) => {
    S.color(x, y, sigma, c);
    return 0.2126 * Math.sqrt(Math.max(0, c[0])) + 0.7152 * Math.sqrt(Math.max(0, c[1])) + 0.0722 * Math.sqrt(Math.max(0, c[2]));
  };
  const h = Math.max(1, sigma);
  return (x, y) => {
    const gx = lumAt(x + h, y) - lumAt(x - h, y);
    const gy = lumAt(x, y + h) - lumAt(x, y - h);
    if (Math.hypot(gx, gy) < minGrad) return S.angle(x, y);
    return Math.atan2(gy, gx) + Math.PI / 2;
  };
}

// Perceptual-ish distance between linear colours.
export function colorDiff(a, b) {
  return Math.abs(Math.sqrt(a[0]) - Math.sqrt(b[0])) + Math.abs(Math.sqrt(a[1]) - Math.sqrt(b[1])) + Math.abs(Math.sqrt(a[2]) - Math.sqrt(b[2]));
}

/**
 * Follow the stroke-direction field from (x, y). Options: step, maxLen, sigma (colour
 * blur for the stop test), maxDiff, objs (Set of allowed object classes, or null),
 * dir0 (initial direction preference), curl (max turn per step, radians), bothWays.
 */
export function trace(S, x, y, o) {
  const pts = [[x, y]];
  const c0 = S.color(x, y, o.sigma);
  const c = [0, 0, 0];
  // `field` (optional) overrides the reference's stroke-direction map.
  const field = o.field || ((fx, fy) => S.angle(fx, fy));
  let th = field(x, y) + (o.angleOffset || 0);
  let dx = Math.cos(th);
  let dy = Math.sin(th);
  if (o.dir0 && dx * o.dir0[0] + dy * o.dir0[1] < 0) {
    dx = -dx;
    dy = -dy;
  }
  let len = 0;
  let px = x;
  let py = y;
  const curl = o.curl ?? 0.35;
  while (len < o.maxLen) {
    const nx = px + dx * o.step;
    const ny = py + dy * o.step;
    if (nx < -o.step || ny < -o.step || nx > S.w + o.step || ny > S.h + o.step) break;
    // A stroke always reaches its minimum length (a dab, not a dot); past that it stops at
    // other masses and at large colour changes.
    const short = len < (o.minLen || 0);
    if (!short && o.objs && !o.objs.has(S.obj(nx, ny))) break;
    S.color(nx, ny, o.sigma, c);
    if (!short && o.maxDiff && colorDiff(c, c0) > o.maxDiff) break;
    pts.push([nx, ny]);
    len += o.step;
    px = nx;
    py = ny;
    // Turn toward the field, but not too sharply: strokes are arm movements, not wire.
    let t2 = field(px, py) + (o.angleOffset || 0);
    let ex = Math.cos(t2);
    let ey = Math.sin(t2);
    if (ex * dx + ey * dy < 0) {
      ex = -ex;
      ey = -ey;
    }
    const cross = dx * ey - dy * ex;
    const turn = Math.max(-curl, Math.min(curl, Math.asin(Math.max(-1, Math.min(1, cross)))));
    const ct = Math.cos(turn);
    const st = Math.sin(turn);
    const ndx = dx * ct - dy * st;
    const ndy = dx * st + dy * ct;
    dx = ndx;
    dy = ndy;
  }
  return pts;
}

const lab = [0, 0, 0];

// Broken colour: nudge temperature (and a little value) of a linear colour.
export function jitter(rgb, rng, { value = 0.015, temp = 0.006, out = [0, 0, 0] } = {}) {
  linearToOklab(Math.max(0, rgb[0]), Math.max(0, rgb[1]), Math.max(0, rgb[2]), lab);
  const L = lab[0] * (1 + rng.normal() * value);
  const t = rng.normal() * temp;
  // Warm is toward ochre (+b, slight +a); cool toward the black-and-white greys (-b).
  return oklabToLinear(L, lab[1] + t * 0.35, lab[2] + t, out);
}

// Lighten or darken in OKLab keeping hue; amount in L units.
export function shiftL(rgb, amount, out = [0, 0, 0]) {
  linearToOklab(Math.max(0, rgb[0]), Math.max(0, rgb[1]), Math.max(0, rgb[2]), lab);
  return oklabToLinear(Math.max(0, lab[0] + amount), lab[1], lab[2], out);
}

export function lerpColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Iterate a jittered grid of cells (absolute canvas pixels) overlapping the paint region,
// each with its own keyed random stream, so crops paint the same strokes as full renders.
export function forCells({ region, spacing, margin = 0, seed, pass }, fn) {
  const cx0 = Math.floor((region.x0 - margin) / spacing);
  const cx1 = Math.floor((region.x1 + margin) / spacing);
  const cy0 = Math.floor((region.y0 - margin) / spacing);
  const cy1 = Math.floor((region.y1 + margin) / spacing);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const rng = rngFor(seed, pass, cx, cy);
      const X = (cx + rng.next()) * spacing;
      const Y = (cy + rng.next()) * spacing;
      fn(X - region.x0, Y - region.y0, rng, cx, cy);
    }
  }
}

// Displayed colour of the canvas (paint over ground by film opacity) at a pixel index.
export function canvasColor(canvas, i, out = [0, 0, 0]) {
  const o = i * 3;
  const op = canvas.opacity[i];
  out[0] = canvas.ground[o] + (canvas.paint[o] - canvas.ground[o]) * op;
  out[1] = canvas.ground[o + 1] + (canvas.paint[o + 1] - canvas.ground[o + 1]) * op;
  out[2] = canvas.ground[o + 2] + (canvas.paint[o + 2] - canvas.ground[o + 2]) * op;
  return out;
}
