// Analytic ray-traced primitives. Each has:
//   bounds()          -> { min, max } world AABB (for screen-space culling)
//   intersect(o, d)   -> nearest t > 0, or -1
//   normal(P, d)      -> unit world normal at hit point P (facing the viewer for plates)
//   local(P)          -> coordinates in the primitive's own frame (for materials)
// Optional fields set by the scene: mat (material name), obj (style-map object class), data.
import { mulMV, mulTV, IDENTITY } from '../lib/vec.js';

let nextId = 1;

class Prim {
  constructor(mat, obj, data) {
    this.id = nextId++;
    this.mat = mat;
    this.obj = obj;
    this.data = data || {};
  }
}

export class Sphere extends Prim {
  constructor(c, r, mat, obj, data) {
    super(mat, obj, data);
    this.c = c;
    this.r = r;
  }

  bounds() {
    const { c, r } = this;
    return { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] };
  }

  intersect(o, d) {
    const ox = o[0] - this.c[0];
    const oy = o[1] - this.c[1];
    const oz = o[2] - this.c[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2];
    const c = ox * ox + oy * oy + oz * oz - this.r * this.r;
    const h = b * b - c;
    if (h < 0) return -1;
    const s = Math.sqrt(h);
    const t = -b - s;
    if (t > 1e-4) return t;
    const t2 = -b + s;
    return t2 > 1e-4 ? t2 : -1;
  }

  normal(P) {
    const x = P[0] - this.c[0];
    const y = P[1] - this.c[1];
    const z = P[2] - this.c[2];
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }

  local(P) {
    return [P[0] - this.c[0], P[1] - this.c[1], P[2] - this.c[2]];
  }
}

// Ellipsoid with rotation m (rows = local axes in world space) and radii [a, b, c].
export class Ellipsoid extends Prim {
  constructor(c, m, radii, mat, obj, data) {
    super(mat, obj, data);
    this.c = c;
    this.m = m || IDENTITY;
    this.radii = radii;
  }

  bounds() {
    // Conservative: bounding sphere of the largest radius.
    const r = Math.max(...this.radii);
    const c = this.c;
    return { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] };
  }

  intersect(o, d) {
    const m = this.m;
    const [a, b, c] = this.radii;
    const px = o[0] - this.c[0];
    const py = o[1] - this.c[1];
    const pz = o[2] - this.c[2];
    const ox = (m[0] * px + m[1] * py + m[2] * pz) / a;
    const oy = (m[3] * px + m[4] * py + m[5] * pz) / b;
    const oz = (m[6] * px + m[7] * py + m[8] * pz) / c;
    const dx = (m[0] * d[0] + m[1] * d[1] + m[2] * d[2]) / a;
    const dy = (m[3] * d[0] + m[4] * d[1] + m[5] * d[2]) / b;
    const dz = (m[6] * d[0] + m[7] * d[1] + m[8] * d[2]) / c;
    const A = dx * dx + dy * dy + dz * dz;
    const B = ox * dx + oy * dy + oz * dz;
    const C = ox * ox + oy * oy + oz * oz - 1;
    const h = B * B - A * C;
    if (h < 0) return -1;
    const s = Math.sqrt(h);
    const t = (-B - s) / A;
    if (t > 1e-4) return t;
    const t2 = (-B + s) / A;
    return t2 > 1e-4 ? t2 : -1;
  }

  local(P) {
    return mulMV(this.m, [P[0] - this.c[0], P[1] - this.c[1], P[2] - this.c[2]]);
  }

  normal(P) {
    const l = this.local(P);
    const [a, b, c] = this.radii;
    const n = mulTV(this.m, [l[0] / (a * a), l[1] / (b * b), l[2] / (c * c)]);
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / len, n[1] / len, n[2] / len];
  }
}

export class Capsule extends Prim {
  constructor(a, b, r, mat, obj, data) {
    super(mat, obj, data);
    this.a = a;
    this.b = b;
    this.r = r;
    this.ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    this.baba = this.ba[0] ** 2 + this.ba[1] ** 2 + this.ba[2] ** 2;
  }

  bounds() {
    const { a, b, r } = this;
    return {
      min: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r],
      max: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r],
    };
  }

  intersect(o, d) {
    const { a, b, ba, baba, r } = this;
    const oax = o[0] - a[0];
    const oay = o[1] - a[1];
    const oaz = o[2] - a[2];
    const bard = ba[0] * d[0] + ba[1] * d[1] + ba[2] * d[2];
    const baoa = ba[0] * oax + ba[1] * oay + ba[2] * oaz;
    const rdoa = d[0] * oax + d[1] * oay + d[2] * oaz;
    const oaoa = oax * oax + oay * oay + oaz * oaz;
    const A = baba - bard * bard;
    const B = baba * rdoa - baoa * bard;
    const C = baba * oaoa - baoa * baoa - r * r * baba;
    const h = B * B - A * C;
    if (h >= 0) {
      const t = (-B - Math.sqrt(h)) / A;
      const y = baoa + t * bard;
      if (y > 0 && y < baba && t > 1e-4) return t;
      // Hemispherical caps.
      let ocx;
      let ocy;
      let ocz;
      if (y <= 0) {
        ocx = oax;
        ocy = oay;
        ocz = oaz;
      } else {
        ocx = o[0] - b[0];
        ocy = o[1] - b[1];
        ocz = o[2] - b[2];
      }
      const bb = d[0] * ocx + d[1] * ocy + d[2] * ocz;
      const cc = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
      const hh = bb * bb - cc;
      if (hh > 0) {
        const t2 = -bb - Math.sqrt(hh);
        if (t2 > 1e-4) return t2;
      }
    }
    return -1;
  }

  // Parameter along the axis (0 at a, 1 at b) and the closest axis point.
  axisParam(P) {
    const { a, ba, baba } = this;
    const t = ((P[0] - a[0]) * ba[0] + (P[1] - a[1]) * ba[1] + (P[2] - a[2]) * ba[2]) / baba;
    return Math.min(1, Math.max(0, t));
  }

  // Normalised: shading points averaged over subsamples can sit slightly off thin surfaces.
  normal(P) {
    const t = this.axisParam(P);
    const { a, ba } = this;
    const x = P[0] - (a[0] + ba[0] * t);
    const y = P[1] - (a[1] + ba[1] * t);
    const z = P[2] - (a[2] + ba[2] * t);
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }

  local(P) {
    return [this.axisParam(P), 0, 0];
  }
}

// Sphere-swept cone between spheres (a, ra) and (b, rb) (after Inigo Quilez).
export class RoundCone extends Prim {
  constructor(a, b, ra, rb, mat, obj, data) {
    super(mat, obj, data);
    this.a = a;
    this.b = b;
    this.ra = ra;
    this.rb = rb;
    this.ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    this.m0 = this.ba[0] ** 2 + this.ba[1] ** 2 + this.ba[2] ** 2;
    this.hit = [0, 0, 0, 0];
  }

  bounds() {
    const { a, b } = this;
    const r = Math.max(this.ra, this.rb);
    return {
      min: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r],
      max: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r],
    };
  }

  intersect(o, d) {
    const { a, b, ba, ra, rb, m0, hit } = this;
    const oax = o[0] - a[0];
    const oay = o[1] - a[1];
    const oaz = o[2] - a[2];
    const obx = o[0] - b[0];
    const oby = o[1] - b[1];
    const obz = o[2] - b[2];
    const rr = ra - rb;
    const m1 = ba[0] * oax + ba[1] * oay + ba[2] * oaz;
    const m2 = ba[0] * d[0] + ba[1] * d[1] + ba[2] * d[2];
    const m3 = d[0] * oax + d[1] * oay + d[2] * oaz;
    const m5 = oax * oax + oay * oay + oaz * oaz;
    const m6 = obx * d[0] + oby * d[1] + obz * d[2];
    const m7 = obx * obx + oby * oby + obz * obz;
    const d2 = m0 - rr * rr;
    const k2 = d2 - m2 * m2;
    const k1 = d2 * m3 - m1 * m2 + m2 * rr * ra;
    const k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2 - m0 * ra * ra;
    const h = k1 * k1 - k0 * k2;
    if (h < 0) return -1;
    const t = (-Math.sqrt(h) - k1) / k2;
    const y = m1 - ra * rr + t * m2;
    if (y > 0 && y < d2 && t > 1e-4) {
      hit[0] = t;
      hit[1] = 0; // body
      return t;
    }
    const h1 = m3 * m3 - m5 + ra * ra;
    const h2 = m6 * m6 - m7 + rb * rb;
    if (Math.max(h1, h2) < 0) return -1;
    let best = 1e20;
    if (h1 > 0) {
      const t1 = -m3 - Math.sqrt(h1);
      if (t1 > 1e-4) best = t1;
    }
    if (h2 > 0) {
      const t2 = -m6 - Math.sqrt(h2);
      if (t2 > 1e-4 && t2 < best) best = t2;
    }
    return best < 1e20 ? best : -1;
  }

  axisParam(P) {
    const { a, ba, m0 } = this;
    const t = ((P[0] - a[0]) * ba[0] + (P[1] - a[1]) * ba[1] + (P[2] - a[2]) * ba[2]) / m0;
    return Math.min(1, Math.max(0, t));
  }

  // Normal via the gradient of the round-cone distance field (robust on body and caps).
  normal(P) {
    const e = 1e-4 * Math.max(this.ra, this.rb, 0.01);
    const f = (x, y, z) => this.sdf(x, y, z);
    const nx = f(P[0] + e, P[1], P[2]) - f(P[0] - e, P[1], P[2]);
    const ny = f(P[0], P[1] + e, P[2]) - f(P[0], P[1] - e, P[2]);
    const nz = f(P[0], P[1], P[2] + e) - f(P[0], P[1], P[2] - e);
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  sdf(x, y, z) {
    const { a, ba, m0, ra, rb } = this;
    const px = x - a[0];
    const py = y - a[1];
    const pz = z - a[2];
    const l2 = m0;
    const rr = ra - rb;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    const yv = px * ba[0] + py * ba[1] + pz * ba[2];
    const zv = yv - l2;
    const xx = px * l2 - ba[0] * yv;
    const xy = py * l2 - ba[1] * yv;
    const xz = pz * l2 - ba[2] * yv;
    const x2 = xx * xx + xy * xy + xz * xz;
    const y2 = yv * yv * l2;
    const z2 = zv * zv * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
    if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
    return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra;
  }

  local(P) {
    return [this.axisParam(P), 0, 0];
  }
}

// Oriented box with half sizes h = [hx, hy, hz]; edges get bevelled normals of radius `bevel`.
export class Box extends Prim {
  constructor(c, m, h, mat, obj, data, bevel = 0) {
    super(mat, obj, data);
    this.c = c;
    this.m = m || IDENTITY;
    this.h = h;
    this.bevel = bevel;
  }

  bounds() {
    const r = Math.hypot(...this.h);
    const c = this.c;
    return { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] };
  }

  intersect(o, d) {
    const m = this.m;
    const px = o[0] - this.c[0];
    const py = o[1] - this.c[1];
    const pz = o[2] - this.c[2];
    const ro = [m[0] * px + m[1] * py + m[2] * pz, m[3] * px + m[4] * py + m[5] * pz, m[6] * px + m[7] * py + m[8] * pz];
    const rd = [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[3] * d[0] + m[4] * d[1] + m[5] * d[2], m[6] * d[0] + m[7] * d[1] + m[8] * d[2]];
    let tn = -1e30;
    let tf = 1e30;
    for (let k = 0; k < 3; k++) {
      const inv = 1 / (Math.abs(rd[k]) < 1e-12 ? 1e-12 : rd[k]);
      let t1 = (-this.h[k] - ro[k]) * inv;
      let t2 = (this.h[k] - ro[k]) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tn) tn = t1;
      if (t2 < tf) tf = t2;
      if (tn > tf) return -1;
    }
    if (tf < 1e-4) return -1;
    return tn > 1e-4 ? tn : tf;
  }

  local(P) {
    return mulMV(this.m, [P[0] - this.c[0], P[1] - this.c[1], P[2] - this.c[2]]);
  }

  normal(P) {
    const l = this.local(P);
    const h = this.h;
    // Face normal from the axis we are closest to leaving through.
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < 3; k++) {
      const dk = h[k] - Math.abs(l[k]);
      if (dk < bestD) {
        bestD = dk;
        best = k;
      }
    }
    const n = [0, 0, 0];
    n[best] = Math.sign(l[best]) || 1;
    if (this.bevel > 0) {
      // Round off toward neighbouring faces within the bevel radius.
      for (let k = 0; k < 3; k++) {
        if (k === best) continue;
        const dk = h[k] - Math.abs(l[k]);
        if (dk < this.bevel) n[k] = (Math.sign(l[k]) || 1) * (1 - dk / this.bevel);
      }
    }
    const w = mulTV(this.m, n);
    const len = Math.hypot(w[0], w[1], w[2]) || 1;
    return [w[0] / len, w[1] / len, w[2] / len];
  }
}

// Flat two-sided plate in the local x/z plane (local y is the normal), half extents hx, hz.
// `shape(u, v, data)` with u, v in [-1, 1] returns true when inside (feathers, webs, discs).
export class Plate extends Prim {
  constructor(c, m, hx, hz, shape, mat, obj, data) {
    super(mat, obj, data);
    this.c = c;
    this.m = m || IDENTITY;
    this.hx = hx;
    this.hz = hz;
    this.shape = shape;
  }

  bounds() {
    const r = Math.hypot(this.hx, this.hz);
    const c = this.c;
    return { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] };
  }

  intersect(o, d) {
    const m = this.m;
    const px = o[0] - this.c[0];
    const py = o[1] - this.c[1];
    const pz = o[2] - this.c[2];
    const oy = m[3] * px + m[4] * py + m[5] * pz;
    const dy = m[3] * d[0] + m[4] * d[1] + m[5] * d[2];
    if (Math.abs(dy) < 1e-9) return -1;
    const t = -oy / dy;
    if (t < 1e-4) return -1;
    const lx = m[0] * (px + d[0] * t) + m[1] * (py + d[1] * t) + m[2] * (pz + d[2] * t);
    const lz = m[6] * (px + d[0] * t) + m[7] * (py + d[1] * t) + m[8] * (pz + d[2] * t);
    const u = lx / this.hx;
    const v = lz / this.hz;
    if (u < -1 || u > 1 || v < -1 || v > 1) return -1;
    return this.shape(u, v, this.data) ? t : -1;
  }

  local(P) {
    const l = mulMV(this.m, [P[0] - this.c[0], P[1] - this.c[1], P[2] - this.c[2]]);
    return [l[0] / this.hx, l[1], l[2] / this.hz];
  }

  normal(P, d) {
    const m = this.m;
    const n = [m[3], m[4], m[5]];
    if (d && n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 0) return [-n[0], -n[1], -n[2]];
    return n;
  }
}
