import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { render } from '../src/pipeline.js';

const hash = (img) => crypto.createHash('sha256').update(Buffer.from(img.data.buffer)).digest('hex');

test('renders a small painting with finite values', () => {
  const { image } = render({ width: 240, seed: 3 });
  assert.equal(image.w, 240);
  assert.equal(image.h, 160);
  let bad = 0;
  for (let i = 0; i < image.data.length; i++) if (!Number.isFinite(image.data[i])) bad++;
  assert.equal(bad, 0);
});

test('the same seed paints the same picture', () => {
  const a = render({ width: 180, seed: 11 });
  const b = render({ width: 180, seed: 11 });
  assert.equal(hash(a.image), hash(b.image));
});

// Strokes are keyed to absolute canvas cells, so a crop paints the same picture; the
// error-driven passes look at the canvas they have painted so far, though, so a stroke here
// and there lands differently near the crop's edges. Compare the bulk, not every pixel.
test('a crop matches the same region of the full canvas', () => {
  const full = render({ width: 360, seed: 5 });
  const part = render({ width: 360, seed: 5, crop: [0.25, 0.5, 0.75, 1] });
  const { x0, y0 } = part.region;
  const diffs = [];
  for (let y = 0; y < part.image.h; y++) {
    for (let x = 0; x < part.image.w; x++) {
      let d = 0;
      for (let k = 0; k < 3; k++) {
        const a = part.image.data[(y * part.image.w + x) * 3 + k];
        const b = full.image.data[((y + y0) * full.image.w + x + x0) * 3 + k];
        d = Math.max(d, Math.abs(a - b));
      }
      diffs.push(d);
    }
  }
  diffs.sort((a, b) => a - b);
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const median = diffs[diffs.length >> 1];
  assert.ok(mean < 0.02, `crop differs from full render by ${mean} on average`);
  assert.ok(median < 0.005, `median difference ${median}`);
});
