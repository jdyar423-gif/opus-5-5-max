// Screen-space splat renderer for analytic primitives, 2x2 supersampled, processed in
// horizontal bands. Primitives composite over a per-pixel background; thin 3D segments
// (spokes, chain, cables) are drawn afterwards as anti-aliased lines with a depth test.

const SS = 2; // subsamples per axis
const BAND = 32; // pixel rows per band

// Project a primitive's world AABB to a pixel bbox on the full canvas.
function screenBounds(prim, camera, H) {
  const { min, max } = prim.bounds();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const p = [0, 0, 0];
  for (let i = 0; i < 8; i++) {
    const P = [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
    camera.project(P, p);
    if (p[2] <= 0.05) return null;
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  return {
    x0: Math.floor(x0 * H) - 1,
    y0: Math.floor(y0 * H) - 1,
    x1: Math.ceil(x1 * H) + 1,
    y1: Math.ceil(y1 * H) + 1,
  };
}

/**
 * prims: primitives; ref: reference buffers (see reference.js) holding the background already.
 * shadeHit(prim, P, n, d, t, out, info): writes linear RGB to out, style hints to info.
 * bgDepth(d): distance to the background along unit direction d (Infinity for sky).
 */
export function renderPrimitives({ prims, camera, W, H, region, ref, shadeHit, bgDepth }) {
  const rw = region.x1 - region.x0;
  const rh = region.y1 - region.y0;
  const boxes = [];
  for (let i = 0; i < prims.length; i++) {
    const b = screenBounds(prims[i], camera, H);
    if (!b) continue;
    if (b.x1 < region.x0 || b.x0 >= region.x1 || b.y1 < region.y0 || b.y0 >= region.y1) continue;
    boxes.push({ i, ...b });
  }
  boxes.sort((a, b) => a.y0 - b.y0);

  const sw = rw * SS;
  const dirs = new Float32Array(BAND * SS * sw * 3);
  const depth = new Float32Array(BAND * SS * sw);
  const ids = new Int32Array(BAND * SS * sw);
  const d = [0, 0, 0];
  const P = [0, 0, 0];
  const col = [0, 0, 0];
  const info = {};
  const eye = camera.eye;
  const counts = new Map();

  for (let by0 = region.y0; by0 < region.y1; by0 += BAND) {
    const by1 = Math.min(region.y1, by0 + BAND);
    const sh = (by1 - by0) * SS;
    // Subsample rays and background depth.
    for (let sy = 0; sy < sh; sy++) {
      const y = (by0 + (sy + 0.5) / SS) / H;
      for (let sx = 0; sx < sw; sx++) {
        const x = (region.x0 + (sx + 0.5) / SS) / H;
        camera.dir(x, y, d);
        const s = sy * sw + sx;
        dirs[s * 3] = d[0];
        dirs[s * 3 + 1] = d[1];
        dirs[s * 3 + 2] = d[2];
        depth[s] = bgDepth(d);
        ids[s] = -1;
      }
    }
    // Splat every primitive overlapping this band.
    for (const b of boxes) {
      if (b.y0 >= by1) break;
      if (b.y1 < by0) continue;
      const prim = prims[b.i];
      const ys = Math.max(0, (b.y0 - by0) * SS);
      const ye = Math.min(sh, (b.y1 - by0) * SS);
      const xs = Math.max(0, (b.x0 - region.x0) * SS);
      const xe = Math.min(sw, (b.x1 - region.x0) * SS);
      for (let sy = ys; sy < ye; sy++) {
        for (let sx = xs; sx < xe; sx++) {
          const s = sy * sw + sx;
          d[0] = dirs[s * 3];
          d[1] = dirs[s * 3 + 1];
          d[2] = dirs[s * 3 + 2];
          const t = prim.intersect(eye, d);
          if (t > 0 && t < depth[s]) {
            depth[s] = t;
            ids[s] = b.i;
          }
        }
      }
    }
    // Resolve: shade each distinct primitive once per pixel at the mean of its subsamples.
    for (let py = by0; py < by1; py++) {
      for (let px = region.x0; px < region.x1; px++) {
        counts.clear();
        let minT = Infinity;
        for (let j = 0; j < SS; j++) {
          for (let i = 0; i < SS; i++) {
            const s = ((py - by0) * SS + j) * sw + (px - region.x0) * SS + i;
            if (depth[s] < minT) minT = depth[s];
            const id = ids[s];
            if (id < 0) continue;
            let c = counts.get(id);
            if (!c) {
              c = { n: 0, t: 0, dx: 0, dy: 0, dz: 0 };
              counts.set(id, c);
            }
            c.n++;
            c.t += depth[s];
            c.dx += dirs[s * 3];
            c.dy += dirs[s * 3 + 1];
            c.dz += dirs[s * 3 + 2];
          }
        }
        const pi = (py - region.y0) * rw + (px - region.x0);
        ref.depth[pi] = minT;
        if (counts.size === 0) continue;
        const o = pi * 3;
        const total = SS * SS;
        let covered = 0;
        for (const c of counts.values()) covered += c.n;
        const bgW = (total - covered) / total;
        let r = ref.color.data[o] * bgW;
        let g = ref.color.data[o + 1] * bgW;
        let bl = ref.color.data[o + 2] * bgW;
        let best = null;
        let bestN = 0;
        let bestInfo = null;
        for (const [id, c] of counts) {
          const prim = prims[id];
          const dl = Math.hypot(c.dx, c.dy, c.dz);
          d[0] = c.dx / dl;
          d[1] = c.dy / dl;
          d[2] = c.dz / dl;
          const t = c.t / c.n;
          P[0] = eye[0] + d[0] * t;
          P[1] = eye[1] + d[1] * t;
          P[2] = eye[2] + d[2] * t;
          const n = prim.normal(P, d);
          for (const k in info) delete info[k];
          shadeHit(prim, P, n, d, t, col, info);
          // Guard against degenerate shading (a non-finite or runaway value would poison
          // every blur level of the reference the painter samples).
          for (let k = 0; k < 3; k++) col[k] = Number.isFinite(col[k]) ? Math.min(6, Math.max(0, col[k])) : 0;
          const w = c.n / total;
          r += col[0] * w;
          g += col[1] * w;
          bl += col[2] * w;
          if (c.n > bestN) {
            bestN = c.n;
            best = prim;
            bestInfo = { ...info, t };
          }
        }
        ref.color.data[o] = r;
        ref.color.data[o + 1] = g;
        ref.color.data[o + 2] = bl;
        ref.coverage[pi] = covered / total;
        if (bestN >= total - covered) ref.setStyle(pi, best, bestInfo, bestN / total);
      }
    }
  }
}

/**
 * Thin segments: [{ a, b, r, shade(P, out, info), prim? }]. Drawn with per-pixel depth test
 * against ref.depth; sub-pixel widths fade instead of vanishing.
 */
export function renderLines({ lines, camera, H, region, ref }) {
  const rw = region.x1 - region.x0;
  const pa = [0, 0, 0];
  const pb = [0, 0, 0];
  const P = [0, 0, 0];
  const col = [0, 0, 0];
  const info = {};
  const eye = camera.eye;
  for (const line of lines) {
    camera.project(line.a, pa);
    camera.project(line.b, pb);
    if (pa[2] <= 0.05 || pb[2] <= 0.05) continue;
    const ax = pa[0] * H;
    const ay = pa[1] * H;
    const bx = pb[0] * H;
    const by = pb[1] * H;
    const ra = (camera.f * line.r * H) / pa[2];
    const rb = (camera.f * line.r * H) / pb[2];
    const rmax = Math.max(ra, rb, 0.6) + 1.5;
    const x0 = Math.max(region.x0, Math.floor(Math.min(ax, bx) - rmax));
    const x1 = Math.min(region.x1 - 1, Math.ceil(Math.max(ax, bx) + rmax));
    const y0 = Math.max(region.y0, Math.floor(Math.min(ay, by) - rmax));
    const y1 = Math.min(region.y1 - 1, Math.ceil(Math.max(ay, by) + rmax));
    if (x0 > x1 || y0 > y1) continue;
    const ex = bx - ax;
    const ey = by - ay;
    const el2 = ex * ex + ey * ey || 1e-9;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const qx = px + 0.5 - ax;
        const qy = py + 0.5 - ay;
        let u = (qx * ex + qy * ey) / el2;
        if (u < 0) u = 0;
        else if (u > 1) u = 1;
        const dx = qx - ex * u;
        const dy = qy - ey * u;
        const dist = Math.hypot(dx, dy);
        const rad = ra + (rb - ra) * u;
        let cov;
        if (rad >= 0.5) cov = Math.min(1, Math.max(0, rad + 0.5 - dist));
        else cov = Math.max(0, 1 - dist) * rad * 2;
        if (cov <= 0.002) continue;
        // Perspective-correct point along the segment.
        const iz = (1 - u) / pa[2] + u / pb[2];
        const w = u / pb[2] / iz;
        P[0] = line.a[0] + (line.b[0] - line.a[0]) * w;
        P[1] = line.a[1] + (line.b[1] - line.a[1]) * w;
        P[2] = line.a[2] + (line.b[2] - line.a[2]) * w;
        const t = Math.hypot(P[0] - eye[0], P[1] - eye[1], P[2] - eye[2]);
        const pi = (py - region.y0) * rw + (px - region.x0);
        if (t > ref.depth[pi] + 0.004) continue;
        for (const k in info) delete info[k];
        line.shade(P, col, info);
        const o = pi * 3;
        ref.color.data[o] += (col[0] - ref.color.data[o]) * cov;
        ref.color.data[o + 1] += (col[1] - ref.color.data[o + 1]) * cov;
        ref.color.data[o + 2] += (col[2] - ref.color.data[o + 2]) * cov;
        if (cov > 0.45) {
          info.angle = Math.atan2(ey, ex);
          ref.setStyle(pi, line.prim || line, info, cov);
        }
      }
    }
  }
}
