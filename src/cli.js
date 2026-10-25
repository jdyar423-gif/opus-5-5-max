#!/usr/bin/env node
// Render the painting.
//   node src/cli.js --width 1200 --out out/preview
//   node src/cli.js --width 4800 --out output/pelican-breakwater --jpeg
// Options: --seed N, --crop x0,y0,x1,y1 (fractions of the canvas), --debug (write style maps).
import { execFileSync } from 'node:child_process';
import { render } from './pipeline.js';
import { toSrgb8, grey8 } from './lib/image.js';
import { writePNG } from './lib/png.js';

function parseArgs(argv) {
  const opts = { width: 1200, seed: 7, out: 'out/render', crop: null, jpeg: false, debug: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--width') opts.width = parseInt(next(), 10);
    else if (a === '--seed') opts.seed = parseInt(next(), 10);
    else if (a === '--out') opts.out = next();
    else if (a === '--crop') opts.crop = next().split(',').map(Number);
    else if (a === '--jpeg') opts.jpeg = true;
    else if (a === '--debug') opts.debug = true;
    else if (a === '--stage') opts.stage = next();
    else if (a === '--until') opts.until = next();
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const t0 = Date.now();
const result = render(opts);
const { image } = result;
const png = `${opts.out}.png`;
writePNG(png, toSrgb8(image), image.w, image.h);
console.log(`${png}  ${image.w}x${image.h}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (result.timings) console.log('  timings', JSON.stringify(result.timings), result.strokes ? `strokes ${result.strokes}, stroke pixels ${(result.pixels / 1e6).toFixed(1)}M` : '');
if (result.stats) console.log('  passes', JSON.stringify(result.stats));

if (opts.debug) {
  for (const [name, map] of Object.entries(result.debug)) {
    const file = `${opts.out}-${name}.png`;
    const bytes = map.c === 3 ? toSrgb8(map) : grey8(map, map.lo ?? 0, map.hi ?? 1);
    writePNG(file, bytes, map.w, map.h);
    console.log(`  debug ${file}`);
  }
}

if (opts.jpeg) {
  const jpg = `${opts.out}.jpg`;
  try {
    execFileSync('convert', [png, '-quality', '93', '-sampling-factor', '4:4:4', jpg]);
    console.log(`  ${jpg}`);
  } catch {
    console.warn('  ImageMagick `convert` not found; skipped JPEG export');
  }
}
