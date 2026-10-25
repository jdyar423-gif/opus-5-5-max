// A brown pelican (Pacific race, breeding plumage) built from analytic primitives.
// Two poses share the same body, folded neck and head ("exactly his horizontal posture"):
//   ride  - standing on the pedals, wing bends braced on the grips, near wing ragged
//   glide - wings spread, feet tucked (the flock)
// Coordinates: x forward, y up, z to the bird's left. `xf` maps them to the world.
import { Rng } from '../lib/rng.js';
import { norm, cross, dot, sub, add, scale, madd, frame, deg, len } from '../lib/vec.js';
import { Ellipsoid, RoundCone, Capsule, Plate, Sphere } from './primitives.js';
import { OBJ } from './objects.js';

// Local -> world rigid transform with axes given in world space.
export class Xf {
  constructor(origin, ax, ay, az) {
    this.o = origin;
    this.ax = ax;
    this.ay = ay;
    this.az = az;
  }

  p(x, y, z) {
    const { o, ax, ay, az } = this;
    return [o[0] + ax[0] * x + ay[0] * y + az[0] * z, o[1] + ax[1] * x + ay[1] * y + az[1] * z, o[2] + ax[2] * x + ay[2] * y + az[2] * z];
  }

  v(x, y, z) {
    const { ax, ay, az } = this;
    return [ax[0] * x + ay[0] * y + az[0] * z, ax[1] * x + ay[1] * y + az[1] * z, ax[2] * x + ay[2] * y + az[2] * z];
  }

  inv(P) {
    const d = sub(P, this.o);
    return [dot(d, this.ax), dot(d, this.ay), dot(d, this.az)];
  }
}

// Feather outlines in plate coordinates: u from base (-1) to tip (+1), v across (-1..1).
function featherWidth(u, kind) {
  if (kind === 'covert' || kind === 'scapular') {
    const base = 0.45 + 0.55 * Math.min(1, (u + 1) / 0.9);
    const tip = u > 0.35 ? Math.sqrt(Math.max(0, 1 - ((u - 0.35) / 0.65) ** 2)) : 1;
    return base * tip;
  }
  // Flight and tail feathers: narrow quill, long parallel vanes, rounded tip.
  const base = 0.3 + 0.7 * Math.min(1, (u + 1) / 0.5);
  const tip = u > 0.6 ? Math.sqrt(Math.max(0, 1 - ((u - 0.6) / 0.4) ** 2)) : 1;
  return base * tip;
}

function featherShape(u, v, data) {
  let w = featherWidth(u, data.kind);
  if (data.ragged) {
    // Old damage: notches and splits in the vane, worst toward the tip.
    const k = data.seed * 13.7;
    const n1 = Math.sin(u * 23 + k) * Math.sin(u * 9.3 + k * 1.7);
    const notch = Math.max(0, n1) ** 2 * data.ragged * (0.4 + 0.6 * Math.max(0, u));
    w *= 1 - notch * (v > 0 ? 1 : 0.45);
    if (u > 1 - data.ragged * 0.4 * (0.5 + 0.5 * Math.sin(v * 7 + k))) return false;
  }
  return Math.abs(v) < w;
}

export function featherEdge(u, v, data) {
  const w = featherWidth(u, data.kind) || 1e-3;
  return Math.min(1, Math.abs(v) / w);
}

// The riding posture in the bike's frame (origin on the ground below the bottom bracket).
const RIDE = {
  // Standing on the pedals: the body rides clear of the saddle, pitched forward.
  bodyC: [-0.07, 0.855, 0],
  bodyPitch: deg(-9),
  // The S-folded neck sits under and behind the head, a hump on the shoulders.
  neck: [
    [0.11, 0.87, 0, 0.06],
    [0.16, 0.93, 0, 0.053],
    [0.146, 0.975, 0, 0.046],
    [0.13, 1.003, 0, 0.041],
  ],
  headC: [0.172, 1.018, 0],
  headTurn: deg(22), // to his right, toward the viewer's side, so the bill reads in profile
  headPitch: deg(-8),
};

/**
 * pose: 'ride' | 'glide'. anchors (ride): grips and pedals by side (-1 right, +1 left),
 * in bird coordinates. detail: 1 rider, 0.5 near flock bird, 0 distant bird.
 */
export function buildPelican({ xf, pose = 'ride', anchors = null, seed = 1, detail = 1, raggedSide = -1 }) {
  const rng = new Rng(seed);
  const prims = [];
  const L = {}; // landmarks in world space
  const P = (p) => xf.p(p[0], p[1], p[2]);
  const V = (v) => norm(xf.v(v[0], v[1], v[2]));
  const ride = pose === 'ride';
  const o = (k) => (ride ? k : OBJ.FLOCK);

  const bodyC = ride ? RIDE.bodyC : [0, 0, 0];
  const off = (p) => (ride ? p.slice(0, 3) : [p[0] - RIDE.bodyC[0], p[1] - RIDE.bodyC[1], p[2] - RIDE.bodyC[2]]);
  const pitch = ride ? RIDE.bodyPitch : 0;
  const along = [Math.cos(pitch), Math.sin(pitch), 0];
  const up = [-Math.sin(pitch), Math.cos(pitch), 0];
  const left = [0, 0, 1];
  const bodyFrame = frame(V(along), V(up), V(left));
  const bp = (a, u, l) => add(add(add(bodyC, scale(along, a)), scale(up, u)), scale(left, l));
  const bodyData = (part) => ({ part, xf, bodyC, along, up });

  // --- body: trunk, deep breast, tapering rear, flat broad mantle
  prims.push(new Ellipsoid(P(bp(0.02, 0, 0)), bodyFrame, [0.2, 0.108, 0.13], 'body', o(OBJ.PLUMAGE), bodyData('body')));
  prims.push(new RoundCone(P(bp(-0.08, -0.004, 0)), P(bp(-0.24, 0.012, 0)), 0.09, 0.038, 'body', o(OBJ.PLUMAGE), bodyData('rump')));
  prims.push(new Ellipsoid(P(bp(0.14, -0.018, 0)), bodyFrame, [0.13, 0.1, 0.12], 'body', o(OBJ.PLUMAGE), bodyData('breast')));
  prims.push(new Ellipsoid(P(bp(-0.02, 0.043, 0)), bodyFrame, [0.22, 0.072, 0.118], 'body', o(OBJ.PLUMAGE), bodyData('mantle')));
  L.tail = P(bp(-0.3, 0.01, 0));

  // --- folded S-neck and head
  const fwdW = V([1, 0, 0]);
  const neck = RIDE.neck.map((n) => [...off(n), n[3]]);
  for (let i = 0; i + 1 < neck.length; i++) {
    const a = neck[i];
    const b = neck[i + 1];
    prims.push(new RoundCone(P(a), P(b), a[3], b[3], 'neck', o(OBJ.HEAD), { fwd: fwdW }));
  }
  const headC = off(RIDE.headC);
  const turn = ride ? RIDE.headTurn : 0;
  const hp = RIDE.headPitch;
  const fh = norm([Math.cos(hp) * Math.cos(turn), Math.sin(hp), -Math.cos(hp) * Math.sin(turn)]);
  const lh = norm(cross(fh, [0, 1, 0]));
  const uh = norm(cross(lh, fh));
  const headFrame = frame(V(fh), V(uh), V(lh));
  const headR = [0.076, 0.05, 0.044];
  prims.push(new Ellipsoid(P(headC), headFrame, headR, 'head', o(OBJ.HEAD), { headC: P(headC), fh: V(fh), uh: V(uh), lh: V(lh), r: headR }));
  L.head = P(headC);
  L.crown = P(madd(headC, uh, headR[1]));

  // --- bill: tapered upper mandible, hooked nail, lower rami, sagging pouch
  const fb = norm(madd(fh, uh, Math.sin(deg(-5))));
  const billLen = 0.32;
  const bb = madd(madd(headC, fh, 0.06), uh, -0.008);
  const bm = madd(bb, fb, billLen * 0.5);
  const bt = madd(bb, fb, billLen);
  L.billBase = P(bb);
  L.billTip = P(bt);
  const billData = { bb: P(bb), fb: V(fb), uh: V(uh), billLen };
  prims.push(new RoundCone(P(madd(bb, fb, -0.01)), P(bm), 0.0185, 0.0138, 'bill', o(OBJ.BILL), billData));
  prims.push(new RoundCone(P(bm), P(madd(bt, fb, -0.014)), 0.0138, 0.0085, 'bill', o(OBJ.BILL), billData));
  prims.push(new Capsule(P(madd(madd(bt, fb, -0.018), uh, 0.003)), P(madd(madd(bt, fb, 0.002), uh, -0.012)), 0.0058, 'nail', o(OBJ.BILL), {}));
  for (const s of [-1, 1]) {
    prims.push(new Capsule(P(madd(madd(bb, uh, -0.013), lh, s * 0.015)), P(madd(madd(bt, uh, -0.008), lh, s * 0.006)), 0.0036, 'bill', o(OBJ.BILL), billData));
  }
  const billFrame = frame(V(fb), V(uh), V(lh));
  const nPouch = detail > 0.7 ? 14 : detail > 0.3 ? 4 : 2;
  for (let j = 0; j < nPouch; j++) {
    const s = 0.06 + (0.78 * j) / Math.max(1, nPouch - 1);
    const sag = 0.034 * Math.pow(Math.sin(Math.PI * Math.min(1, s / 0.88)), 0.7) * (1.25 - 0.6 * s) + 0.005;
    const c = madd(madd(bb, fb, s * billLen), uh, -(0.012 + sag * 0.5));
    prims.push(new Ellipsoid(P(c), billFrame, [0.045, sag * 0.5 + 0.006, 0.016 * (1 - 0.35 * s)], 'pouch', o(OBJ.POUCH), { s, uh: V(uh), c: P(c), sag }));
  }
  prims.push(new Ellipsoid(P(madd(madd(bb, fh, -0.016), uh, -0.04)), headFrame, [0.04, 0.032, 0.03], 'pouch', o(OBJ.POUCH), { s: 0, throat: true, uh: V(uh) }));

  // --- eye, set in bare pink skin, on the side toward the viewer
  if (detail > 0.3) {
    const ec = madd(madd(madd(headC, fh, 0.03), uh, 0.012), lh, -0.0365);
    prims.push(new Ellipsoid(P(madd(ec, lh, 0.002)), headFrame, [0.017, 0.013, 0.006], 'eyeSkin', o(OBJ.EYE), {}));
    prims.push(new Sphere(P(ec), 0.0078, 'eye', o(OBJ.EYE), { centre: P(ec), look: V(scale(lh, -1)) }));
    L.eye = P(ec);
  }

  // A flat feather card: base point, length direction, surface normal (bird coordinates).
  const plateAt = (base, dirAlong, normal, halfL, halfW, data, mat, objClass) => {
    const ax = V(dirAlong);
    let ay = V(normal);
    ay = norm(madd(ay, ax, -dot(ay, ax)));
    const az = cross(ax, ay);
    prims.push(new Plate(madd(P(base), ax, halfL), frame(ax, ay, az), halfL, halfW, featherShape, mat, o(objClass), data));
  };

  // --- scapulars shingled on the back; on the rider a few are lifted by the wind
  if (detail > 0.3) {
    const per = detail > 0.7 ? 5 : 3;
    for (let r = 0; r < 2; r++) {
      for (let k = 0; k < per; k++) {
        for (const side of [-1, 1]) {
          if (side === 1 && r === 1) continue; // hidden from the viewer anyway
          const a = 0.1 - (0.26 * k) / Math.max(1, per - 1) - r * 0.03;
          const shrink = Math.sqrt(Math.max(0.2, 1 - ((a + 0.02) / 0.22) ** 2));
          const phi = deg(35 + r * 25 + rng.range(-4, 4));
          // Point and normal on the mantle ellipsoid surface.
          const ry = 0.072 * shrink;
          const rz = 0.118 * shrink;
          const base = bp(a, 0.043 + Math.cos(phi) * ry, side * Math.sin(phi) * rz);
          const nrm = norm(add(scale(up, Math.cos(phi) / 0.072), scale(left, (side * Math.sin(phi)) / 0.118)));
          let dirA = norm(add(scale(along, -1), scale(nrm, -0.12)));
          const lifted = ride && side === -1 && r === 0 && k > 0 && k < per - 1 && rng.chance(0.8);
          if (lifted) dirA = norm(add(dirA, scale(nrm, rng.range(0.18, 0.38))));
          plateAt(madd(base, nrm, 0.003), dirA, nrm, rng.range(0.032, 0.042), rng.range(0.017, 0.022), { kind: 'scapular', seed: rng.next(), lifted }, 'feather', OBJ.PLUMAGE);
        }
      }
    }
  }

  // --- contour feathers along the back and rump, ruffled by the wind (rider only)
  if (ride && detail > 0.7) {
    const topAt = (a, l) => {
      let top = 0.108 * Math.sqrt(Math.max(0, 1 - ((a - 0.02) / 0.2) ** 2 - (l / 0.13) ** 2));
      top = Math.max(top, 0.043 + 0.072 * Math.sqrt(Math.max(0, 1 - ((a + 0.02) / 0.22) ** 2 - (l / 0.118) ** 2)));
      if (a < -0.08 && a > -0.24) {
        const f = (a + 0.08) / -0.16;
        const r = 0.09 - 0.052 * f;
        if (Math.abs(l) < r) top = Math.max(top, -0.004 + 0.016 * f + Math.sqrt(r * r - l * l));
      }
      return top;
    };
    for (let k = 0; k < 12; k++) {
      const a = -0.22 + (0.26 * k) / 11 + rng.range(-0.01, 0.01);
      const l = rng.range(-0.07, 0.035);
      const u = topAt(a, l) - 0.004;
      const nrm = norm(add(up, scale(left, l * 4)));
      const lift = rng.range(0.25, 0.65);
      const dirA = norm(add(add(scale(along, -1), scale(nrm, lift)), scale(left, rng.range(-0.25, 0.25))));
      plateAt(bp(a, u, l), dirA, nrm, rng.range(0.02, 0.03), rng.range(0.011, 0.015), { kind: 'scapular', seed: rng.next(), lifted: true }, 'feather', OBJ.PLUMAGE);
    }
  }

  // --- tail: short and square, barely fanned
  {
    const n = detail > 0.7 ? 8 : detail > 0.3 ? 5 : 3;
    for (let k = 0; k < n; k++) {
      const a = deg(-6 + (12 * k) / Math.max(1, n - 1));
      // Lowered for balance: seen from below and behind, a tail held level would be a mere line.
      const dirA = norm(add(scale(along, -Math.cos(a)), add(scale(up, ride ? -0.75 : -0.36), scale(left, Math.sin(a)))));
      plateAt(bp(-0.24, 0.022, (k - (n - 1) / 2) * 0.012), dirA, up, 0.058, 0.019, { kind: 'tail', seed: rng.next() }, 'feather', OBJ.PLUMAGE);
    }
  }

  // --- wings
  for (const side of [-1, 1]) {
    if (ride) foldedWing(side, side === raggedSide);
    else spreadWing(side);
  }

  function foldedWing(side, ragged) {
    const sh = bp(0.19, 0.04, side * 0.1);
    const el = bp(-0.03, 0.05, side * 0.148);
    const g = anchors.grips[side];
    const wr = [g[0], g[1] + 0.024, g[2]];
    L[`wrist${side}`] = P(wr);
    prims.push(new RoundCone(P(sh), P(el), 0.04, 0.033, 'wingArm', o(OBJ.PLUMAGE), {}));
    prims.push(new RoundCone(P(el), P(wr), 0.033, 0.021, 'wingArm', o(OBJ.PLUMAGE), {}));
    // The folded wing as one smooth panel from the bend (on the grip) back over the tail.
    // Folded, the wings ride high on the flanks and their tips converge over the tail;
    // the ragged hand stops short.
    const tip = ragged ? bp(-0.19, 0.045, side * 0.085) : bp(-0.29, 0.045, side * 0.005);
    const axis = sub(tip, wr);
    const half = len(axis) / 2;
    const wAlong = norm(axis);
    let wUp = norm(madd(up, wAlong, -dot(up, wAlong)));
    const wOut = norm(cross(wAlong, wUp));
    const outSign = Math.sign(wOut[2]) === side ? 1 : -1;
    const out = scale(wOut, outSign);
    wUp = norm(madd(wUp, out, -0.18)); // the panel leans in under the scapulars
    const c = madd(madd(add(wr, scale(axis, 0.5)), wUp, -0.012), out, 0.005);
    const wf = frame(V(wAlong), V(wUp), V(cross(wAlong, wUp)));
    // The panel starts a hand's breadth behind the bend, so the wrist on the grip is a narrow
    // angle, not a blunt prow; a slim forearm covert band fills the gap.
    const c2 = madd(c, wAlong, 0.06);
    // (The far panel is kept slimmer: from behind, only its edge should show past the rump.)
    const panelR = ride && !ragged ? [half - 0.025, 0.072, 0.026] : [half - 0.025, 0.088, 0.03];
    prims.push(new Ellipsoid(P(c2), wf, panelR, 'wingPanel', o(OBJ.PLUMAGE), { c: P(c), along: V(wAlong), up: V(wUp), half, ragged, part: `panel${side}` }));
    const cf = madd(madd(wr, wAlong, 0.11), wUp, 0.004);
    prims.push(new Ellipsoid(P(cf), wf, [0.12, 0.034, 0.022], 'wingPanel', o(OBJ.PLUMAGE), { c: P(c), along: V(wAlong), up: V(wUp), half, ragged, part: `fore${side}` }));
    // Trailing edge: secondary tips breaking the lower outline.
    // (The far wing's trailing edge is hidden by the body from every view we use.)
    const ns = ride && !ragged ? 0 : detail > 0.7 ? 6 : 3;
    for (let k = 0; k < ns; k++) {
      const t = -0.5 + (0.9 * k) / Math.max(1, ns - 1);
      const base = madd(madd(madd(c, wAlong, t * half), wUp, -0.058), out, 0.028);
      const dirA = norm(add(scale(wAlong, 0.9), scale(wUp, -0.3)));
      plateAt(base, dirA, out, 0.04, 0.02, { kind: 'flight', seed: rng.next() }, 'feather', OBJ.PLUMAGE);
    }
    // Primaries along the outer face toward the tip; the ragged wing has lost P7-P10.
    // The intact wing's lie flat and cross over the tail just past the fold.
    for (let p = 1; p <= 10; p++) {
      if (ragged && p >= 7) continue;
      // The intact far wing's primaries would only show edge-on, as stray lines; its panel
      // stands for them.
      if (!ragged && ride) continue;
      if (!ragged && (p % 2 === 1 || p < 6)) continue;
      const start = ragged ? 0.03 + 0.012 * p : half * 0.9 + 0.01 * p;
      const base = madd(madd(madd(wr, wAlong, start), wUp, -0.012 * (10 - p) * 0.35), out, 0.031 + 0.0015 * p);
      let length = ragged ? (half * 2 - 0.02) * (0.55 + 0.045 * p) : half * 2 - start + 0.012 + 0.004 * p;
      let rag = 0;
      let fan = 0;
      if (ragged && p >= 3) {
        // What is left of the hand: worn, notched feathers sticking out past the fold.
        rag = 0.25 + 0.17 * (p - 3);
        length *= [1.12, 1.2, 1.08, 1.16][p - 3];
        fan = (p - 4.5) * 0.09;
      }
      const dirA = norm(add(add(scale(wAlong, 1), scale(wUp, ragged ? -0.02 * (10 - p) + fan : -0.09 - 0.004 * (10 - p))), scale(out, ragged ? 0.04 : 0)));
      plateAt(base, dirA, out, length / 2, ragged ? 0.022 : 0.026, { kind: 'flight', seed: rng.next(), ragged: rag, primary: p }, 'feather', OBJ.PLUMAGE);
    }
    if (ragged) {
      // Broken shafts where the outer primaries once were.
      for (let k = 0; k < 3; k++) {
        const base = madd(madd(tip, wAlong, -0.07 + k * 0.02), out, 0.034 + k * 0.003);
        const end = madd(madd(base, wAlong, 0.022 + k * 0.012), wUp, 0.006 * (k - 1));
        prims.push(new Capsule(P(base), P(end), 0.0016, 'quill', o(OBJ.PLUMAGE), {}));
      }
      L.raggedTip = P(tip);
    }
  }

  function spreadWing(side) {
    // Gliding: the arm lifts a little, the hand droops and its primaries finger apart,
    // so seen from behind the wings make a long, shallow, bowed line.
    const sh = [0.19, 0.055, side * 0.11];
    const el = [0.12, 0.095, side * 0.4];
    const wr = [0.16, 0.07, side * 0.68];
    const hand = [0.0, -0.05, side * 1.02];
    prims.push(new RoundCone(P(sh), P(el), 0.04, 0.03, 'wingArm', o(OBJ.PLUMAGE), {}));
    prims.push(new RoundCone(P(el), P(wr), 0.03, 0.02, 'wingArm', o(OBJ.PLUMAGE), {}));
    prims.push(new RoundCone(P(wr), P(hand), 0.02, 0.01, 'wingArm', o(OBJ.PLUMAGE), {}));
    const ns = detail > 0.3 ? 12 : 7;
    for (let k = 0; k < ns; k++) {
      const t = k / (ns - 1);
      const a0 = Math.min(1, t * 2);
      const a1 = Math.max(0, t * 2 - 1);
      const base = add(add(sh, scale(sub(el, sh), a0)), scale(sub(wr, el), a1));
      const slope = t < 0.5 ? (el[1] - sh[1]) / Math.abs(el[2] - sh[2]) : (wr[1] - el[1]) / Math.abs(wr[2] - el[2]);
      const nrm = norm([0, 1, -side * slope]);
      plateAt(base, norm([-1, -0.06, side * 0.05]), nrm, 0.17 - 0.03 * t, 0.045, { kind: 'flight', seed: rng.next() }, 'feather', OBJ.FLOCK);
    }
    const np = detail > 0.3 ? 7 : 5;
    const handSlope = (hand[1] - wr[1]) / Math.abs(hand[2] - wr[2]);
    for (let p = 0; p < np; p++) {
      const t = p / (np - 1);
      const base = add(wr, scale(sub(hand, wr), 0.15 + t * 0.55));
      const spread = deg(-8 + 58 * t);
      const dirA = norm([-Math.sin(spread) * 0.95, -0.05 - 0.12 * t, side * Math.cos(spread)]);
      plateAt(base, dirA, norm([0, 1, -side * handSlope]), 0.13 + 0.05 * t, 0.03 - 0.008 * t, { kind: 'flight', seed: rng.next(), primary: p + 1 }, 'feather', OBJ.FLOCK);
    }
  }

  // --- legs and webbed feet (rider only; the flock tuck theirs)
  if (ride) {
    for (const side of [-1, 1]) {
      const pedal = anchors.pedals[side];
      const hip = bp(0.0, -0.085, side * 0.072);
      if (side === raggedSide) {
        // Near leg: the intertarsal joint bends backward; the tarsus drops to the raised pedal.
        // Bird legs zigzag: the knee hides forward in the belly feathers, the intertarsal
        // joint bends back, and the short stout tarsus comes forward again to the foot.
        const footBase = [pedal[0] - 0.034, pedal[1] + 0.013, pedal[2]];
        const joint = [footBase[0] - 0.088, footBase[1] + 0.088, footBase[2] + 0.012];
        const knee = madd(hip, along, 0.05);
        const thighEnd = add(knee, scale(sub(joint, knee), 0.2));
        prims.push(new RoundCone(P(madd(knee, up, 0.025)), P(thighEnd), 0.019, 0.0125, 'leg', o(OBJ.FEET), { feathered: true }));
        prims.push(new RoundCone(P(thighEnd), P(joint), 0.0105, 0.0085, 'leg', o(OBJ.FEET), {}));
        prims.push(new Sphere(P(joint), 0.0112, 'leg', o(OBJ.FEET), {}));
        prims.push(new RoundCone(P(joint), P(footBase), 0.0098, 0.0082, 'leg', o(OBJ.FEET), {}));
        foot(footBase, side);
      }
    }
  }

  function foot(base, side) {
    // Four toes all joined by web (totipalmate); the hallux turns inward.
    const toes = [
      { a: deg(34), len: 0.052 },
      { a: deg(12), len: 0.078 },
      { a: deg(-6), len: 0.096 },
      { a: deg(-24), len: 0.088 },
    ];
    const tips = [];
    // The foot turns out on the pedal and rolls onto its outer edge, so from behind its toes
    // fan past the end of the cage and the webs between them turn toward the viewer.
    const turnOut = deg(32);
    const roll = 0.45 * side;
    const rl = (v) => [v[0], v[1] * Math.cos(roll) - v[2] * Math.sin(roll), v[1] * Math.sin(roll) + v[2] * Math.cos(roll)];
    const down = rl([0, -1, 0]);
    for (const t of toes) {
      const ang = side < 0 ? t.a - turnOut : -t.a + turnOut;
      const dir = rl([Math.cos(ang), 0, Math.sin(ang)]);
      const knuckle = madd(base, dir, t.len * 0.62);
      const tip = madd(madd(base, dir, t.len), down, t.len * 0.22);
      prims.push(new RoundCone(P(base), P(knuckle), 0.0075, 0.006, 'foot', OBJ.FEET, {}));
      prims.push(new RoundCone(P(knuckle), P(tip), 0.006, 0.0035, 'foot', OBJ.FEET, {}));
      prims.push(new Capsule(P(tip), P(madd(madd(tip, dir, 0.007), down, 0.006)), 0.0021, 'claw', OBJ.FEET, {}));
      tips.push({ ang, len: t.len });
    }
    const angs = tips.map((t) => t.ang);
    const amin = Math.min(...angs);
    const amax = Math.max(...angs);
    const reach = Math.max(...tips.map((t) => t.len));
    const webShape = (u, v) => {
      const x = ((u + 1) / 2) * reach;
      const z = v * reach;
      const r = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      if (a < amin - 0.05 || a > amax + 0.05) return false;
      let best = 0;
      for (const t of tips) best = Math.max(best, t.len * Math.max(0, 1 - Math.abs(a - t.ang) / deg(14)));
      return r < reach * 0.82 * (0.6 + (0.4 * best) / reach);
    };
    const ax = V([1, 0, 0]);
    const ay = V(rl([0, 1, 0]));
    const c = P(madd(madd(base, [1, 0, 0], reach / 2), rl([0, 1, 0]), 0.003));
    prims.push(new Plate(c, frame(ax, ay, cross(ax, ay)), reach / 2, reach, webShape, 'web', OBJ.FEET, {}));
    L.foot = P(base);
  }

  return { prims, landmarks: L };
}
