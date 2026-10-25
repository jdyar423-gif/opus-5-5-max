// Object classes written into the style maps; the painter chooses brushes per class.
export const OBJ = {
  SKY: 0,
  SUN: 1,
  SEA: 2,
  PAVEMENT: 3,
  STONE: 4,
  SPRAY: 5,
  PLUMAGE: 6,
  HEAD: 7,
  BILL: 8,
  POUCH: 9,
  EYE: 10,
  FEET: 11,
  BIKE: 12,
  SPOKE: 13,
  TIRE: 14,
  FLOCK: 15,
  RUST: 16,
};

export const OBJ_NAMES = Object.fromEntries(Object.entries(OBJ).map(([k, v]) => [v, k]));
