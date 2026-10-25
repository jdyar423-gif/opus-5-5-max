// Six pelicans gliding in single file toward the sun, the rider the last bird in the line.
// They sit on the picture's line from his crown to the vanishing point; each bird's
// depth is chosen so its 2.1 m wingspan projects to a planned, shrinking size.
import { Rng } from '../lib/rng.js';
import { norm, cross, deg } from '../lib/vec.js';
import { buildPelican, Xf } from './pelican.js';

const WINGSPAN = 2.1;

// t: position along crown -> vanishing point; span: projected wingspan (canvas heights);
// fade: how far each melts into the haze.
const PLAN = [
  { t: 0.4, span: 0.13, fade: 0.05, lift: -0.004 },
  { t: 0.565, span: 0.096, fade: 0.11, lift: 0.002 },
  { t: 0.685, span: 0.071, fade: 0.18, lift: -0.002 },
  { t: 0.775, span: 0.052, fade: 0.25, lift: 0.001 },
  { t: 0.84, span: 0.038, fade: 0.31, lift: 0 },
  { t: 0.885, span: 0.029, fade: 0.36, lift: 0.001 },
];

export function makeFlock(ctx, crown) {
  const { camera, L, seed } = ctx;
  const head = camera.project(crown);
  const vp = [L.vpX, L.horizon];
  const rng = new Rng(seed ^ 0xf10c);
  const prims = [];
  const birds = [];
  const d = [0, 0, 0];
  PLAN.forEach((b, i) => {
    const px = head[0] + (vp[0] - head[0]) * b.t;
    const py = head[1] + (vp[1] - head[1]) * b.t + b.lift;
    const z = (camera.f * WINGSPAN) / b.span; // camera-space depth
    camera.dir(px, py, d);
    const k = z / (d[0] * camera.fwd[0] + d[2] * camera.fwd[2]);
    const pos = [camera.eye[0] + d[0] * k, camera.eye[1] + d[1] * k, camera.eye[2] + d[2] * k];
    // Heading toward the sun with a little individual bank and pitch.
    const yaw = rng.normal() * deg(3);
    const roll = rng.normal() * deg(4);
    const pitch = rng.normal() * deg(2);
    const ax = norm([Math.sin(yaw), Math.sin(pitch), Math.cos(yaw)]);
    let ay = [Math.sin(roll), Math.cos(roll), 0];
    const az = norm(cross(ax, ay));
    ay = cross(az, ax);
    const xf = new Xf(pos, ax, ay, az);
    const built = buildPelican({ xf, pose: 'glide', seed: seed * 31 + i, detail: i < 2 ? 0.5 : 0 });
    for (const p of built.prims) p.data = { ...p.data, fade: b.fade, bird: i };
    prims.push(...built.prims);
    birds.push({ index: i, pos, img: [px, py], span: b.span, fade: b.fade, xf });
  });
  return { prims, birds };
}
