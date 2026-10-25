// buildScene -> renderReference -> paint -> finish.
import { makeNoise } from './lib/noise.js';
import { Img, crop } from './lib/image.js';
import { makeCanvas } from './paint/canvas.js';
import { Painter } from './paint/brush.js';
import { paintAll } from './paint/passes.js';
import { finish } from './paint/finish.js';
import { LAYOUT } from './scene/layout.js';
import { makeMainCamera } from './scene/camera.js';
import { makeSky } from './scene/sky.js';
import { makeSea } from './scene/sea.js';
import { makeLighting } from './scene/light.js';
import { makePavement, makeBreakwaterPrims } from './scene/breakwater.js';
import { makeShader } from './scene/shade.js';
import { renderReference } from './scene/reference.js';
import { makeBicycle, bikeMaterials } from './scene/bicycle.js';
import { buildPelican, Xf } from './scene/pelican.js';
import { pelicanMaterials } from './scene/plumage.js';
import { makeFlock } from './scene/flock.js';
import { makeShadowMap, shadowSunDir } from './scene/shadow.js';
import { makeSpray } from './scene/spray.js';

// Pixel region of the full canvas to render (crop is in fractions of width/height).
function regionFor(W, H, crop) {
  if (!crop) return { x0: 0, y0: 0, x1: W, y1: H };
  const [a, b, c, d] = crop;
  return {
    x0: Math.max(0, Math.floor(a * W)),
    y0: Math.max(0, Math.floor(b * H)),
    x1: Math.min(W, Math.ceil(c * W)),
    y1: Math.min(H, Math.ceil(d * H)),
  };
}

export function makeContext({ width = 1200, seed = 7, crop = null } = {}) {
  const L = LAYOUT;
  const W = width;
  const H = Math.round(width / L.aspect);
  const region = regionFor(W, H, crop);
  const camera = makeMainCamera(L);
  const noise = makeNoise(seed);
  const pixelAngle = 1 / (L.focal * H);
  const sky = makeSky(L, noise);
  const sea = makeSea(L, sky, noise, pixelAngle, seed);
  const lighting = makeLighting(L, sky);
  const pavement = makePavement(L, seed, noise, lighting, sky, camera, pixelAngle);
  const ctx = { L, W, H, region, seed, camera, noise, pixelAngle, sky, sea, lighting, pavement };
  ctx.shader = makeShader(ctx);
  ctx.shadowAt = null;
  return ctx;
}

export function buildScene(ctx) {
  const bike = makeBicycle(ctx.L);
  const bm = bikeMaterials(ctx);
  Object.assign(ctx.shader.materials, bm.materials);
  for (const line of bike.lines) line.shade = (P, out, info) => bm.shadeLine(line, P, out, info);
  // The rider is built in the bike's own frame: x forward (toward the sun), y up, z left.
  Object.assign(ctx.shader.materials, pelicanMaterials(ctx));
  const xf = new Xf([ctx.L.rider.x, 0, ctx.L.rider.z], [0, 0, 1], [0, 1, 0], [-1, 0, 0]);
  const anchors = { grips: { [-1]: bike.local.grips[0], [1]: bike.local.grips[1] }, pedals: {} };
  for (const p of bike.pedals) anchors.pedals[p.side] = p.local;
  const rider = buildPelican({ xf, pose: 'ride', anchors, seed: ctx.seed * 7 + 1, detail: 1, raggedSide: -1 });
  const flock = makeFlock(ctx, rider.landmarks.crown);
  const shadowMap = makeShadowMap({ prims: [...bike.prims, ...rider.prims], lines: bike.lines, sunDir: shadowSunDir(ctx.L) });
  ctx.shadowAt = (P) => shadowMap.lookup(P, 0.015);
  const spray = makeSpray(ctx);
  const prims = [...makeBreakwaterPrims(ctx.L, ctx.seed), ...bike.prims, ...rider.prims, ...flock.prims];
  return { prims, lines: [...bike.lines], overlays: [spray], bike, rider, flock };
}

// Render the painting (or, with stage 'reference', just what the painter sees).
// Crops are painted with a margin of surrounding canvas so strokes that cross the crop
// edge behave as they do in the full picture, then trimmed.
export function render(opts = {}) {
  const ctx = makeContext(opts);
  const want = ctx.region;
  const margin = opts.crop ? Math.round(0.08 * ctx.H) : 0;
  const pr = {
    x0: Math.max(0, want.x0 - margin),
    y0: Math.max(0, want.y0 - margin),
    x1: Math.min(ctx.W, want.x1 + margin),
    y1: Math.min(ctx.H, want.y1 + margin),
  };
  ctx.region = pr;
  const scene = buildScene(ctx);
  const t0 = Date.now();
  const ref = renderReference(ctx, scene);
  const timings = { reference: Date.now() - t0 };
  const trim = (img) => crop(img, want.x0 - pr.x0, want.y0 - pr.y0, want.x1 - want.x0, want.y1 - want.y0);
  if (opts.stage === 'reference') return { image: trim(ref.color), ref, ctx, W: ctx.W, H: ctx.H, region: want, debug: {}, timings };
  const canvas = makeCanvas({ W: ctx.W, region: pr, seed: ctx.seed });
  const painter = new Painter(canvas, makeNoise(ctx.seed ^ 0xb7));
  const t1 = Date.now();
  const stats = paintAll({ ctx, ref, canvas, painter, region: pr, scene, until: opts.until });
  timings.paint = Date.now() - t1;
  const t2 = Date.now();
  const image = trim(finish(canvas, ref));
  timings.finish = Date.now() - t2;
  const debug = {};
  if (opts.debug) {
    debug.reference = trim(ref.color);
    const hmap = new Img(pr.x1 - pr.x0, pr.y1 - pr.y0, 1, canvas.height.slice());
    hmap.lo = 0;
    hmap.hi = 0.8;
    debug.height = trim(hmap);
  }
  return { image, ref, ctx, W: ctx.W, H: ctx.H, region: want, stats, timings, strokes: painter.count, pixels: painter.pixels, debug };
}
