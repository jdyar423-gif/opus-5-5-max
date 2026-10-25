// The sea: directional wave slopes (filtered by pixel footprint), Fresnel reflection of
// the sky, a dark pewter body colour, Cox–Munk sun glitter and aerial haze.
import { oklch } from '../lib/color.js';
import { Rng } from '../lib/rng.js';
import { smoothstep, clamp } from '../lib/noise.js';

export function makeSea(L, sky, noise, pixelAngle, seed) {
  const sun = sky.sun;
  const seaY = L.seaLevel;
  const sig2 = L.sea.slopeVariance;
  const hazeDistance = L.sea.hazeDistance;
  const body = oklch(0.31, 0.011, 238);
  const SUN_RADIANCE = 1.25;

  // Wind sea travelling roughly toward the viewer; crests mostly across the line of sight.
  const rng = new Rng(seed ^ 0x5ea);
  const waves = [];
  for (let i = 0; i < 18; i++) {
    const lambda = 0.22 * Math.pow(14 / 0.22, i / 17) * rng.range(0.85, 1.15);
    const ang = rng.normal() * 0.45;
    const steep = rng.range(0.045, 0.1); // slope amplitude a*k
    const k = (2 * Math.PI) / lambda;
    waves.push({ lambda, k, dx: Math.sin(ang), dz: -Math.cos(ang), slope: steep, phi: rng.range(0, 6.283) });
  }

  const tmp = [0, 0, 0];
  const r = [0, 0, 0];

  // d: unit view direction with d[1] < 0. Writes linear RGB to out, returns hit distance.
  // info (optional) receives { t, glint, sparkle }.
  function shade(eye, d, out, info = null) {
    const t = (seaY - eye[1]) / d[1];
    const X = eye[0] + d[0] * t;
    const Z = eye[2] + d[2] * t;
    // A pixel's footprint along the view direction on the water (stretched at grazing angles).
    const fp = (t * pixelAngle) / Math.max(-d[1], 0.015);

    let sx = 0;
    let sz = 0;
    let unresolved = 0;
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      const res = smoothstep(1.5 * fp, 5 * fp, w.lambda);
      if (res > 0) {
        const c = Math.cos(w.k * (w.dx * X + w.dz * Z) + w.phi) * w.slope * res;
        sx += c * w.dx;
        sz += c * w.dz;
      }
      unresolved += (1 - res) * 0.5 * w.slope * w.slope;
    }
    // Ripples riding on the waves.
    const ripRes = smoothstep(0.05, 0.25, 0.12 / fp);
    sx += noise.noise2(X * 3.1, Z * 1.3) * 0.05 * ripRes;
    sz += noise.noise2(X * 1.7 + 40, Z * 2.9) * 0.05 * ripRes;

    let nx = -sx;
    let ny = 1;
    let nz = -sz;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;

    // Mirror reflection of the sky (the disc itself is handled by the glitter term).
    const dn = d[0] * nx + d[1] * ny + d[2] * nz;
    r[0] = d[0] - 2 * dn * nx;
    r[1] = Math.max(0.003, d[1] - 2 * dn * ny);
    r[2] = d[2] - 2 * dn * nz;
    const rl = Math.hypot(r[0], r[1], r[2]);
    r[0] /= rl;
    r[1] /= rl;
    r[2] /= rl;
    sky.color(r, tmp, null, true);
    const cosT = clamp(-dn, 0, 1);
    const F = 0.02 + 0.98 * Math.pow(1 - cosT, 5);
    out[0] = F * tmp[0] + (1 - F) * body[0];
    out[1] = F * tmp[1] + (1 - F) * body[1];
    out[2] = F * tmp[2] + (1 - F) * body[2];

    // Cox–Munk glitter: probability that a facet tilts toward the half vector.
    const vx = -d[0];
    const vy = -d[1];
    const vz = -d[2];
    let hx = sun[0] + vx;
    let hy = sun[1] + vy;
    let hz = sun[2] + vz;
    const hl = Math.hypot(hx, hy, hz);
    hx /= hl;
    hy /= hl;
    hz /= hl;
    const s2 = sig2 + unresolved;
    const cb2 = hy * hy;
    const tan2 = (1 - cb2) / cb2;
    const p = Math.exp(-tan2 / s2) / (Math.PI * s2);
    const vh = vx * hx + vy * hy + vz * hz;
    const Fg = 0.02 + 0.98 * Math.pow(1 - clamp(vh, 0, 1), 5);
    let glint = (p * Fg) / (4 * cb2 * cb2 * Math.max(vy, 0.03));
    glint *= SUN_RADIANCE;

    // Break the glitter into crest-aligned flecks (streaky noise anchored to the water).
    const fleck = noise.noise2(X * 0.9 + Z * 0.05, Z * 2.2) * 0.6 + noise.noise2(X * 2.7, Z * 6.1) * 0.4;
    const sparkle = Math.pow(Math.max(0, 0.55 + fleck), 2.2) * 1.9;
    const g = glint * (0.25 + 0.75 * sparkle);
    out[0] += g * 1.0;
    out[1] += g * 0.93;
    out[2] += g * 0.74;

    // Aerial perspective toward the sea haze along the horizon.
    const fog = 1 - Math.exp(-t / hazeDistance);
    if (fog > 0.001) {
      tmp[0] = d[0];
      tmp[1] = 0.0005;
      tmp[2] = d[2];
      const hz2 = sky.color(tmp, r, null, true);
      out[0] += (hz2[0] - out[0]) * fog;
      out[1] += (hz2[1] - out[1]) * fog;
      out[2] += (hz2[2] - out[2]) * fog;
    }

    if (info) {
      info.t = t;
      info.glint = glint;
      info.sparkle = sparkle;
    }
    return t;
  }

  return { shade };
}
