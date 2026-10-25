// An old black steel roadster, modelled in 3D so the wheels, spokes, chainline and
// cranks are always consistent with the camera. Local frame: x forward, y up, z to the
// bike's left; the origin is on the ground below the bottom bracket.
import { mixPaint } from '../lib/color.js';
import { smoothstep, clamp } from '../lib/noise.js';
import { frameAlong, norm, cross } from '../lib/vec.js';
import { Capsule, Box, Plate, Sphere, Ellipsoid } from './primitives.js';
import { OBJ } from './objects.js';
import { screenAngle } from './light.js';

// Geometry (metres): a 22-inch junior roadster, small enough for a pelican to stand on.
export const BIKE = {
  tyreOuter: 0.282,
  tyreTube: 0.017,
  rimR: 0.246,
  bbHeight: 0.255,
  chainstay: 0.405,
  wheelbase: 0.93,
  seatAngle: (71 * Math.PI) / 180,
  headAngle: (68 * Math.PI) / 180,
  seatTube: 0.4,
  crank: 0.15,
  chainringR: 0.089, // 44T
  cogR: 0.0366, // 18T
  chainZ: -0.046, // drive side is the bike's right (negative z)
  crankAngleR: (78 * Math.PI) / 180, // right crank nearly straight up, a little forward
  tube: 0.0135,
  stay: 0.0085,
};

export function makeBicycle(L) {
  const B = BIKE;
  const base = [L.rider.x, 0, L.rider.z];
  const psi = 0; // heading straight along the breakwater, toward the sun
  const fx = [Math.sin(psi), 0, Math.cos(psi)];
  const fz = [-Math.cos(psi), 0, Math.sin(psi)];
  const W = (x, y, z) => [base[0] + x * fx[0] + z * fz[0], y, base[2] + x * fx[2] + z * fz[2]];
  const dirW = (x, y, z) => norm([x * fx[0] + z * fz[0], y, x * fx[2] + z * fz[2]]);

  // Key points (local).
  const R = B.tyreOuter;
  const bb = [0, B.bbHeight, 0];
  const rearHub = [-Math.sqrt(B.chainstay ** 2 - (R - B.bbHeight) ** 2), R, 0];
  const frontHub = [rearHub[0] + B.wheelbase, R, 0];
  const seatDir = [-Math.cos(B.seatAngle), Math.sin(B.seatAngle)];
  const seatTop = [bb[0] + seatDir[0] * B.seatTube, bb[1] + seatDir[1] * B.seatTube, 0];
  const steer = [-Math.cos(B.headAngle), Math.sin(B.headAngle)]; // up the steering axis
  const trail = 0.055;
  const ground = frontHub[0] + trail;
  const onAxis = (h) => [ground + (steer[0] * h) / steer[1], h, 0];
  const headBot = onAxis(0.5);
  const headTop = onAxis(seatTop[1] + 0.02);
  const stemTop = onAxis(seatTop[1] + 0.11);
  // Saddle dropped low on its post: the rider stands, his belly just clears it.
  const saddle = [seatTop[0] + seatDir[0] * 0.035, seatTop[1] + seatDir[1] * 0.035 + 0.008, 0];
  const grips = [-1, 1].map((s) => [stemTop[0] - 0.035, stemTop[1] + 0.02, s * 0.2]);

  const prims = [];
  const lines = [];
  const joints = [bb, seatTop, headTop, headBot, rearHub, frontHub].map((p) => W(...p));
  const mat = (name, extra = {}) => ({ joints, ...extra });

  const tube = (a, b, r, name = 'enamel', obj = OBJ.BIKE, data = {}) =>
    prims.push(new Capsule(W(...a), W(...b), r, name, obj, mat(name, data)));

  // Frame.
  tube([bb[0] + 0.01, bb[1] + 0.02, 0], seatTop, B.tube);
  tube(seatTop, [headTop[0] - 0.01, headTop[1], 0], B.tube); // top tube, level
  tube([headBot[0] - 0.01, headBot[1] + 0.03, 0], [bb[0] + 0.012, bb[1] + 0.005, 0], B.tube * 1.08);
  tube(headBot, [headTop[0], headTop[1] + 0.012, 0], B.tube * 1.25); // head tube
  for (const s of [-1, 1]) {
    tube([bb[0] - 0.01, bb[1], s * 0.028], [rearHub[0] + 0.015, rearHub[1], s * 0.062], B.stay); // chainstays
    tube([seatTop[0] - 0.005, seatTop[1] - 0.02, s * 0.022], [rearHub[0] + 0.01, rearHub[1] + 0.01, s * 0.062], B.stay * 0.92); // seatstays
    // Fork blades with a little forward rake near the dropouts.
    const crown = [headBot[0] + 0.004, headBot[1] - 0.02, s * 0.036];
    const mid = [crown[0] + (frontHub[0] - crown[0]) * 0.55 - 0.012, crown[1] + (frontHub[1] - crown[1]) * 0.55, s * 0.05];
    tube(crown, mid, 0.011);
    tube(mid, [frontHub[0], frontHub[1], s * 0.052], 0.0095);
  }
  // Lugs and shells (rust gathers here).
  prims.push(new Capsule(W(0, bb[1], 0.04), W(0, bb[1], -0.04), 0.021, 'enamel', OBJ.BIKE, mat('bbshell', { rustBoost: 1 })));
  prims.push(new Sphere(W(...seatTop), 0.019, 'enamel', OBJ.BIKE, mat('lug', { rustBoost: 1 })));
  // Seat post, saddle, springs.
  tube(seatTop, [saddle[0] + 0.01, saddle[1] - 0.03, 0], 0.0115, 'steel');
  // Sprung leather saddle: broad rear, narrow nose, two coil springs.
  const sFwd = dirW(1, -0.05, 0);
  prims.push(new Ellipsoid(W(saddle[0] - 0.035, saddle[1], 0), frameAlong(sFwd, [0, 1, 0]), [0.085, 0.024, 0.078], 'leather', OBJ.BIKE, mat('saddle')));
  prims.push(new Ellipsoid(W(saddle[0] + 0.07, saddle[1] - 0.004, 0), frameAlong(sFwd, [0, 1, 0]), [0.07, 0.018, 0.03], 'leather', OBJ.BIKE, mat('saddle')));
  for (const s of [-1, 1]) {
    prims.push(new Capsule(W(saddle[0] - 0.08, saddle[1] - 0.02, s * 0.045), W(saddle[0] - 0.08, saddle[1] - 0.055, s * 0.045), 0.009, 'steel', OBJ.BIKE, mat('spring')));
  }
  // Stem and swept-back bars.
  tube([headTop[0], headTop[1] + 0.01, 0], stemTop, 0.012, 'steel');
  const clamp0 = [stemTop[0] + 0.02, stemTop[1] + 0.01, 0];
  for (const s of [-1, 1]) {
    const bend = [clamp0[0] + 0.005, clamp0[1] + 0.01, s * 0.135];
    tube(clamp0, bend, 0.0105, 'steel');
    tube(bend, grips[(s + 1) / 2], 0.0105, 'steel');
    const g = grips[(s + 1) / 2];
    prims.push(new Capsule(W(g[0] + 0.01, g[1], g[2]), W(g[0] - 0.085, g[1] - 0.005, g[2] + s * 0.02), 0.016, 'leather', OBJ.BIKE, mat('grip')));
  }

  // Wheels: tyre and rim as capsule rings in the wheel plane; spokes as lines.
  const ring = (hub, radius, tubeR, n, name, obj) => {
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = [hub[0] + Math.cos(a) * radius, hub[1] + Math.sin(a) * radius, 0];
      if (prev) prims.push(new Capsule(W(...prev), W(...p), tubeR, name, obj, mat(name)));
      prev = p;
    }
  };
  for (const hub of [rearHub, frontHub]) {
    ring(hub, R - B.tyreTube, B.tyreTube, 72, 'tyre', OBJ.TIRE);
    ring(hub, B.rimR, 0.0075, 72, 'rim', OBJ.BIKE);
    prims.push(new Capsule(W(hub[0], hub[1], 0.05), W(hub[0], hub[1], -0.05), 0.016, 'steel', OBJ.BIKE, mat('hub')));
    for (const s of [-1, 1]) {
      prims.push(new Plate(W(hub[0], hub[1], s * 0.03), frameAlong(dirW(1, 0, 0), dirW(0, 0, 1)), 0.026, 0.026, (u, v) => u * u + v * v < 1, 'steel', OBJ.BIKE, mat('flange')));
    }
    // 36 spokes, three-cross: flange hole at angle phi goes to the rim at phi +/- 60 degrees.
    for (let i = 0; i < 36; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const phi = (Math.floor(i / 2) / 18) * Math.PI * 2 + (side > 0 ? 0 : Math.PI / 18);
      const dir = Math.floor(i / 2) % 2 === 0 ? 1 : -1;
      const rimA = phi + dir * (Math.PI / 3);
      const a = W(hub[0] + Math.cos(phi) * 0.022, hub[1] + Math.sin(phi) * 0.022, side * 0.03);
      const b = W(hub[0] + Math.cos(rimA) * (B.rimR - 0.004), hub[1] + Math.sin(rimA) * (B.rimR - 0.004), side * 0.004);
      lines.push({ a, b, r: 0.0011, kind: 'spoke', obj: OBJ.SPOKE, dull: (((i * 7919) % 13) / 13) ** 2 });
    }
  }

  // Drivetrain on the right (camera) side.
  const cz = B.chainZ;
  const cringPlate = new Plate(
    W(bb[0], bb[1], cz),
    frameAlong(dirW(1, 0, 0), dirW(0, 0, 1)),
    B.chainringR + 0.004,
    B.chainringR + 0.004,
    (u, v) => {
      const r = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      const tooth = 0.955 + 0.045 * (Math.cos(a * 44) > 0 ? 1 : 0);
      if (r > tooth) return false;
      if (r < 0.2) return true; // spider centre
      if (r > 0.72) return true; // the ring
      // five arms
      const arm = Math.abs(Math.sin((a * 5) / 2));
      return arm < 0.12;
    },
    'enamel',
    OBJ.BIKE,
    mat('chainring', { rustBoost: 0.6 }),
  );
  prims.push(cringPlate);
  prims.push(new Plate(W(rearHub[0], rearHub[1], cz), frameAlong(dirW(1, 0, 0), dirW(0, 0, 1)), B.cogR + 0.003, B.cogR + 0.003, (u, v) => Math.hypot(u, v) < 0.93 + 0.07 * (Math.cos(Math.atan2(v, u) * 18) > 0 ? 1 : 0), 'steel', OBJ.BIKE, mat('cog')));

  // Chain: external tangents between chainring and cog, plus the wraps.
  const chainPts = chainPath([bb[0], bb[1]], B.chainringR, [rearHub[0], rearHub[1]], B.cogR);
  for (let i = 0; i + 1 < chainPts.length; i++) {
    const p = chainPts[i];
    const q = chainPts[i + 1];
    lines.push({ a: W(p[0], p[1], cz), b: W(q[0], q[1], cz), r: 0.0034, kind: 'chain', obj: OBJ.BIKE, s0: p[2] });
  }

  // Cranks and pedals (rat-trap pedals parallel to the axle).
  const pedals = [];
  for (const side of [-1, 1]) {
    const ang = side < 0 ? B.crankAngleR : B.crankAngleR + Math.PI;
    const zc = side < 0 ? -0.07 : 0.07;
    const end = [bb[0] + Math.cos(ang) * B.crank, bb[1] + Math.sin(ang) * B.crank, zc];
    prims.push(new Capsule(W(bb[0], bb[1], zc), W(...end), 0.011, 'steel', OBJ.BIKE, mat('crank')));
    const pc = [end[0], end[1], zc + side * 0.065];
    prims.push(new Capsule(W(...end), W(end[0], end[1], zc + side * 0.115), 0.006, 'steel', OBJ.BIKE, mat('axle')));
    for (const dx of [-0.03, 0.03]) {
      // Rat-trap cage plates: worn bright steel along the serrated top edge, rust below.
      prims.push(new Box(W(pc[0] + dx, pc[1], pc[2]), frameAlong(dirW(0, 0, 1), [0, 1, 0]), [0.048, 0.008, 0.006], 'steel', OBJ.BIKE, mat('pedal', { rustBoost: 0.5 })));
    }
    pedals.push({ side, centre: W(...pc), local: pc });
  }

  return {
    prims,
    lines,
    W,
    dirW,
    local: { bb, rearHub, frontHub, seatTop, headTop, headBot, stemTop, saddle, grips },
    pedals,
    grips: grips.map((g) => W(...g)),
    contacts: [W(rearHub[0], 0, 0), W(frontHub[0], 0, 0)],
  };
}

// Points [x, y, s] around chainring (c1, r1) and cog (c2, r2); s is arc length (for link texture).
function chainPath(c1, r1, c2, r2) {
  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];
  const dist = Math.hypot(dx, dy);
  const u = [dx / dist, dy / dist];
  const n = [-u[1], u[0]];
  const sa = (r1 - r2) / dist;
  const ca = Math.sqrt(1 - sa * sa);
  const mA = [n[0] * ca + u[0] * sa, n[1] * ca + u[1] * sa];
  const mB = [-n[0] * ca + u[0] * sa, -n[1] * ca + u[1] * sa];
  const top = mA[1] > mB[1] ? mA : mB;
  const bot = mA[1] > mB[1] ? mB : mA;
  const angTop = Math.atan2(top[1], top[0]);
  const angBot = Math.atan2(bot[1], bot[0]);
  const pts = [];
  let s = 0;
  const push = (x, y) => {
    if (pts.length) s += Math.hypot(x - pts[pts.length - 1][0], y - pts[pts.length - 1][1]);
    pts.push([x, y, s]);
  };
  // Top run from chainring to cog, wrap the back of the cog, bottom run, wrap the front of the ring.
  push(c1[0] + top[0] * r1, c1[1] + top[1] * r1);
  push(c2[0] + top[0] * r2, c2[1] + top[1] * r2);
  let a0 = angTop;
  let a1 = angBot;
  while (a1 < a0) a1 += Math.PI * 2;
  for (let i = 1; i <= 16; i++) {
    const a = a0 + ((a1 - a0) * i) / 16;
    push(c2[0] + Math.cos(a) * r2, c2[1] + Math.sin(a) * r2);
  }
  push(c1[0] + bot[0] * r1, c1[1] + bot[1] * r1);
  a0 = angBot;
  a1 = angTop;
  while (a1 < a0) a1 += Math.PI * 2;
  for (let i = 1; i <= 28; i++) {
    const a = a0 + ((a1 - a0) * i) / 28;
    push(c1[0] + Math.cos(a) * r1, c1[1] + Math.sin(a) * r1);
  }
  return pts;
}

// Materials for the bicycle.
export function bikeMaterials(ctx) {
  const { shader, noise, lighting, camera } = ctx;
  const ENAMEL = mixPaint({ K: 0.9, W: 0.07, O: 0.03 });
  const RUST = mixPaint({ O: 0.55, V: 0.25, K: 0.2 });
  const RUST_DARK = mixPaint({ O: 0.35, V: 0.2, K: 0.45 });
  const STEEL = mixPaint({ W: 0.35, K: 0.06, O: 0.04 });
  const TYRE = mixPaint({ K: 0.85, W: 0.15 });
  const LEATHER = mixPaint({ V: 0.15, O: 0.3, K: 0.55 });
  function rustAmount(prim, P) {
    let near = Infinity;
    for (const j of prim.data.joints || []) near = Math.min(near, Math.hypot(P[0] - j[0], P[1] - j[1], P[2] - j[2]));
    const n = noise.fbm2(P[0] * 40 + P[2] * 13, P[1] * 40, 3);
    const joint = 1 - smoothstep(0.02, 0.09, near);
    return clamp(joint * 1.3 + (prim.data.rustBoost || 0) * 0.5 + n * 0.9 - 0.35);
  }

  function metal(albedo, prim, P, n, d, out, info, { spec = 0.9, shininess = 60, sheen = 0.25, rusty = true } = {}) {
    let a = albedo;
    let r = 0;
    if (rusty) {
      r = rustAmount(prim, P);
      if (r > 0) {
        const pit = noise.noise2(P[0] * 200, P[1] * 200 + P[2] * 90) * 0.5 + 0.5;
        const rc = pit > 0.5 ? RUST : RUST_DARK;
        a = [albedo[0] + (rc[0] - albedo[0]) * r, albedo[1] + (rc[1] - albedo[1]) * r, albedo[2] + (rc[2] - albedo[2]) * r];
      }
    }
    const ndl = shader.lit(a, n, d, out, { spec: spec * (1 - r * 0.85), shininess, sheen: sheen * (1 - r) });
    info.obj = r > 0.55 ? OBJ.RUST : prim.obj;
    info.light = ndl;
    info.impasto = 0.25 + ndl * 0.8;
    return r;
  }

  // Strokes run along tubes.
  const along = (prim, P) => (prim.ba ? screenAngle(camera, P, prim.ba) : 0);

  const m = {
    enamel(prim, P, n, d, t, out, info) {
      metal(ENAMEL, prim, P, n, d, out, info, { spec: 1.1, shininess: 70, sheen: 0.3 });
      info.angle = along(prim, P);
    },
    steel(prim, P, n, d, t, out, info) {
      metal(STEEL, prim, P, n, d, out, info, { spec: 1.2, shininess: 45, sheen: 0.35 });
      info.angle = along(prim, P);
    },
    rim(prim, P, n, d, t, out, info) {
      metal(ENAMEL, prim, P, n, d, out, info, { spec: 1.2, shininess: 60, sheen: 0.35 });
      info.obj = OBJ.TIRE;
      info.angle = along(prim, P);
    },
    tyre(prim, P, n, d, t, out, info) {
      const ndl = shader.lit(TYRE, n, d, out, { spec: 0.25, shininess: 12, sheen: 0.1 });
      info.obj = OBJ.TIRE;
      info.light = ndl;
      info.impasto = 0.2 + ndl;
      info.angle = along(prim, P);
    },
    leather(prim, P, n, d, t, out, info) {
      const ndl = shader.lit(LEATHER, n, d, out, { spec: 0.4, shininess: 20, sheen: 0.15 });
      info.obj = OBJ.BIKE;
      info.light = ndl;
      info.impasto = 0.25 + ndl;
    },
  };

  // Shading for thin lines (spokes, chain): a cylinder's glint where its axis is perpendicular
  // to the half vector between eye and sun.
  function shadeLine(line, P, out, info) {
    const eye = camera.eye;
    const d = norm([P[0] - eye[0], P[1] - eye[1], P[2] - eye[2]]);
    const axis = norm([line.b[0] - line.a[0], line.b[1] - line.a[1], line.b[2] - line.a[2]]);
    const sun = lighting.sun;
    const h = norm([sun[0] - d[0], sun[1] - d[1], sun[2] - d[2]]);
    const ah = axis[0] * h[0] + axis[1] * h[1] + axis[2] * h[2];
    const glint = Math.pow(Math.max(0, 1 - ah * ah), 400) * (1 - (line.dull || 0));
    // A sideways normal facing the viewer, for the ambient term.
    let nrm = cross(axis, cross([-d[0], -d[1], -d[2]], axis));
    nrm = norm(nrm);
    const base = line.kind === 'spoke' ? STEEL : ENAMEL;
    shader.lit(base, nrm, d, out);
    const sc = lighting.sunColor;
    const g = glint * (line.kind === 'spoke' ? 0.9 : 0.35);
    out[0] += g * sc[0];
    out[1] += g * sc[1];
    out[2] += g * sc[2];
    if (line.kind === 'chain') {
      const s = line.s0 + Math.hypot(P[0] - line.a[0], P[1] - line.a[1], P[2] - line.a[2]);
      const link = Math.cos((s / 0.0127) * Math.PI * 2) > 0.3 ? 1.6 : 0.7;
      out[0] *= link;
      out[1] *= link;
      out[2] *= link;
      const rust = clamp(noise.noise2(s * 30, 3) + 0.2);
      out[0] += (RUST_DARK[0] * 0.5 - out[0]) * rust * 0.6;
      out[1] += (RUST_DARK[1] * 0.5 - out[1]) * rust * 0.6;
      out[2] += (RUST_DARK[2] * 0.5 - out[2]) * rust * 0.6;
    }
    shader.fog(out, Math.hypot(P[0] - eye[0], P[1] - eye[1], P[2] - eye[2]), d);
    info.obj = line.obj;
    info.light = glint;
    info.impasto = 0.2 + glint;
  }

  return { materials: m, shadeLine };
}
