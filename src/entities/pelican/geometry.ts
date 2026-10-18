import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Matrix that maps a unit +Y axis cylinder onto the segment `from` → `to`. */
export function matrixFromTo(from: THREE.Vector3, to: THREE.Vector3): THREE.Matrix4 {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  if (length < 1e-6) {
    direction.set(0, 1, 0);
  } else {
    direction.multiplyScalar(1 / length);
  }
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, direction);
  const midpoint = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  return new THREE.Matrix4().compose(midpoint, quaternion, new THREE.Vector3(1, 1, 1));
}

/**
 * Sweep an elliptical cross-section along a Catmull-Rom curve.
 * `radius(t)` returns {x: binormal-ish half width, y: normal-ish half height}.
 * Used for the pelican neck, mandibles, gular pouch and wing arms, where a
 * constant-radius TubeGeometry would read as a garden hose.
 */
export function sweepGeometry(
  points: readonly THREE.Vector3[],
  radius: (t: number) => THREE.Vector2,
  tubularSegments = 26,
  radialSegments = 10,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => point.clone()),
    false,
    'catmullrom',
    0.5,
  );
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, point);
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    const radii = radius(t);
    const rx = Math.max(radii.x, 1e-4);
    const ry = Math.max(radii.y, 1e-4);
    const invRx = 1 / rx;
    const invRy = 1 / ry;
    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(v);
      const sin = Math.sin(v);
      const ox = cos * rx;
      const oy = sin * ry;
      positions.push(
        point.x + normal.x * ox + binormal.x * oy,
        point.y + normal.y * ox + binormal.y * oy,
        point.z + normal.z * ox + binormal.z * oy,
      );
      const nx = normal.x * cos * invRx + binormal.x * sin * invRy;
      const ny = normal.y * cos * invRx + binormal.y * sin * invRy;
      const nz = normal.z * cos * invRx + binormal.z * sin * invRy;
      const invLength = 1 / (Math.hypot(nx, ny, nz) || 1);
      normals.push(nx * invLength, ny * invLength, nz * invLength);
      uvs.push(t, j / radialSegments);
    }
  }

  const ring = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = ring * i + j;
      const b = ring * (i + 1) + j;
      const c = ring * (i + 1) + j + 1;
      const d = ring * i + j + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * A single stylised feather blade: base pinched at the origin, pointed tip at
 * +Y, with a gentle out-of-plane bend so it catches rim light.
 */
export function featherGeometry(length = 1, width = 0.42): THREE.BufferGeometry {
  const half = width * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(half * 0.8, length * 0.08, half * 1.02, length * 0.48, half * 0.64, length * 0.8);
  shape.quadraticCurveTo(half * 0.38, length * 0.99, 0, length * 1.0);
  shape.quadraticCurveTo(-half * 0.38, length * 0.99, -half * 0.64, length * 0.8);
  shape.bezierCurveTo(-half * 1.02, length * 0.48, -half * 0.8, length * 0.08, 0, 0);
  const geometry = new THREE.ShapeGeometry(shape, 14);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const dome = Math.cos((x / Math.max(half, 1e-4)) * 0.9) * 0.5 + 0.5;
    position.setZ(i, position.getZ(i) + Math.sin((y / length) * Math.PI) * length * 0.05 + dome * length * 0.015);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Three-toed webbed pelican foot, lying flat pointing +Z. */
export function webbedFootGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.045);
  shape.lineTo(-0.058, 0.075);
  shape.quadraticCurveTo(-0.048, 0.102, -0.028, 0.094);
  shape.lineTo(0, 0.118);
  shape.lineTo(0.028, 0.094);
  shape.quadraticCurveTo(0.048, 0.102, 0.058, 0.075);
  shape.lineTo(0, -0.045);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
    curveSegments: 3,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0.006, 0);
  geometry.computeVertexNormals();
  return geometry;
}

export interface WheelGeometrySet {
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  spokes: THREE.BufferGeometry;
  hub: THREE.BufferGeometry;
  reflector: THREE.BufferGeometry;
}

/**
 * One shared set of wheel parts (axle along local +X, origin at the axle) used
 * by both wheels. The rear set adds a single-speed cog to the hub.
 */
export function createWheelGeometrySet(
  radius: number,
  tireTube: number,
  hubWidth: number,
  withCog: boolean,
): WheelGeometrySet {
  const tire = new THREE.TorusGeometry(radius - tireTube * 0.5, tireTube, 12, 64);
  tire.rotateY(Math.PI / 2);

  const rimRadius = radius - tireTube * 2 - 0.012;
  const rim = new THREE.TorusGeometry(rimRadius, 0.011, 8, 48);
  rim.rotateY(Math.PI / 2);

  const spokeParts: THREE.BufferGeometry[] = [];
  const spokeCount = 20;
  const flangeRadius = 0.048;
  const rimInner = rimRadius - 0.006;
  for (let i = 0; i < spokeCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const rimAngle = (i / spokeCount) * Math.PI * 2;
    const hubAngle = rimAngle + side * 0.4;
    const inner = new THREE.Vector3(
      side * 0.026,
      Math.cos(hubAngle) * flangeRadius,
      Math.sin(hubAngle) * flangeRadius,
    );
    const outer = new THREE.Vector3(0, Math.cos(rimAngle) * rimInner, Math.sin(rimAngle) * rimInner);
    const length = inner.distanceTo(outer);
    const spoke = new THREE.CylinderGeometry(0.0034, 0.0034, length, 4, 1, true);
    spoke.applyMatrix4(matrixFromTo(inner, outer));
    spokeParts.push(spoke);
  }
  const spokes = mergeGeometries(spokeParts, false) ?? new THREE.BufferGeometry();
  for (const part of spokeParts) part.dispose();

  const hubParts: THREE.BufferGeometry[] = [];
  const barrel = new THREE.CylinderGeometry(0.027, 0.027, hubWidth, 16, 1, false);
  barrel.rotateZ(Math.PI / 2);
  hubParts.push(barrel);
  for (const side of [-1, 1]) {
    const flange = new THREE.CylinderGeometry(flangeRadius, flangeRadius, 0.012, 20, 1, false);
    flange.rotateZ(Math.PI / 2);
    flange.translate(side * (hubWidth * 0.5 - 0.012), 0, 0);
    hubParts.push(flange);
    const axleCap = new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10, 1, false);
    axleCap.rotateZ(Math.PI / 2);
    axleCap.translate(side * (hubWidth * 0.5 + 0.01), 0, 0);
    hubParts.push(axleCap);
  }
  if (withCog) {
    const cog = new THREE.CylinderGeometry(0.055, 0.055, 0.012, 24, 1, false);
    cog.rotateZ(Math.PI / 2);
    cog.translate(hubWidth * 0.5 + 0.008, 0, 0);
    hubParts.push(cog);
    const cogBolt = new THREE.CylinderGeometry(0.015, 0.015, 0.02, 8, 1, false);
    cogBolt.rotateZ(Math.PI / 2);
    cogBolt.translate(hubWidth * 0.5 + 0.025, 0, 0);
    hubParts.push(cogBolt);
  }
  // tyre valve, so wheel spin reads at chase distance
  const valveAngle = 1.15;
  const valveInner = new THREE.Vector3(
    0.02,
    Math.cos(valveAngle) * (rimInner - 0.02),
    Math.sin(valveAngle) * (rimInner - 0.02),
  );
  const valveOuter = new THREE.Vector3(
    0.02,
    Math.cos(valveAngle) * (rimInner + 0.012),
    Math.sin(valveAngle) * (rimInner + 0.012),
  );
  const valveLength = valveInner.distanceTo(valveOuter);
  const valve = new THREE.CylinderGeometry(0.005, 0.005, valveLength, 6, 1, false);
  valve.applyMatrix4(matrixFromTo(valveInner, valveOuter));
  hubParts.push(valve);

  const hub = mergeGeometries(hubParts, false) ?? new THREE.BufferGeometry();
  for (const part of hubParts) part.dispose();

  const reflector = new THREE.BoxGeometry(0.012, 0.05, 0.076);
  reflector.translate(0.031, Math.cos(0.72) * 0.17, Math.sin(0.72) * 0.17);

  return { tire, rim, spokes, hub, reflector };
}

/**
 * Accumulates authored parts per material and merges them into one mesh per
 * material. This keeps the hero at roughly 60-70 draw calls while still being
 * built from hundreds of authored tubes, lugs and feathers.
 *
 * `add*` takes ownership of the supplied geometry (it is disposed after merge).
 * Use `addShared` for reusable geometry (bolts, spokes, feather templates).
 */
export class PartBatch {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): void {
    if (matrix) geometry.applyMatrix4(matrix);
    const bucket = this.parts.get(material);
    if (bucket) bucket.push(geometry);
    else this.parts.set(material, [geometry]);
  }

  addShared(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): void {
    this.add(geometry.clone(), material, matrix);
  }

  addSegment(
    material: THREE.Material,
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number,
    radialSegments = 8,
    endRadius = radius,
  ): void {
    const length = from.distanceTo(to);
    if (length < 1e-5) return;
    const geometry = new THREE.CylinderGeometry(endRadius, radius, length, radialSegments, 1, false);
    this.add(geometry, material, matrixFromTo(from, to));
  }

  addSweep(
    material: THREE.Material,
    points: readonly THREE.Vector3[],
    radius: (t: number) => THREE.Vector2,
    tubularSegments = 18,
    radialSegments = 8,
  ): void {
    this.add(sweepGeometry(points, radius, tubularSegments, radialSegments), material);
  }

  buildInto(
    parent: THREE.Object3D,
    parentInverse: THREE.Matrix4 | null,
    name: string,
    castShadow: boolean,
    receiveShadow: boolean,
  ): number {
    let built = 0;
    for (const [material, geometries] of this.parts) {
      const prepared: THREE.BufferGeometry[] = [];
      for (const geometry of geometries) {
        if (parentInverse) geometry.applyMatrix4(parentInverse);
        if (geometry.index) {
          const nonIndexed = geometry.toNonIndexed();
          geometry.dispose();
          prepared.push(nonIndexed);
        } else {
          prepared.push(geometry);
        }
      }
      const merged = mergeGeometries(prepared, false);
      for (const geometry of prepared) geometry.dispose();
      if (!merged) continue;
      const suffix = material.name.length > 0 ? material.name : 'mat';
      merged.name = `${name}.${suffix}`;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = merged.name;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      parent.add(mesh);
      built++;
    }
    this.parts.clear();
    return built;
  }
}
