// Every composition decision lives here. Canvas units: height = 1, width = ASPECT, y down.
// World units: metres. Y up, +Z along the breakwater toward the sun, X to the right.
// The pavement of the breakwater is at Y = 0.

export const ASPECT = 1.5;

export const LAYOUT = {
  aspect: ASPECT,
  horizon: 0.6, // canvas y of the horizon (vertical lens shift keeps verticals vertical)
  vpX: 0.93, // canvas x where +Z vanishes: the sun, right of centre (0.62 of the width)
  focal: 1.0, // focal length in canvas heights (~74 degrees horizontal field of view)
  eye: [0, 0.62, 0], // a low, crouching eye 0.62 m above the slabs, 0.3 m in from the seaward edge
  seaLevel: -2.6,

  // Painter's licence: shadows are cast from a steeper sun (same azimuth) so the figure's
  // long shadow lands on the visible slabs instead of far behind the viewer.
  shadowElevationDeg: 35,

  sun: {
    elevationDeg: 2.2,
    radius: 0.018, // apparent radius in canvas heights, swollen by haze
    flatten: 0.9, // refraction squashes the low sun vertically
  },

  pavement: {
    left: -2.9, // left edge of the slab walk
    right: 0.3, // right edge: a vertical wall drops to the open sea
    length: 420, // metres to the breakwater head, lost in the glare long before
  },

  sea: {
    slopeVariance: 0.24, // Cox–Munk mean-square slope, exaggerated (windy sea) to widen the glitter path
    hazeDistance: 700,
  },

  rider: {
    x: -1.4, // bottom bracket position on the slabs
    z: 2.5,
    headYawDeg: 22, // head turned right so the bill reads in profile toward the sun
  },

  spray: {
    z: 18, // the wave bursts on outlying rocks at the foot of the seaward wall
    x: 4.5,
  },

  flock: {
    count: 6,
  },
};
