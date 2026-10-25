// Colour: sRGB <-> linear <-> OKLab, a four-pigment Zorn palette mixer
// (single-constant Kubelka–Munk per RGB channel) and a gamut clamp that keeps
// every colour mixable from lead white, yellow ochre, vermilion and ivory black.

export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

export function linearToOklab(r, g, b, out = [0, 0, 0]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return out;
}

export function oklabToLinear(L, a, b, out = [0, 0, 0]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return out;
}

// OKLCH with hue in degrees -> linear RGB.
export function oklch(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  return oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
}

// ---------------------------------------------------------------- pigments
// Masstone reflectances (linear RGB) of the four Zorn pigments.
export const PIGMENTS = {
  W: [0.91, 0.885, 0.81], // lead white, warm
  O: [0.571, 0.287, 0.048], // yellow ochre
  V: [0.716, 0.042, 0.019], // vermilion
  K: [0.005, 0.006, 0.007], // ivory black: deep masstone, blue-grey tints
};

// Lightness range of the palette: ivory black masstone to lead white.
export const L_BLACK = 0.18;
export const L_WHITE = 0.962;

// Soft-limit lightness to what paint can reach (no HDR: highlights roll off into lead white).
export function paintLightness(L) {
  const hiKnee = 0.9;
  const loKnee = 0.24;
  if (L > hiKnee) return hiKnee + (L_WHITE - hiKnee) * Math.tanh((L - hiKnee) / (L_WHITE - hiKnee));
  if (L < loKnee) return loKnee - (loKnee - L_BLACK) * Math.tanh((loKnee - L) / (loKnee - L_BLACK));
  return L;
}

const ks = (r) => ((1 - r) * (1 - r)) / (2 * r);
const KS = Object.fromEntries(Object.entries(PIGMENTS).map(([k, v]) => [k, v.map(ks)]));

// Mix pigments by relative amounts, e.g. mixPaint({ W: 0.9, O: 0.08, K: 0.02 }).
export function mixPaint(recipe, out = [0, 0, 0]) {
  let total = 0;
  for (const k in recipe) total += recipe[k];
  for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (const k in recipe) s += (recipe[k] / total) * KS[k][ch];
    out[ch] = 1 + s - Math.sqrt(s * s + 2 * s);
  }
  return out;
}

// ---------------------------------------------------------------- gamut
const L_BINS = 64;
const H_BINS = 90;
let gamutTable = null;

function buildGamutTable() {
  const table = new Float32Array(L_BINS * H_BINS);
  const steps = [0, 0.003, 0.008, 0.015, 0.03, 0.06, 0.1, 0.15, 0.22, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const lab = [0, 0, 0];
  const rgb = [0, 0, 0];
  for (const o of steps) {
    for (const v of steps) {
      for (const k of steps) {
        const w = 1 - o - v - k;
        if (w < -1e-9) continue;
        mixPaint({ W: Math.max(0, w) + 1e-6, O: o, V: v, K: k }, rgb);
        linearToOklab(rgb[0], rgb[1], rgb[2], lab);
        const C = Math.hypot(lab[1], lab[2]);
        let h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
        if (h < 0) h += 360;
        const li = Math.min(L_BINS - 1, Math.max(0, Math.round(lab[0] * (L_BINS - 1))));
        const hi = Math.round(h / (360 / H_BINS)) % H_BINS;
        const idx = li * H_BINS + hi;
        if (C > table[idx]) table[idx] = C;
      }
    }
  }
  // Close sampling gaps: max-filter over neighbouring L and hue bins, then soften.
  const dilated = new Float32Array(table.length);
  for (let li = 0; li < L_BINS; li++) {
    for (let hi = 0; hi < H_BINS; hi++) {
      let m = 0;
      for (let dl = -2; dl <= 2; dl++) {
        const l2 = li + dl;
        if (l2 < 0 || l2 >= L_BINS) continue;
        for (let dh = -1; dh <= 1; dh++) {
          const h2 = (hi + dh + H_BINS) % H_BINS;
          m = Math.max(m, table[l2 * H_BINS + h2]);
        }
      }
      dilated[li * H_BINS + hi] = m;
    }
  }
  const out = new Float32Array(table.length);
  for (let li = 0; li < L_BINS; li++) {
    for (let hi = 0; hi < H_BINS; hi++) {
      let s = 0;
      let n = 0;
      for (let dl = -1; dl <= 1; dl++) {
        const l2 = li + dl;
        if (l2 < 0 || l2 >= L_BINS) continue;
        for (let dh = -1; dh <= 1; dh++) {
          s += dilated[l2 * H_BINS + ((hi + dh + H_BINS) % H_BINS)];
          n++;
        }
      }
      out[li * H_BINS + hi] = Math.min(dilated[li * H_BINS + hi], (s / n) * 1.15);
    }
  }
  return out;
}

// Largest chroma the palette can mix at lightness L and hue h (degrees).
export function zornMaxChroma(L, hDeg) {
  if (!gamutTable) gamutTable = buildGamutTable();
  const lf = Math.min(L_BINS - 1, Math.max(0, L * (L_BINS - 1)));
  const l0 = Math.floor(lf);
  const l1 = Math.min(L_BINS - 1, l0 + 1);
  const tl = lf - l0;
  let hf = (hDeg / (360 / H_BINS)) % H_BINS;
  if (hf < 0) hf += H_BINS;
  const h0 = Math.floor(hf) % H_BINS;
  const h1 = (h0 + 1) % H_BINS;
  const th = hf - Math.floor(hf);
  const t = gamutTable;
  const a = t[l0 * H_BINS + h0] * (1 - th) + t[l0 * H_BINS + h1] * th;
  const b = t[l1 * H_BINS + h0] * (1 - th) + t[l1 * H_BINS + h1] * th;
  return a * (1 - tl) + b * tl;
}

const tmpLab = [0, 0, 0];
const tmpRgb = [0, 0, 0];

// Clamp a linear-RGB colour (buf[i..i+2]) into the Zorn gamut, with an extra
// chroma ceiling `cap` (the brief keeps everything muted except the pouch).
export function zornClamp(buf, i, cap = 1) {
  let r = buf[i];
  let g = buf[i + 1];
  let b = buf[i + 2];
  if (r < 0) r = 0;
  if (g < 0) g = 0;
  if (b < 0) b = 0;
  linearToOklab(r, g, b, tmpLab);
  const L = paintLightness(tmpLab[0]);
  const C = Math.hypot(tmpLab[1], tmpLab[2]);
  if (C < 1e-5) {
    oklabToLinear(L, tmpLab[1], tmpLab[2], tmpRgb);
  } else {
    let h = (Math.atan2(tmpLab[2], tmpLab[1]) * 180) / Math.PI;
    if (h < 0) h += 360;
    const cm = Math.min(cap, zornMaxChroma(L, h));
    const k = C > cm ? cm / C : 1;
    oklabToLinear(L, tmpLab[1] * k, tmpLab[2] * k, tmpRgb);
  }
  buf[i] = Math.max(0, tmpRgb[0]);
  buf[i + 1] = Math.max(0, tmpRgb[1]);
  buf[i + 2] = Math.max(0, tmpRgb[2]);
}

// Lookup table for fast linear -> sRGB byte conversion.
const LUT_SIZE = 8192;
const SRGB_LUT = new Float32Array(LUT_SIZE + 1);
for (let i = 0; i <= LUT_SIZE; i++) SRGB_LUT[i] = linearToSrgb(i / LUT_SIZE) * 255;

export function linearToSrgb255(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 255;
  const f = c * LUT_SIZE;
  const i = f | 0;
  return SRGB_LUT[i] + (SRGB_LUT[i + 1] - SRGB_LUT[i]) * (f - i);
}
