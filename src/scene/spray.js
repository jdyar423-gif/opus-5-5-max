// A wave bursting against the seaward wall: ballistic droplet clumps and a soft mist,
// lit from behind (strong forward scattering) and splatted over the reference.
import { Rng } from '../lib/rng.js';
import { oklch } from '../lib/color.js';
import { OBJ } from './objects.js';

export function makeSpray(ctx) {
  const { L, seed, camera, lighting } = ctx;
  const rng = new Rng(seed ^ 0x5b7a);
  const zc = L.spray.z;
  const sea = L.seaLevel;
  const parts = [];
  const g = -9.8;
  // Droplet clumps thrown up off the rocks in a fan, torn back by the wind.
  const xc = L.spray.x;
  for (let i = 0; i < 4200; i++) {
    const s = [xc + rng.normal() * 0.45, sea + 0.3, zc + rng.normal() * 0.6];
    const lean = rng.normal() * 0.2 + 0.06; // radians off vertical
    const speed = rng.range(4, 9) * (1 - 0.3 * Math.min(1, Math.abs(s[2] - zc) / 1.5));
    const vy = speed * Math.cos(lean);
    const vx = speed * Math.sin(lean);
    const vz = rng.normal() * 0.5;
    const tUp = -vy / g;
    const t = Math.pow(rng.next(), 0.8) * 1.8 * tUp;
    const wind = -1.2 * t * t;
    const P = [s[0] + vx * t, s[1] + vy * t + 0.5 * g * t * t, s[2] + vz * t + wind];
    if (P[1] < sea + 0.2) continue;
    // Dense at the base, breaking into finer spray as it rises and spends itself.
    const r = rng.range(0.03, 0.09) * (1.4 - 0.6 * Math.min(1, t / tUp));
    parts.push({ P, r, a: rng.range(0.1, 0.25), kind: 0 });
  }
  // Jets: sheets of water thrown up off the rocks, each a continuous arc that thins and
  // breaks into drops as it rises and the wind bends it back.
  for (let j = 0; j < 11; j++) {
    const s = [xc + rng.normal() * 0.35, sea + 0.35, zc + rng.normal() * 0.35];
    const lean = rng.normal() * 0.28 + 0.04;
    const speed = rng.range(5.5, 9.5);
    const vy = speed * Math.cos(lean);
    const vx = speed * Math.sin(lean);
    const vz = rng.normal() * 0.4;
    const tUp = -vy / g;
    const tEnd = tUp * rng.range(1.0, 1.6);
    const steps = 70;
    for (let k = 0; k < steps; k++) {
      const t = (k / steps) * tEnd;
      const P = [s[0] + vx * t + rng.normal() * 0.03, s[1] + vy * t + 0.5 * g * t * t, s[2] + vz * t - 1.2 * t * t];
      if (P[1] < sea + 0.2) break;
      const f = k / steps;
      parts.push({ P, r: (0.075 - 0.05 * f) * rng.range(0.8, 1.2), a: (0.2 - 0.12 * f) * (rng.chance(0.15 + 0.5 * f) ? 0.3 : 1), kind: 0 });
    }
  }
  // White water heaped on the rocks where the wave breaks.
  for (let i = 0; i < 70; i++) {
    const P = [xc + rng.normal() * 0.55, sea + 0.25 + Math.abs(rng.normal()) * 0.35, zc + rng.normal() * 0.55];
    parts.push({ P, r: rng.range(0.1, 0.24), a: rng.range(0.2, 0.38), kind: 2 });
  }
  // Mist: faint, drifting back toward the viewer.
  for (let i = 0; i < 40; i++) {
    const h = Math.pow(rng.next(), 0.8);
    const P = [xc + rng.normal() * 0.6, sea + 1 + h * 3.4, zc + rng.normal() * 0.8 - h * 1.5];
    parts.push({ P, r: rng.range(0.2, 0.5) * (0.6 + h), a: rng.range(0.015, 0.035), kind: 1 });
  }
  // Paint far to near so nearer clumps sit on top.
  parts.sort((a, b) => b.P[2] - a.P[2]);

  const base = oklch(0.84, 0.02, 85);
  const glowCol = oklch(0.97, 0.05, 82);
  const sun = lighting.sun;
  const impact = camera.project([L.spray.x, sea + 0.3, zc]);

  return function overlay(ref) {
    const { W, H, region } = ctx;
    const rw = region.x1 - region.x0;
    const p = [0, 0, 0];
    for (const q of parts) {
      camera.project(q.P, p);
      if (p[2] <= 0.1) continue;
      const cx = p[0] * H;
      const cy = p[1] * H;
      const rad = Math.max(0.8, (camera.f * q.r * H) / p[2]);
      const x0 = Math.max(region.x0, Math.floor(cx - rad * 2));
      const x1 = Math.min(region.x1 - 1, Math.ceil(cx + rad * 2));
      const y0 = Math.max(region.y0, Math.floor(cy - rad * 2));
      const y1 = Math.min(region.y1 - 1, Math.ceil(cy + rad * 2));
      if (x0 > x1 || y0 > y1) continue;
      const ex = q.P[0] - camera.eye[0];
      const ey = q.P[1] - camera.eye[1];
      const ez = q.P[2] - camera.eye[2];
      const dist = Math.hypot(ex, ey, ez);
      // Henyey-Greenstein forward scattering: the spray blazes when it stands in the sun's path.
      const cosT = (ex * sun[0] + ey * sun[1] + ez * sun[2]) / dist;
      const gg = 0.82;
      const hg = (1 - gg * gg) / Math.pow(1 + gg * gg - 2 * gg * cosT, 1.5) / (4 * Math.PI);
      // Mist glows softly; the heaped foam is dense, so it is lit less right through.
      // (Held below the sun: the spray must not out-shine the light it stands in.)
      const light = Math.min(1.1, 0.22 + hg * 1.05) * (q.kind === 1 ? 0.55 : q.kind === 2 ? 0.62 : 1);
      const col = [0, 0, 0];
      for (let k = 0; k < 3; k++) col[k] = base[k] * 0.6 + glowCol[k] * light * 0.7;
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = (px + 0.5 - cx) / rad;
          const dy = (py + 0.5 - cy) / rad;
          const r2 = dx * dx + dy * dy;
          if (r2 > 4) continue;
          const pi = (py - region.y0) * rw + (px - region.x0);
          if (ref.depth[pi] < dist) continue;
          const a = q.a * Math.exp(-r2 * 1.6);
          const o = pi * 3;
          ref.color.data[o] += (col[0] - ref.color.data[o]) * a;
          ref.color.data[o + 1] += (col[1] - ref.color.data[o + 1]) * a;
          ref.color.data[o + 2] += (col[2] - ref.color.data[o + 2]) * a;
          ref.spray[pi] = Math.min(1, ref.spray[pi] + a * (q.kind === 1 ? 0.5 : 1));
          if (ref.spray[pi] > 0.35 && q.kind !== 1) {
            ref.obj[pi] = OBJ.SPRAY;
            ref.angle[pi] = Math.atan2(cy - impact[1] * H, cx - impact[0] * H);
            ref.impasto[pi] = 0.6 + 0.4 * Math.min(1, light);
            ref.light[pi] = light;
          }
        }
      }
    }
  };
}
