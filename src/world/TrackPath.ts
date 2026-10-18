import * as THREE from 'three';

export interface TrackFrame {
  /** Centre of the road at this distance. */
  position: THREE.Vector3;
  /** Unit forward tangent in world space. */
  tangent: THREE.Vector3;
  /** Unit horizontal right (seaward) direction. */
  right: THREE.Vector3;
  /** Unit up. */
  up: THREE.Vector3;
  /** Horizontal yaw facing along the tangent, radians. */
  yaw: number;
  /** Signed horizontal curvature, positive turns right. */
  curvature: number;
  /** Distance along the loop in metres. */
  distance: number;
}

export interface TrackSample {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  yaw: number;
  distance: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Closed coastal circuit. Points run counter-clockwise in the XZ plane, so the
 * seaward/right side of the road is always the outside of the island.
 */
const CONTROL_POINTS: ReadonlyArray<readonly [number, number]> = [
  [146, 6],
  [140, 64],
  [116, 112],
  [76, 144],
  [18, 154],
  [-42, 142],
  [-98, 112],
  [-134, 66],
  [-146, 4],
  [-138, -58],
  [-110, -108],
  [-64, -144],
  [-6, -154],
  [54, -144],
  [106, -112],
  [136, -64],
];

export const ROAD_Y = 7.4;
export const ROAD_HALF_WIDTH = 3.7;

export class TrackPath {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly samples: TrackSample[] = [];

  private readonly uniformCount = 2048;
  private readonly frames: TrackFrame[] = [];
  private readonly curvatures: number[] = [];

  constructor() {
    const points = CONTROL_POINTS.map(
      ([x, z]) => new THREE.Vector3(x, ROAD_Y, z),
    );
    this.curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
    this.curve.arcLengthDivisions = 2400;
    this.length = this.curve.getLength();

    for (let i = 0; i < this.uniformCount; i += 1) {
      const u = i / this.uniformCount;
      const position = this.curve.getPointAt(u);
      const tangent = this.curve.getTangentAt(u);
      tangent.y = 0;
      tangent.normalize();
      const right = new THREE.Vector3().crossVectors(UP, tangent).normalize();
      this.samples.push({
        position,
        tangent,
        right,
        yaw: Math.atan2(tangent.x, tangent.z),
        distance: u * this.length,
      });
    }

    for (let i = 0; i < this.uniformCount; i += 1) {
      const prev = this.samples[(i - 1 + this.uniformCount) % this.uniformCount];
      const next = this.samples[(i + 1) % this.uniformCount];
      const cross =
        prev.tangent.x * next.tangent.z - prev.tangent.z * next.tangent.x;
      const curvature = Math.asin(THREE.MathUtils.clamp(cross, -1, 1));
      this.curvatures.push(curvature);
      this.frames.push({
        position: this.samples[i].position.clone(),
        tangent: this.samples[i].tangent.clone(),
        right: this.samples[i].right.clone(),
        up: new THREE.Vector3(0, 1, 0),
        yaw: this.samples[i].yaw,
        curvature,
        distance: this.samples[i].distance,
      });
    }
  }

  wrap(distance: number): number {
    const length = this.length;
    return ((distance % length) + length) % length;
  }

  /** Shortest signed distance from a to b around the loop. */
  delta(a: number, b: number): number {
    let value = this.wrap(b - a);
    if (value > this.length * 0.5) value -= this.length;
    return value;
  }

  /**
   * Returns a reused frame for the distance, smoothly interpolating between
   * the two nearest path samples. Snapping to the nearest sample would make
   * the rider jump ~1 m at a time as it advances, which reads as a visible
   * hitch while accelerating.
   */
  frameAt(distance: number): TrackFrame {
    const wrapped = this.wrap(distance);
    const rawIndex = (wrapped / this.length) * this.uniformCount;
    const i0 = Math.floor(rawIndex) % this.uniformCount;
    const i1 = (i0 + 1) % this.uniformCount;
    const t = rawIndex - Math.floor(rawIndex);
    const a = this.samples[i0];
    const b = this.samples[i1];
    const frame = this.frames[i0];

    frame.position.lerpVectors(a.position, b.position, t);
    frame.tangent.lerpVectors(a.tangent, b.tangent, t).normalize();
    frame.right.crossVectors(UP, frame.tangent).normalize();
    frame.yaw = Math.atan2(frame.tangent.x, frame.tangent.z);
    frame.curvature = THREE.MathUtils.lerp(
      this.curvatures[i0],
      this.curvatures[i1],
      t,
    );
    frame.distance = wrapped;
    return frame;
  }

  positionAt(distance: number, target = new THREE.Vector3()): THREE.Vector3 {
    const u = this.wrap(distance) / this.length;
    return target.copy(this.curve.getPointAt(u));
  }

  tangentAt(distance: number, target = new THREE.Vector3()): THREE.Vector3 {
    const u = this.wrap(distance) / this.length;
    target.copy(this.curve.getTangentAt(u));
    target.y = 0;
    return target.normalize();
  }

  /** Point offset from the centre line, positive towards the sea. */
  offsetPoint(
    distance: number,
    lateral: number,
    target = new THREE.Vector3(),
  ): THREE.Vector3 {
    const frame = this.frameAt(distance);
    return target
      .copy(frame.position)
      .addScaledVector(frame.right, lateral);
  }

  nearestDistance(position: THREE.Vector3): number {
    let best = 0;
    let bestDistanceSq = Infinity;
    for (const sample of this.samples) {
      const dx = sample.position.x - position.x;
      const dz = sample.position.z - position.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = sample.distance;
      }
    }
    return best;
  }

  /** Mean radius, used for terrain and sky placement. */
  get radius(): number {
    let total = 0;
    for (const sample of this.samples) {
      total += Math.hypot(sample.position.x, sample.position.z);
    }
    return total / this.samples.length;
  }
}
