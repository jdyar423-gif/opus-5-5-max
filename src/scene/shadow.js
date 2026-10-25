// Cast shadow of the rider and bicycle on the slabs.
// A shadow map is ray-traced from the sun side; ground points look it up with a
// penumbra that widens with distance from the occluder (summed-area table).
import { norm, cross } from '../lib/vec.js';
import { Capsule } from './primitives.js';

export function makeShadowMap({ prims, lines = [], sunDir, texel = 0.002, pad = 0.05 }) {
  const W = norm(sunDir); // toward the sun
  let U = norm(cross([0, 1, 0], W));
  if (!Number.isFinite(U[0])) U = [1, 0, 0];
  const V = cross(W, U);
  const occluders = [...prims];
  for (const l of lines) occluders.push(new Capsule(l.a, l.b, l.r * 1.3, null, null, {}));

  // Extent of the occluders in shadow-map coordinates.
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  let wMax = -Infinity;
  let wMin = Infinity;
  const boxes = occluders.map((p) => {
    const { min, max } = p.bounds();
    let bu0 = Infinity;
    let bu1 = -Infinity;
    let bv0 = Infinity;
    let bv1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const P = [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
      const u = P[0] * U[0] + P[1] * U[1] + P[2] * U[2];
      const v = P[0] * V[0] + P[1] * V[1] + P[2] * V[2];
      const w = P[0] * W[0] + P[1] * W[1] + P[2] * W[2];
      bu0 = Math.min(bu0, u);
      bu1 = Math.max(bu1, u);
      bv0 = Math.min(bv0, v);
      bv1 = Math.max(bv1, v);
      wMax = Math.max(wMax, w);
      wMin = Math.min(wMin, w);
    }
    u0 = Math.min(u0, bu0);
    u1 = Math.max(u1, bu1);
    v0 = Math.min(v0, bv0);
    v1 = Math.max(v1, bv1);
    return { bu0, bu1, bv0, bv1 };
  });
  u0 -= pad;
  v0 -= pad;
  u1 += pad;
  v1 += pad;
  const nu = Math.ceil((u1 - u0) / texel);
  const nv = Math.ceil((v1 - v0) / texel);
  // depth[k]: the occluder's depth along W nearest the sun, or -Infinity where open.
  const depth = new Float32Array(nu * nv).fill(-Infinity);
  const dir = [-W[0], -W[1], -W[2]];
  const o = [0, 0, 0];
  for (let b = 0; b < occluders.length; b++) {
    const bx = boxes[b];
    const iu0 = Math.max(0, Math.floor((bx.bu0 - u0) / texel));
    const iu1 = Math.min(nu - 1, Math.ceil((bx.bu1 - u0) / texel));
    const iv0 = Math.max(0, Math.floor((bx.bv0 - v0) / texel));
    const iv1 = Math.min(nv - 1, Math.ceil((bx.bv1 - v0) / texel));
    const prim = occluders[b];
    for (let iv = iv0; iv <= iv1; iv++) {
      const v = v0 + (iv + 0.5) * texel;
      for (let iu = iu0; iu <= iu1; iu++) {
        const u = u0 + (iu + 0.5) * texel;
        const w = wMax + 1;
        o[0] = U[0] * u + V[0] * v + W[0] * w;
        o[1] = U[1] * u + V[1] * v + W[1] * w;
        o[2] = U[2] * u + V[2] * v + W[2] * w;
        const t = prim.intersect(o, dir);
        if (t > 0) {
          const d = w - t;
          const k = iv * nu + iu;
          if (d > depth[k]) depth[k] = d;
        }
      }
    }
  }
  // Summed-area table of occupancy for wide, soft lookups far behind the occluders.
  const sat = new Float64Array((nu + 1) * (nv + 1));
  for (let iv = 0; iv < nv; iv++) {
    let row = 0;
    for (let iu = 0; iu < nu; iu++) {
      row += depth[iv * nu + iu] > -Infinity ? 1 : 0;
      sat[(iv + 1) * (nu + 1) + iu + 1] = sat[iv * (nu + 1) + iu + 1] + row;
    }
  }
  const boxSum = (a0, b0, a1, b1) => {
    a0 = Math.max(0, Math.min(nu, a0));
    a1 = Math.max(0, Math.min(nu, a1));
    b0 = Math.max(0, Math.min(nv, b0));
    b1 = Math.max(0, Math.min(nv, b1));
    if (a1 <= a0 || b1 <= b0) return 0;
    return sat[b1 * (nu + 1) + a1] - sat[b0 * (nu + 1) + a1] - sat[b1 * (nu + 1) + a0] + sat[b0 * (nu + 1) + a0];
  };

  // Shadow amount 0..1 at world point P; `spread` is the penumbra growth per metre.
  function lookup(P, spread = 0.012) {
    const u = P[0] * U[0] + P[1] * U[1] + P[2] * U[2];
    const v = P[0] * V[0] + P[1] * V[1] + P[2] * V[2];
    const w = P[0] * W[0] + P[1] * W[1] + P[2] * W[2];
    if (w > wMax) return 0;
    const fu = (u - u0) / texel;
    const fv = (v - v0) / texel;
    if (fu < -50 || fv < -50 || fu > nu + 50 || fv > nv + 50) return 0;
    const dist = Math.max(0, wMin - w); // distance behind the nearest occluder plane
    const r = Math.max(0.7, (0.003 + dist * spread) / texel);
    if (w < wMin - 0.05) {
      const a0 = Math.floor(fu - r);
      const a1 = Math.ceil(fu + r);
      const b0 = Math.floor(fv - r);
      const b1 = Math.ceil(fv + r);
      return boxSum(a0, b0, a1, b1) / ((a1 - a0) * (b1 - b0));
    }
    // Close to the contact points: depth-tested 3x3 filter.
    let s = 0;
    let n = 0;
    for (let dv = -1; dv <= 1; dv++) {
      for (let du = -1; du <= 1; du++) {
        const iu = Math.round(fu + du);
        const iv = Math.round(fv + dv);
        n++;
        if (iu < 0 || iv < 0 || iu >= nu || iv >= nv) continue;
        if (depth[iv * nu + iu] > w + 0.01) s++;
      }
    }
    return s / n;
  }

  return { lookup, size: [nu, nv] };
}

// The painter's sun for shadows: same azimuth as the real sun, but steep enough that the
// figure's whole shadow lands on the visible slabs between his wheels and the picture's edge.
export function shadowSunDir(L) {
  const e = (L.shadowElevationDeg * Math.PI) / 180;
  return [0, Math.sin(e), Math.cos(e)];
}
