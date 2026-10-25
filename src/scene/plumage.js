// Materials for the pelicans: breeding plumage, bill, pouch, eye and feet, lit contre-jour.
import { mixPaint } from '../lib/color.js';
import { smoothstep, clamp } from '../lib/noise.js';
import { dot, sub, norm } from '../lib/vec.js';
import { OBJ } from './objects.js';
import { screenAngle } from './light.js';
import { featherEdge } from './pelican.js';

export const PLUMAGE = {
  // Warm greys and browns come from vermilion + ivory black + white (black with ochre
  // turns olive), as on Zorn's own palette.
  silver: mixPaint({ W: 0.972, K: 0.0078, V: 0.02 }),
  grayBrown: mixPaint({ W: 0.895, K: 0.0154, O: 0.02, V: 0.07 }),
  darkBrown: mixPaint({ W: 0.712, K: 0.0535, V: 0.235 }),
  flight: mixPaint({ W: 0.339, K: 0.166, V: 0.495 }),
  chestnut: mixPaint({ W: 0.487, K: 0.0426, V: 0.47 }),
  white: mixPaint({ W: 0.95, O: 0.04, K: 0.003 }),
  straw: mixPaint({ W: 0.72, O: 0.27, V: 0.012 }),
  bill: mixPaint({ W: 0.72, K: 0.011, O: 0.06, V: 0.008 }),
  billWarm: mixPaint({ W: 0.66, O: 0.2, V: 0.07, K: 0.008 }),
  nail: mixPaint({ O: 0.45, V: 0.45, W: 0.1 }),
  scarlet: mixPaint({ V: 0.86, O: 0.1, W: 0.04 }),
  pouchOlive: mixPaint({ O: 0.42, K: 0.46, V: 0.12 }),
  iris: mixPaint({ W: 0.86, O: 0.14 }),
  pupil: mixPaint({ K: 1 }),
  eyeSkin: mixPaint({ V: 0.36, W: 0.58, O: 0.06 }),
  black: mixPaint({ K: 0.93, W: 0.07 }),
  quill: mixPaint({ W: 0.85, O: 0.08, K: 0.01 }),
};

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function pelicanMaterials(ctx) {
  const { lighting, camera, noise, shader } = ctx;
  const C = PLUMAGE;
  const amb = [0, 0, 0];

  // Feathered surfaces: wrapped diffuse, a fuzzy rim on sun-side contours and light
  // through thin vanes when the bird is between us and the sun.
  function plumageLit(albedo, n, d, out, { wrap = 0.3, fuzz = 0.7, thin = 0, fill = 1.5 } = {}) {
    const s = lighting.sun;
    const sc = lighting.sunColor;
    lighting.ambient(n, amb);
    const ns = n[0] * s[0] + n[1] * s[1] + n[2] * s[2];
    const diff = Math.max(0, (ns + wrap) / (1 + wrap));
    const nv = Math.abs(n[0] * d[0] + n[1] * d[1] + n[2] * d[2]);
    // Rim: strongest on contours that turn toward the sun (the right-hand edges in this view);
    // against the light the fringe of every contour glows a little (light through the edge).
    const ds = d[0] * s[0] + d[1] * s[1] + d[2] * s[2];
    const contre = smoothstep(0.55, 0.95, ds);
    const rim = fuzz * (Math.pow(1 - nv, 4) * smoothstep(0.0, 0.5, ns) + 0.55 * Math.pow(1 - nv, 2.5) * contre * smoothstep(-0.35, 0.15, ns));
    const back = Math.pow(Math.max(0, ds), 8);
    const trans = thin * back;
    // Feather sheen picks up the pewter sky on the shadow side ("shadows cooled by skylight").
    // (The flock, small and far, stay flat dark silhouettes.)
    const sheen = fill > 1 ? Math.pow(1 - nv, 2) * Math.max(0, 0.35 + 0.65 * n[1]) * (1 - smoothstep(0.0, 0.4, ns)) * 0.16 : 0;
    const sky = lighting.skyAverage;
    for (let k = 0; k < 3; k++) {
      out[k] = albedo[k] * (amb[k] * fill + sc[k] * diff * 0.85) + sc[k] * (rim * (0.32 + albedo[k] * 1.6) + trans * (albedo[k] * 1.4 + 0.05)) + sky[k] * sheen;
    }
    return diff * 0.5 + rim + trans;
  }

  const axisAngle = (prim, P) => {
    if (prim.ba) return screenAngle(camera, P, prim.ba);
    if (prim.m) return screenAngle(camera, P, [prim.m[0], prim.m[1], prim.m[2]]);
    return 0;
  };

  function finishInfo(info, prim, P, light, impasto = 0.3) {
    info.obj = prim.obj;
    info.light = light;
    info.impasto = impasto + light * 0.9;
    info.angle = axisAngle(prim, P);
  }

  const m = {};

  m.body = (prim, P, n, d, t, out, info) => {
    const { xf, bodyC, along, up } = prim.data;
    const q = sub(xf.inv(P), bodyC);
    const a = dot(q, along);
    const u = dot(q, up);
    const l = q[2];
    const phi = Math.atan2(l, u);
    // Fine silver streaks along the feather tracts of the back; dark brown underparts.
    const streak = Math.abs(noise.noise2(a * 3.5, phi * 26));
    const fine = smoothstep(0.1, 0.02, streak);
    let albedo;
    if (u < -0.03) {
      albedo = mix(C.darkBrown, C.flight, clamp(0.35 + noise.noise2(a * 6, phi * 9) * 0.4));
    } else {
      albedo = mix(C.grayBrown, C.silver, fine * 0.4 * smoothstep(-0.03, 0.06, u));
      albedo = mix(albedo, C.darkBrown, smoothstep(0.1, -0.03, u) * 0.6);
    }
    const light = plumageLit(albedo, n, d, out, { fuzz: 0.8, fill: prim.obj === OBJ.FLOCK ? 0.8 : 1.85 });
    finishInfo(info, prim, P, light);
    // Strokes follow the feather tracts, head to tail.
    info.angle = screenAngle(camera, P, xf.v(-along[0], -along[1], -along[2]));
  };

  m.neck = (prim, P, n, d, t, out, info) => {
    const fwd = prim.data.fwd;
    const nf = dot(n, fwd);
    const side = Math.abs(n[0] * fwd[2] - n[2] * fwd[0]); // lateral component
    let albedo = C.chestnut;
    const stripe = smoothstep(0.55, 0.8, side) * smoothstep(-0.45, -0.1, nf);
    albedo = mix(albedo, C.white, stripe * 0.9);
    albedo = mix(albedo, mix(C.white, C.straw, 0.25), smoothstep(0.25, 0.55, nf));
    const light = plumageLit(albedo, n, d, out, { fuzz: 0.9, fill: prim.obj === OBJ.FLOCK ? 0.8 : 1.4 });
    finishInfo(info, prim, P, light);
  };

  m.wingPanel = (prim, P, n, d, t, out, info) => {
    const { c, along: wa, up: wu, half } = prim.data;
    const q = sub(P, c);
    const u = dot(q, wa) / (half + 0.035); // -1 at the bend, +1 at the tip
    const v = dot(q, wu) / 0.088; // -1 trailing edge, +1 leading edge
    // Coverts: silvery feather tips in irregular overlapping rows over the forearm;
    // flight feathers: long dark quills behind.
    const covert = smoothstep(-0.25, 0.15, v) * smoothstep(0.55, 0.15, u);
    const rowF = v * 4 + 10 + noise.noise2(u * 3, v * 2) * 0.35;
    const row = Math.floor(rowF);
    const fy = rowF - row;
    const xF = u * 5.5 + row * 0.53 + noise.noise2(row * 7.1, u * 2) * 0.3;
    const fx = xF - Math.floor(xF);
    // Rounded feather tip: the pale edge hugs a semicircle at the bottom of each cell.
    const tipCurve = 0.32 * (1 - (2 * fx - 1) ** 2);
    const scallop = smoothstep(0.1, 0.0, Math.abs(fy - tipCurve)) * 0.8;
    const cov = mix(C.grayBrown, C.silver, scallop * 0.55 + 0.32);
    const quill = Math.abs(((v * 6 + u * 1.5) % 1 + 1) % 1 - 0.5);
    const fl = mix(C.flight, C.grayBrown, smoothstep(0.38, 0.5, quill) * 0.14);
    const streak = noise.noise2(u * 9, v * 4) * 0.05;
    let albedo = mix(fl, cov, covert);
    albedo = albedo.map((x) => x * (1 + streak));
    const light = plumageLit(albedo, n, d, out, { fuzz: 0.85, thin: 0.15, fill: prim.obj === OBJ.FLOCK ? 0.8 : 1.85 });
    finishInfo(info, prim, P, light);
    info.angle = screenAngle(camera, P, wa);
  };

  m.head = (prim, P, n, d, t, out, info) => {
    const { headC, fh, uh, lh, r } = prim.data;
    const q = sub(P, headC);
    const lx = dot(q, fh) / r[0];
    const ly = dot(q, uh) / r[1];
    const lz = dot(q, lh) / r[2];
    let albedo = C.white;
    // Straw-yellow crown and forehead, dark chestnut nape behind.
    albedo = mix(albedo, C.straw, smoothstep(0.2, 0.55, ly) * smoothstep(-0.8, -0.4, lx));
    albedo = mix(albedo, C.chestnut, smoothstep(-0.5, -0.85, lx) * smoothstep(0.7, 0.15, ly));
    const grain = noise.noise2(lx * 9 + lz * 3, ly * 9) * 0.04;
    albedo = albedo.map((c) => c * (1 + grain));
    let light = plumageLit(albedo, n, d, out, { fuzz: 1.0, wrap: 0.35, fill: prim.obj === OBJ.FLOCK ? 0.8 : 1.3 });
    if (prim.obj !== OBJ.FLOCK) {
      // The painter's burning fringe around the crown and nape: the brightest light in the
      // picture laid right against the darkest dark (the chestnut nape).
      const nv = Math.abs(dot(n, d));
      const ns = dot(n, lighting.sun);
      const ds = dot(d, lighting.sun);
      const glow = Math.pow(1 - nv, 3) * smoothstep(0.55, 0.95, ds) * (0.45 + 0.55 * smoothstep(-0.3, 0.4, ns)) * 0.9;
      const sc = lighting.sunColor;
      for (let k = 0; k < 3; k++) out[k] += sc[k] * glow * (0.45 + albedo[k]);
      light += glow * 2;
    }
    finishInfo(info, prim, P, light, 0.35);
    info.angle = screenAngle(camera, P, fh);
  };

  m.bill = (prim, P, n, d, t, out, info) => {
    const { bb, fb, uh, billLen } = prim.data;
    const s = clamp(dot(sub(P, bb), fb) / billLen);
    const top = dot(n, uh);
    let albedo = mix(C.billWarm, C.bill, smoothstep(0.0, 0.35, s));
    albedo = mix(albedo, C.silver, smoothstep(0.55, 0.95, top) * 0.35); // pale culmen ridge
    albedo = mix(albedo, C.flight, smoothstep(-0.3, -0.8, top) * 0.5); // dark tomium edge
    const mottle = noise.noise2(s * 40, top * 4) * 0.06;
    albedo = albedo.map((c) => c * (1 + mottle));
    const ndl = shader.lit(albedo, n, d, out, { spec: 0.8, shininess: 35, sheen: 0.25 });
    // Keratin edges catch the sun like a rim.
    const rim = Math.pow(1 - Math.abs(dot(n, d)), 2.2) * smoothstep(-0.3, 0.3, dot(n, lighting.sun)) * (1.4 + 1.2 * smoothstep(0.3, 0.8, top));
    const sc = lighting.sunColor;
    for (let k = 0; k < 3; k++) out[k] += sc[k] * rim * (0.4 + albedo[k]);
    finishInfo(info, prim, P, ndl + rim, 0.35);
    info.angle = screenAngle(camera, P, fb);
  };

  m.nail = (prim, P, n, d, t, out, info) => {
    const ndl = shader.lit(C.nail, n, d, out, { spec: 0.9, shininess: 40 });
    finishInfo(info, prim, P, ndl, 0.4);
    info.obj = prim.obj === OBJ.FLOCK ? OBJ.FLOCK : OBJ.BILL;
  };

  m.pouch = (prim, P, n, d, t, out, info) => {
    const s = prim.data.s ?? 0.5;
    const throat = prim.data.throat ? 1 : 0;
    // Height within the sag: +1 up under the bill (thin, glowing), -1 at the heavy lower fold.
    const h = prim.data.c ? clamp(dot(sub(P, prim.data.c), prim.data.uh) / (prim.data.sag * 0.5 + 0.006), -1, 1) : 0;
    let albedo = mix(C.scarlet, C.pouchOlive, Math.max(throat * 0.55, smoothstep(0.12, 0.0, s) * 0.5));
    // The flock's pouches stay inside their dark silhouettes: the rider's is the only scarlet.
    if (prim.obj === OBJ.FLOCK) albedo = mix(C.pouchOlive, C.darkBrown, 0.5).map((x) => x * 0.7);
    // The heavy lower fold is darker; slack skin hangs in soft vertical wrinkles.
    const fold = 0.62 + 0.38 * smoothstep(-1, -0.25, h);
    const wrinkle = 0.93 + 0.07 * Math.sin(s * 62 + noise.noise2(s * 9, h * 2) * 2.5);
    albedo = albedo.map((x) => x * fold * wrinkle * (0.84 + 0.16 * (h + 1) * 0.5));
    // Fine veins in the skin.
    const vein = Math.abs(noise.noise2(P[0] * 70 + P[2] * 30, P[1] * 45));
    albedo = albedo.map((c) => c * (1 - 0.12 * smoothstep(0.03, 0.0, vein)));
    lighting.ambient(n, amb);
    const sc = lighting.sunColor;
    const ds = d[0] * lighting.sun[0] + d[1] * lighting.sun[1] + d[2] * lighting.sun[2];
    // Thin skin glows when the sun is behind it: transmission rises sharply toward the sun.
    // Thinnest (and so brightest) just under the bill, thickest in the lower fold.
    const thinSkin = 0.45 + 0.55 * smoothstep(-0.6, 0.8, h);
    const trans = 0.55 * smoothstep(0.55, 0.97, ds) * thinSkin * (0.65 + 0.35 * (1 - Math.abs(dot(n, d)))) * (prim.obj === OBJ.FLOCK ? 0.1 : 1);
    const ndl = Math.max(0, dot(n, lighting.sun));
    for (let k = 0; k < 3; k++) out[k] = albedo[k] * (amb[k] * 0.85 + sc[k] * (ndl * 0.8 + trans * 1.5));
    const sheen = Math.pow(1 - Math.abs(dot(n, d)), 4) * 0.25;
    for (let k = 0; k < 3; k++) out[k] += sheen * sc[k] * albedo[k];
    finishInfo(info, prim, P, trans + ndl, 0.35);
    info.obj = prim.obj === OBJ.FLOCK ? OBJ.FLOCK : OBJ.POUCH;
  };

  m.eyeSkin = (prim, P, n, d, t, out, info) => {
    const ndl = shader.lit(C.eyeSkin, n, d, out, { spec: 0.6, shininess: 30 });
    finishInfo(info, prim, P, ndl, 0.3);
    info.obj = prim.obj === OBJ.FLOCK ? OBJ.FLOCK : OBJ.EYE;
  };

  m.eye = (prim, P, n, d, t, out, info) => {
    const { centre, look } = prim.data;
    const e = norm(sub(P, centre));
    const c = dot(e, look);
    let albedo = c > 0.94 ? C.pupil : c > 0.6 ? C.iris : C.black;
    if (c > 0.6 && c <= 0.94) albedo = mix(C.iris, C.straw, smoothstep(0.75, 0.94, c) * 0.4);
    shader.lit(albedo, n, d, out, { spec: 2.2, shininess: 120, sheen: 0.5 });
    finishInfo(info, prim, P, 0.2, 0.3);
    info.obj = prim.obj === OBJ.FLOCK ? OBJ.FLOCK : OBJ.EYE;
  };

  m.feather = (prim, P, n, d, t, out, info) => {
    const data = prim.data;
    const loc = prim.local(P);
    const u = loc[0];
    const edge = featherEdge(u, loc[2], data);
    let albedo;
    if (data.kind === 'scapular' || data.kind === 'covert') {
      albedo = mix(C.grayBrown, C.silver, smoothstep(0.5, 0.82, edge) * 0.9);
      if (data.lifted) albedo = mix(albedo, C.silver, smoothstep(0.2, -0.6, u) * 0.5); // pale bases show
    } else if (data.kind === 'tail') {
      albedo = mix(C.grayBrown, C.flight, 0.45);
      albedo = mix(albedo, C.silver, smoothstep(0.7, 0.95, edge) * 0.3);
    } else {
      albedo = mix(C.flight, C.grayBrown, smoothstep(0.7, 0.98, edge) * 0.45);
    }
    if (Math.abs(loc[2]) < 0.05) albedo = mix(albedo, C.silver, 0.25); // rachis
    const wear = noise.noise2(u * 6 + (data.seed || 0) * 50, loc[2] * 3) * 0.05;
    albedo = albedo.map((c) => c * (1 + wear));
    // Flock birds stay silhouettes: no light through their feathers, only burning edges.
    const thin = (data.kind === 'flight' || data.kind === 'tail' ? 0.2 + 0.5 * edge : 0.15 * edge) * (prim.obj === OBJ.FLOCK ? 0.1 : 1);
    // Flat cards: a fuzzy rim would light the whole card when seen edge-on, so keep it small
    // and let the backlit outline burn instead.
    let light = plumageLit(albedo, n, d, out, { fuzz: 0.12, thin: thin * 0.7, fill: prim.obj === OBJ.FLOCK ? 0.8 : 1.85 });
    const back = Math.pow(Math.max(0, d[0] * lighting.sun[0] + d[1] * lighting.sun[1] + d[2] * lighting.sun[2]), 4);
    const burn = smoothstep(0.82, 1.0, edge) * back * 0.55;
    const sc = lighting.sunColor;
    for (let k = 0; k < 3; k++) out[k] += sc[k] * burn * (0.35 + albedo[k]);
    light += burn;
    finishInfo(info, prim, P, light);
  };

  m.wingArm = (prim, P, n, d, t, out, info) => {
    const light = plumageLit(C.grayBrown, n, d, out, { fuzz: 0.9, fill: prim.obj === OBJ.FLOCK ? 0.8 : 1.85 });
    finishInfo(info, prim, P, light);
  };

  m.quill = (prim, P, n, d, t, out, info) => {
    const light = plumageLit(mix(C.quill, C.grayBrown, 0.5), n, d, out, { fuzz: 0.3, thin: 0.3 });
    finishInfo(info, prim, P, light, 0.4);
  };

  m.leg = (prim, P, n, d, t, out, info) => {
    const albedo = prim.data.feathered ? mix(C.darkBrown, C.black, 0.4) : C.black;
    const ndl = shader.lit(albedo, n, d, out, { spec: 0.5, shininess: 25, sheen: 0.12 });
    finishInfo(info, prim, P, ndl, 0.3);
  };

  m.foot = (prim, P, n, d, t, out, info) => {
    const scale = noise.noise2(P[0] * 400, P[2] * 400 + P[1] * 300) * 0.12;
    const albedo = C.black.map((c) => c * (1 + scale));
    const ndl = shader.lit(albedo, n, d, out, { spec: 0.6, shininess: 30, sheen: 0.15 });
    finishInfo(info, prim, P, ndl, 0.3);
  };

  m.claw = (prim, P, n, d, t, out, info) => {
    const ndl = shader.lit(mix(C.black, C.grayBrown, 0.3), n, d, out, { spec: 0.8, shininess: 40 });
    finishInfo(info, prim, P, ndl, 0.3);
  };

  m.web = (prim, P, n, d, t, out, info) => {
    const ndl = shader.lit(C.black, n, d, out, { spec: 0.4, shininess: 20, sheen: 0.1 });
    // Thin membrane: a dull warm glow where it is backlit.
    const ds = Math.max(0, d[0] * lighting.sun[0] + d[1] * lighting.sun[1] + d[2] * lighting.sun[2]);
    const g = Math.pow(ds, 10) * 0.06;
    out[0] += g * 0.9;
    out[1] += g * 0.35;
    out[2] += g * 0.2;
    finishInfo(info, prim, P, ndl, 0.25);
  };

  return m;
}
