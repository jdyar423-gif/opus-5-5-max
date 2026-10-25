// The breakwater: a masonry mole with vertical walls. The slab walk is shaded per pixel
// (analytic plane); coping blocks along both edges and tumbled boulders at the foot of the
// seaward wall are ray-traced primitives.
import { Rng, rngFor } from '../lib/rng.js';
import { mixPaint } from '../lib/color.js';
import { smoothstep, clamp } from '../lib/noise.js';
import { rotY, rotZ, rotX, mulMM, frameAlong } from '../lib/vec.js';
import { Box, Ellipsoid } from './primitives.js';
import { OBJ } from './objects.js';

const GRANITE = mixPaint({ W: 0.6, K: 0.034, O: 0.09 });

export function makePavement(L, seed, noise, lighting, sky, camera, pixelAngle) {
  const { left, right, length } = L.pavement;
  const rng = new Rng(seed ^ 0x51ab);
  const courses = [];
  let z = -4;
  while (z < length) {
    const len = rng.range(0.85, 1.45);
    const xs = [left];
    let x = left + rng.range(0.35, 1.05);
    while (x < right - 0.35) {
      xs.push(x);
      x += rng.range(0.75, 1.25);
    }
    xs.push(right);
    const slabs = [];
    for (let k = 0; k < xs.length - 1; k++) {
      slabs.push({
        tone: rng.normal() * 0.2,
        tx: rng.normal() * 0.012,
        tz: rng.normal() * 0.012,
        gloss: rng.range(0.4, 1),
        warm: rng.normal() * 0.5,
      });
    }
    courses.push({ z0: z, z1: z + len, xs, slabs });
    z += len;
  }

  function course(Z) {
    let lo = 0;
    let hi = courses.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (courses[mid].z0 <= Z) lo = mid;
      else hi = mid - 1;
    }
    return courses[lo];
  }

  // Distance along the ray to the slab plane, or Infinity if the ray misses the walk.
  function hit(eye, d) {
    if (d[1] >= 0) return Infinity;
    const t = -eye[1] / d[1];
    const X = eye[0] + d[0] * t;
    return X >= left && X <= right ? t : Infinity;
  }

  const n = [0, 0, 0];
  const r = [0, 0, 0];
  const amb = [0, 0, 0];
  const skyR = [0, 0, 0];
  const vp = camera.project([0, 0, 1e6]);

  function shade(eye, d, t, out, info, shadowAt) {
    const X = eye[0] + d[0] * t;
    const Z = eye[2] + d[2] * t;
    // Old hand-laid joints wander; look the slab up through a gentle warp.
    const wx = X + noise.noise2(X * 0.7 + 11, Z * 0.9) * 0.05;
    const wz = Z + noise.noise2(X * 0.9, Z * 0.7 - 7) * 0.06;
    const c = course(wz);
    let k = 0;
    while (k < c.slabs.length - 1 && wx > c.xs[k + 1]) k++;
    const s = c.slabs[k];
    const fp = (t * pixelAngle) / Math.max(-d[1], 0.01); // pixel footprint on the slabs
    const jointDist = Math.min(wz - c.z0, c.z1 - wz, wx - c.xs[k], c.xs[k + 1] - wx);
    // Joints open and close along their length.
    const jw = 0.012 + 0.02 * Math.max(0, noise.noise2(X * 3.1, Z * 3.1) + 0.3);
    const joint = 1 - smoothstep(jw - fp * 0.5, jw + fp * 0.5, jointDist);
    const jointAvg = Math.min(1, (jw * 2.2) / Math.max(fp, 1e-4)) * smoothstep(0.03, 0.2, fp);

    // Worn, slightly tilted slab; fine granite grain where resolvable.
    const grainRes = smoothstep(0.012, 0.004, fp);
    n[0] = s.tx + noise.noise2(X * 9, Z * 9) * 0.03 * grainRes;
    n[1] = 1;
    n[2] = s.tz + noise.noise2(X * 9 + 31, Z * 9) * 0.03 * grainRes;
    const nl = Math.hypot(n[0], n[1], n[2]);
    n[0] /= nl;
    n[1] /= nl;
    n[2] /= nl;

    const stain = noise.fbm2(X * 0.6, Z * 0.35, 3) * 0.12;
    const tone = Math.exp(s.tone + stain) * (1 - 0.65 * Math.max(joint, jointAvg * 0.35));
    const ar = GRANITE[0] * tone * (1 + 0.04 * s.warm);
    const ag = GRANITE[1] * tone;
    const ab = GRANITE[2] * tone * (1 - 0.04 * s.warm);

    const P = [X, 0, Z];
    const shadow = shadowAt ? shadowAt(P) : 0;
    const lit = 1 - shadow;
    lighting.ambient(n, amb);
    const sun = lighting.sun;
    const ndl = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]);
    const sc = lighting.sunColor;
    // Contre-jour: the walk is lit only by the dome; keep it low in value so the light glows.
    out[0] = ar * (amb[0] * 0.62 + sc[0] * ndl * lit);
    out[1] = ag * (amb[1] * 0.62 + sc[1] * ndl * lit);
    out[2] = ab * (amb[2] * 0.62 + sc[2] * ndl * lit);

    // Sheen: the worn, salt-damp slabs mirror the bright sky toward the sun.
    const dn = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    r[0] = d[0] - 2 * dn * n[0];
    r[1] = Math.max(0.002, d[1] - 2 * dn * n[1]);
    r[2] = d[2] - 2 * dn * n[2];
    const rl = Math.hypot(r[0], r[1], r[2]);
    r[0] /= rl;
    r[1] /= rl;
    r[2] /= rl;
    sky.color(r, skyR, null, true);
    const cosT = clamp(-dn, 0, 1);
    const F = (0.03 + 0.97 * Math.pow(1 - cosT, 5)) * (0.35 + 0.4 * s.gloss) * (1 - joint * 0.8);
    // Rough stone: the sky reflection is dimmed, and only the sun's broad lobe survives in light.
    const hx = sun[0] - d[0];
    const hy = sun[1] - d[1];
    const hz = sun[2] - d[2];
    const hl = Math.hypot(hx, hy, hz);
    const ndh = Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl);
    const lobe = Math.pow(ndh, 60) * 0.55 * s.gloss * lit;
    out[0] += F * skyR[0] * (0.55 + 0.45 * lit) + lobe * sc[0];
    out[1] += F * skyR[1] * (0.55 + 0.45 * lit) + lobe * sc[1];
    out[2] += F * skyR[2] * (0.55 + 0.45 * lit) + lobe * sc[2];
    // Painter's gravity: the near slabs are held down in value so the light glows beyond.
    const near = 0.7 + 0.3 * smoothstep(1.2, 9, t);
    out[0] *= near;
    out[1] *= near;
    out[2] *= near;
    // The cast shadow is a painter's shadow: deep, and cooled by the open sky.
    if (shadow > 0) {
      const k = 1 - 0.62 * shadow;
      out[0] *= k * (1 - 0.06 * shadow);
      out[1] *= k;
      out[2] *= k * (1 + 0.08 * shadow);
    }

    if (info) {
      info.obj = OBJ.PAVEMENT;
      const px = camera.project(P);
      info.angle = Math.atan2(vp[1] - px[1], vp[0] - px[0]);
      info.shadow = shadow;
      info.joint = joint;
    }
  }

  return { hit, shade, course };
}

// Coping blocks along both edges and boulders at the foot of the seaward wall.
export function makeBreakwaterPrims(L, seed) {
  const { left, right } = L.pavement;
  const prims = [];
  for (const side of [-1, 1]) {
    const rng = rngFor(seed, 0xc0b, side);
    let z = rng.range(-1, 0.3);
    while (z < 170) {
      const len = rng.range(1.05, 1.7);
      const gap = rng.range(0.02, 0.06);
      const hx = rng.range(0.24, 0.34);
      const top = rng.chance(0.25) ? rng.range(0.06, 0.16) : rng.range(0.0, 0.05);
      const hy = 0.3;
      const cx = side > 0 ? right - hx : left + hx;
      const m = mulMM(rotY(rng.normal() * 0.02), mulMM(rotZ(rng.normal() * 0.025), rotX(rng.normal() * 0.012)));
      const c = [cx, top - hy, z + len / 2];
      prims.push(new Box(c, m, [hx, hy, len / 2 - gap / 2], 'coping', OBJ.STONE, { tone: rng.normal() * 0.1 }, 0.035));
      z += len;
    }
  }
  // Toe boulders: clusters of dark, wet, half-drowned rocks beyond the seaward wall.
  const rng = rngFor(seed, 0xb01d);
  // The rocks where the spray bursts.
  for (let i = 0; i < 5; i++) {
    const size = rng.range(0.5, 0.9);
    const c = [L.spray.x + rng.normal() * 0.5, L.seaLevel + rng.range(-0.25, 0.1) * size, L.spray.z + rng.normal() * 0.6];
    const m = frameAlong([rng.normal() * 0.5, rng.normal() * 0.25, 1], [rng.normal() * 0.5, 1, rng.normal() * 0.4]);
    prims.push(new Ellipsoid(c, m, [size * rng.range(0.9, 1.5), size * rng.range(0.35, 0.5), size * rng.range(0.7, 1.2)], 'boulder', OBJ.STONE, { tone: rng.normal() * 0.12 }));
  }
  let z = 14;
  while (z < 260) {
    const scale = rng.range(0.6, 1.3) * (1 + z / 250);
    const cx = right + rng.range(1.7, 3.2);
    const n = rng.int(2, 5);
    for (let i = 0; i < n; i++) {
      const size = scale * rng.range(0.35, 0.8);
      const c = [cx + rng.normal() * 0.5 * scale, L.seaLevel + rng.range(-0.32, 0.12) * size, z + rng.normal() * 0.7 * scale];
      const m = frameAlong([rng.normal() * 0.5, rng.normal() * 0.25, 1], [rng.normal() * 0.5, 1, rng.normal() * 0.4]);
      prims.push(new Ellipsoid(c, m, [size * rng.range(0.8, 1.5), size * rng.range(0.3, 0.5), size * rng.range(0.6, 1.2)], 'boulder', OBJ.STONE, { tone: rng.normal() * 0.12 }));
    }
    z += rng.range(4, 14) * (1 + z / 90);
  }
  return prims;
}
