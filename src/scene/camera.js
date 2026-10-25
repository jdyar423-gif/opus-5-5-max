// Pinhole camera with yaw and vertical lens shift (no pitch, so verticals stay vertical).
export class Camera {
  constructor({ eye, yaw, focal, cx, cy }) {
    this.eye = eye;
    this.f = focal;
    this.cx = cx;
    this.cy = cy;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    this.right = [c, 0, s];
    this.fwd = [-s, 0, c];
  }

  // World point -> [canvas x, canvas y, camera depth].
  project(P, out = [0, 0, 0]) {
    const dx = P[0] - this.eye[0];
    const dy = P[1] - this.eye[1];
    const dz = P[2] - this.eye[2];
    const xc = dx * this.right[0] + dz * this.right[2];
    const zc = dx * this.fwd[0] + dz * this.fwd[2];
    out[0] = this.cx + (this.f * xc) / zc;
    out[1] = this.cy - (this.f * dy) / zc;
    out[2] = zc;
    return out;
  }

  // Canvas point -> unit world direction.
  dir(x, y, out = [0, 0, 0]) {
    const a = (x - this.cx) / this.f;
    const b = (this.cy - y) / this.f;
    const dx = this.right[0] * a + this.fwd[0];
    const dz = this.right[2] * a + this.fwd[2];
    const l = Math.hypot(dx, b, dz);
    out[0] = dx / l;
    out[1] = b / l;
    out[2] = dz / l;
    return out;
  }
}

export function makeMainCamera(L) {
  const cx = L.aspect / 2;
  const yaw = Math.atan((L.vpX - cx) / L.focal);
  return new Camera({ eye: L.eye, yaw, focal: L.focal, cx, cy: L.horizon });
}

// Direction toward the sun, exactly along the breakwater.
export function sunDirection(L) {
  const e = (L.sun.elevationDeg * Math.PI) / 180;
  return [0, Math.sin(e), Math.cos(e)];
}
