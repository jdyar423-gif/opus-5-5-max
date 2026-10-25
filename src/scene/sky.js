// Sky radiance for the contre-jour sunset: pewter overhead, pearl in the middle
// distance, pale gold around a veiled sun just above the horizon.
import { oklabToLinear } from '../lib/color.js';
import { smoothstep, clamp } from '../lib/noise.js';
import { sunDirection } from './camera.js';

// OKLab (a, b) anchors.
const GOLD = [0.0079, 0.056]; // h ~82, C ~0.056
const PEARL = [-0.0012, 0.017]; // h ~94, C ~0.017
const PEWTER = [-0.0048, -0.0105]; // h ~245, C ~0.012
const LEMON = [0.0012, 0.03]; // the veiled disc: paler and cooler than its glow

export function makeSky(L, noise) {
  const sun = sunDirection(L);
  const sunRadius = L.sun.radius / L.focal; // radians (small angle)
  const flatten = L.sun.flatten;
  const sunEl = Math.asin(sun[1]);

  // Cloud density on a flat layer at height h, streaked along X (crests across the view).
  function layer(d, h, sx, sz, ox, oz, octaves) {
    const y = Math.max(d[1], 0.012);
    const X = (d[0] / y) * h;
    const Z = (d[2] / y) * h;
    return noise.fbm2(X / sx + ox, Z / sz + oz, octaves);
  }

  // Returns linear RGB in out; `parts` (optional) receives {glow, cloud, disc} for style maps.
  // `noDisc` leaves the sun's disc out (sea reflections get the sun from the glitter term).
  function color(d, out = [0, 0, 0], parts = null, noDisc = false) {
    const e = Math.asin(clamp(d[1], -1, 1));
    const cosG = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2];
    const g = Math.acos(clamp(cosG, -1, 1)); // angular distance to the sun

    // Lightness: horizon brightening + layered aureole.
    let Lk = 0.635 + 0.17 * Math.exp(-Math.max(e, 0) / 0.11);
    const glow =
      0.11 * Math.exp(-g / 0.55) + 0.13 * Math.exp(-g / 0.17) + 0.12 * Math.exp(-((g / 0.045) ** 2));
    Lk += glow;

    // Hue: pewter high and away from the sun, pearl near the horizon, gold toward the sun.
    const warm = Math.exp(-g / 0.33);
    const horizonWarm = Math.exp(-Math.max(e, 0) / 0.07);
    const tPearl = clamp(0.3 + 0.7 * Math.max(horizonWarm, warm * 1.1));
    let a = PEWTER[0] + (PEARL[0] - PEWTER[0]) * tPearl;
    let b = PEWTER[1] + (PEARL[1] - PEWTER[1]) * tPearl;
    const tGold = clamp(warm * 1.15 - 0.08 + 0.35 * horizonWarm * warm);
    a += (GOLD[0] - a) * tGold;
    b += (GOLD[1] - b) * tGold;

    // Clouds: a streaky low layer and a high veil. Thin edges near the sun turn to silver-gold.
    let cloud = 0;
    if (e > 0.004) {
      const fade = smoothstep(0.004, 0.05, e);
      const low = layer(d, 900, 2600, 340, 3.1, 7.7, 5);
      const high = layer(d, 5000, 9000, 2200, -4.2, 1.3, 4);
      const lowD = smoothstep(0.02, 0.38, low) * fade;
      const highD = smoothstep(-0.1, 0.45, high) * 0.6 * smoothstep(0.02, 0.2, e);
      cloud = Math.min(1, lowD + highD * (1 - lowD));
      const forward = Math.exp(-g / 0.3);
      // Thick cloud is darker than the sky (against the light); thin cloud near the sun is brighter.
      // Heavy stratus overhead (Homer's weight), thinning and lighting toward the sun.
      const body = -0.15 * cloud * (1 - 0.4 * forward) * (0.35 + 0.65 * smoothstep(0, 0.3, e));
      const silver = 0.11 * forward * cloud * (1 - cloud) * 4 * (0.5 + 0.5 * forward);
      Lk += body + silver;
      // Cloud bodies take a faint warm-mauve grey (vermilion + black + white) toward the sun.
      const mauve = cloud * forward * 0.6;
      a += (0.006 - a) * mauve * 0.5;
      b += (0.004 - b) * mauve * 0.5;
    }

    // A painter's shoulder on the glow: it climbs toward white but never plateaus there, so
    // the disc itself stays the lightest note.
    if (Lk > 0.8) Lk = 0.8 + 0.14 * (1 - Math.exp(-(Lk - 0.8) / 0.14));

    // The veiled disc: slightly flattened, soft limb, paler than its glow.
    let disc = 0;
    if (!noDisc) {
      const de = (e - sunEl) / flatten;
      const daz = Math.atan2(d[0], d[2]);
      const r = Math.hypot(de, daz * Math.cos(e));
      disc = 1 - smoothstep(sunRadius * 0.82, sunRadius * 1.08, r);
      if (disc > 0) {
        Lk += (1.02 - Lk) * disc;
        a += (LEMON[0] - a) * disc;
        b += (LEMON[1] - b) * disc;
      }
    }

    // Sea haze hugging the horizon veils the bottom of the disc and flattens the sky there.
    const haze = Math.exp(-Math.max(e, 0) / 0.012) * 0.55;
    const hazeL = 0.8 + 0.12 * Math.exp(-g / 0.12);
    Lk += (hazeL - Lk) * haze;
    a += (PEARL[0] * 0.5 + GOLD[0] * 0.5 * warm - a) * haze * 0.6;
    b += (PEARL[1] * 0.5 + GOLD[1] * 0.5 * warm - b) * haze * 0.6;

    if (parts) {
      parts.glow = glow;
      parts.cloud = cloud;
      parts.disc = disc;
    }
    return oklabToLinear(Lk, a, b, out);
  }

  return { color, sun, sunRadius };
}
