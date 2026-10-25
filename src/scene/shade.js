// Material shading for ray-traced primitives. Every material returns linear RGB plus
// style hints for the painter (object class, stroke angle, impasto, rim light).
import { mixPaint } from '../lib/color.js';
import { clamp } from '../lib/noise.js';
import { OBJ } from './objects.js';

const GRANITE = mixPaint({ W: 0.6, K: 0.034, O: 0.09 });
const WET_ROCK = mixPaint({ W: 0.4, K: 0.05, O: 0.06 });

export function makeShader(ctx) {
  const { lighting, sky, noise, L } = ctx;
  const amb = [0, 0, 0];
  const skyR = [0, 0, 0];
  const haze = [0, 0, 0];
  const hz = [0, 0, 0];
  const materials = { ...(ctx.materials || {}) };

  // Lambert + ambient + sun lobe; returns the sun-facing amount for style hints.
  function lit(albedo, n, d, out, { shadow = 0, spec = 0, shininess = 40, sheen = 0 } = {}) {
    const sun = lighting.sun;
    const sc = lighting.sunColor;
    lighting.ambient(n, amb);
    const ndl = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) * (1 - shadow);
    out[0] = albedo[0] * (amb[0] + sc[0] * ndl);
    out[1] = albedo[1] * (amb[1] + sc[1] * ndl);
    out[2] = albedo[2] * (amb[2] + sc[2] * ndl);
    if (spec > 0) {
      const hx = sun[0] - d[0];
      const hy = sun[1] - d[1];
      const hzz = sun[2] - d[2];
      const hl = Math.hypot(hx, hy, hzz);
      const ndh = Math.min(1, Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hzz) / hl));
      const s = Math.pow(ndh, shininess) * spec * (1 - shadow);
      out[0] += s * sc[0];
      out[1] += s * sc[1];
      out[2] += s * sc[2];
    }
    if (sheen > 0) {
      const dn = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
      skyR[0] = d[0] - 2 * dn * n[0];
      skyR[1] = Math.max(0.002, d[1] - 2 * dn * n[1]);
      skyR[2] = d[2] - 2 * dn * n[2];
      const l = Math.hypot(skyR[0], skyR[1], skyR[2]);
      skyR[0] /= l;
      skyR[1] /= l;
      skyR[2] /= l;
      sky.color(skyR, hz, null, true);
      const F = (0.04 + 0.96 * Math.pow(1 - clamp(-dn, 0, 1), 5)) * sheen;
      out[0] += F * hz[0];
      out[1] += F * hz[1];
      out[2] += F * hz[2];
    }
    return ndl;
  }

  // Perturb a normal with two-scale noise so stones are not machined.
  function bump(n, P, amount, freq) {
    const bx = noise.noise2(P[0] * freq + P[1] * 0.7, P[2] * freq) * amount;
    const by = noise.noise2(P[1] * freq + 17, P[2] * freq - P[0]) * amount;
    const bz = noise.noise2(P[0] * freq - 29, P[1] * freq + P[2] * 0.5) * amount;
    const x = n[0] + bx;
    const y = n[1] + by;
    const z = n[2] + bz;
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  }

  materials.coping = (prim, P, n0, d, t, out, info) => {
    const n = bump(n0, P, 0.12, 4.5);
    const tone = 0.8 * Math.exp(prim.data.tone + noise.fbm2(P[0] * 2.1, P[2] * 1.3 + P[1] * 3, 3) * 0.18);
    const a = [GRANITE[0] * tone, GRANITE[1] * tone, GRANITE[2] * tone];
    const ndl = lit(a, n, d, out, { spec: 0.15, shininess: 30, sheen: 0.05 });
    info.obj = OBJ.STONE;
    info.light = ndl;
    info.impasto = 0.35 + ndl;
  };

  materials.boulder = (prim, P, n0, d, t, out, info) => {
    const n = bump(bump(n0, P, 0.35, 2.2), P, 0.15, 9);
    const tone = Math.exp(prim.data.tone + noise.fbm2(P[0] * 1.7, P[2] * 1.7 + P[1] * 2, 3) * 0.25);
    const a = [WET_ROCK[0] * tone, WET_ROCK[1] * tone, WET_ROCK[2] * tone];
    const ndl = lit(a, n, d, out, { spec: 0.45, shininess: 18, sheen: 0.3 });
    info.obj = OBJ.STONE;
    info.light = ndl;
    info.impasto = 0.3 + ndl;
  };

  function fog(out, t, d) {
    const f = 1 - Math.exp(-t / L.sea.hazeDistance);
    if (f < 0.001) return;
    haze[0] = d[0];
    haze[1] = 0.0005;
    haze[2] = d[2];
    sky.color(haze, hz, null, true);
    out[0] += (hz[0] - out[0]) * f;
    out[1] += (hz[1] - out[1]) * f;
    out[2] += (hz[2] - out[2]) * f;
  }

  function shadeHit(prim, P, n, d, t, out, info) {
    const m = materials[prim.mat];
    if (!m) throw new Error(`no material ${prim.mat}`);
    m(prim, P, n, d, t, out, info);
    fog(out, t, d);
    // Distant flock birds melt into the glare: fainter with every place in the line.
    const fade = prim.data.fade;
    if (fade) {
      sky.color(d, hz, null, true);
      out[0] += (hz[0] - out[0]) * fade;
      out[1] += (hz[1] - out[1]) * fade;
      out[2] += (hz[2] - out[2]) * fade;
      info.fade = fade;
    }
  }

  return { shadeHit, lit, fog, bump, materials };
}
