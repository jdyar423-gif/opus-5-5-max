// Shared lighting: a low sun straight ahead (contre-jour), the sky dome and a little bounce.
import { oklch } from '../lib/color.js';

export function makeLighting(L, sky) {
  const sun = sky.sun;
  const sunColor = oklch(0.97, 0.05, 80).map((v) => v * 2.6);
  // Average sky radiance over the upper hemisphere (cosine weighted, coarse).
  const avg = [0, 0, 0];
  const glow = [0, 0, 0];
  const c = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < 24; i++) {
    for (let j = 1; j < 10; j++) {
      const az = (i / 24) * Math.PI * 2;
      const el = (j / 10) * (Math.PI / 2);
      const d = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
      sky.color(d, c, null, true);
      const w = Math.sin(el) * Math.cos(el);
      avg[0] += c[0] * w;
      avg[1] += c[1] * w;
      avg[2] += c[2] * w;
      n += w;
    }
  }
  for (let k = 0; k < 3; k++) avg[k] /= n;
  sky.color([0, Math.sin(0.06), Math.cos(0.06)], glow, null, true);
  // Warm light bounced up from the slabs and the glittering water.
  const ground = oklch(0.5, 0.02, 75);

  // Irradiance from the sky dome for normal n (no sun). A painter's fill keeps the
  // shadow side readable: cool skylight from above and the side, warm bounce from below.
  function ambient(nrm, out) {
    const up = 0.75 + 0.35 * nrm[1];
    const toward = Math.max(0, nrm[2] * 0.95 + nrm[1] * 0.3);
    const fwd = toward * toward * 0.45;
    const down = Math.max(0, -nrm[1]) * 0.6 + 0.12;
    out[0] = avg[0] * up + glow[0] * fwd + ground[0] * down;
    out[1] = avg[1] * up + glow[1] * fwd + ground[1] * down;
    out[2] = avg[2] * up + glow[2] * fwd + ground[2] * down;
    return out;
  }

  return { sun, sunColor, skyAverage: avg, glow, ambient };
}

// Screen-space angle (radians) of a 3D direction `dir` drawn at point P.
export function screenAngle(camera, P, dir, eps = 0.02) {
  const a = camera.project(P);
  const b = camera.project([P[0] + dir[0] * eps, P[1] + dir[1] * eps, P[2] + dir[2] * eps]);
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}
