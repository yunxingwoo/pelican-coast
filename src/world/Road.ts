import * as THREE from 'three';
import { TrackPath, ROAD_Y, ROAD_HALF_WIDTH } from './TrackPath';
import {
  createAsphaltTexture,
  createBikeLaneTexture,
  createCanvasTexture,
  type RandomSource,
} from './ProceduralTextures';

const SEA_SHOULDER = 4.65;
const INLAND_SHOULDER = 4.5;
const SEGMENTS = 960;

type ColorSpec = string | ((distance: number, lateral: number) => THREE.Color);

function toLinearColor(spec: ColorSpec, distance: number, lateral: number): THREE.Color {
  if (typeof spec === 'string') return new THREE.Color(spec).convertSRGBToLinear();
  return spec(distance, lateral).convertSRGBToLinear();
}

function buildGrid(
  path: TrackPath,
  segments: number,
  laterals: number[],
  height: (distance: number, lateral: number) => number,
  color: ColorSpec,
  jitter = 0,
  rng?: RandomSource,
): THREE.BufferGeometry {
  const alongCount = segments + 1;
  const lateralCount = laterals.length;
  const vertexCount = alongCount * lateralCount;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const indices: number[] = [];
  const point = new THREE.Vector3();
  const colorValue = new THREE.Color();
  const step = path.length / segments;

  for (let i = 0; i < alongCount; i += 1) {
    const distance = path.wrap(i * step);
    const f = path.frameAt(distance);
    for (let j = 0; j < lateralCount; j += 1) {
      const lateral = laterals[j];
      const index = i * lateralCount + j;
      point.copy(f.position).addScaledVector(f.right, lateral);
      let y = height(distance, lateral);
      if (jitter > 0 && rng) {
        point.x += (rng() - 0.5) * jitter;
        point.z += (rng() - 0.5) * jitter;
        y += (rng() - 0.5) * jitter * 0.4;
      }
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = point.z;
      uvs[index * 2] = j / (lateralCount - 1);
      uvs[index * 2 + 1] = distance / 8;
      colorValue.copy(toLinearColor(color, distance, lateral));
      colors[index * 3] = colorValue.r;
      colors[index * 3 + 1] = colorValue.g;
      colors[index * 3 + 2] = colorValue.b;
    }
  }

  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < lateralCount - 1; j += 1) {
      const a = i * lateralCount + j;
      const b = a + 1;
      const c = a + lateralCount;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildRibbon(
  path: TrackPath,
  segments: number,
  offsetA: number,
  offsetB: number,
  y: number,
  uvLength = 8,
): THREE.BufferGeometry {
  const alongCount = segments + 1;
  const positions = new Float32Array(alongCount * 2 * 3);
  const uvs = new Float32Array(alongCount * 2 * 2);
  const indices: number[] = [];
  const point = new THREE.Vector3();
  const step = path.length / segments;

  for (let i = 0; i < alongCount; i += 1) {
    const distance = path.wrap(i * step);
    const frame = path.frameAt(distance);
    for (let j = 0; j < 2; j += 1) {
      const lateral = j === 0 ? offsetA : offsetB;
      point.copy(frame.position).addScaledVector(frame.right, lateral);
      const index = i * 2 + j;
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = point.z;
      uvs[index * 2] = j;
      uvs[index * 2 + 1] = distance / uvLength;
    }
  }

  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

class MarkingBuilder {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];
  private readonly point = new THREE.Vector3();

  addQuad(
    path: TrackPath,
    start: number,
    end: number,
    offsetA: number,
    offsetB: number,
    y: number,
  ): void {
    const base = this.positions.length / 3;
    const distances = [start, (start + end) * 0.5, end];
    for (const distance of distances) {
      const frame = path.frameAt(distance);
      for (const offset of [offsetA, offsetB]) {
        this.point.copy(frame.position).addScaledVector(frame.right, offset);
        this.positions.push(this.point.x, y, this.point.z);
        this.uvs.push(0, 0);
      }
    }
    for (let i = 0; i < 2; i += 1) {
      const a = base + i * 2;
      this.indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    return geometry;
  }
}

export class RoadWorld {
  readonly group = new THREE.Group();
  private readonly foamMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly rng: RandomSource;
  private asphaltMaterial: THREE.MeshStandardMaterial | null = null;
  private wetness = 0;

  constructor(
    private readonly path: TrackPath,
    rng: RandomSource,
  ) {
    this.rng = rng;
    this.group.name = 'CoastalRoad';
    this.buildRoad();
    this.buildMarkings();
    this.buildGuardrail();
    this.buildStoneWall();
    this.buildCliffs();
    this.buildTerrain();
    this.buildCentralHills();
  }

  setWetness(value: number): void {
    this.wetness = THREE.MathUtils.clamp(value, 0, 1);
    if (!this.asphaltMaterial) return;
    this.asphaltMaterial.roughness = THREE.MathUtils.lerp(0.92, 0.39, this.wetness);
    this.asphaltMaterial.color.set('#b9c0be').lerp(new THREE.Color('#78848a'), this.wetness * 0.42);
    this.asphaltMaterial.envMapIntensity = this.wetness;
  }

  update(delta: number, elapsed: number, windStrength: number): void {
    for (let i = 0; i < this.foamMaterials.length; i += 1) {
      const map = this.foamMaterials[i].map;
      if (map) {
        map.offset.x = (map.offset.x + delta * (0.006 + windStrength * 0.004)) % 1;
        map.offset.y = (map.offset.y + delta * 0.003) % 1;
      }
    }
    this.foamMaterials.forEach((material, index) => {
      material.opacity = 0.42 + Math.sin(elapsed * 0.7 + index * 1.7) * 0.12;
    });
  }

  private buildRoad(): void {
    const asphaltMap = createAsphaltTexture(this.rng);
    asphaltMap.wrapS = THREE.RepeatWrapping;
    asphaltMap.wrapT = THREE.RepeatWrapping;
    asphaltMap.anisotropy = 8;

    const asphaltMaterial = new THREE.MeshStandardMaterial({
      color: '#aeb5b3',
      map: asphaltMap,
      roughness: 0.97,
      metalness: 0.02,
    });
    this.asphaltMaterial = asphaltMaterial;
    const road = new THREE.Mesh(
      buildRibbon(
        this.path,
        SEGMENTS,
        -ROAD_HALF_WIDTH,
        ROAD_HALF_WIDTH,
        ROAD_Y,
        6.4,
      ),
      asphaltMaterial,
    );
    road.receiveShadow = true;
    road.name = 'asphalt';
    this.group.add(road);

    const seaShoulder = new THREE.Mesh(
      buildRibbon(this.path, SEGMENTS, ROAD_HALF_WIDTH, SEA_SHOULDER, ROAD_Y + 0.035, 5),
      new THREE.MeshStandardMaterial({
        color: '#c8bda8',
        roughness: 0.86,
        metalness: 0.02,
      }),
    );
    seaShoulder.receiveShadow = true;
    this.group.add(seaShoulder);

    const inlandShoulder = new THREE.Mesh(
      buildRibbon(
        this.path,
        SEGMENTS,
        -INLAND_SHOULDER,
        -ROAD_HALF_WIDTH,
        ROAD_Y + 0.025,
        5,
      ),
      new THREE.MeshStandardMaterial({
        color: '#a19476',
        roughness: 0.95,
        metalness: 0,
      }),
    );
    inlandShoulder.receiveShadow = true;
    this.group.add(inlandShoulder);

    const curb = new THREE.Mesh(
      buildRibbon(this.path, SEGMENTS, ROAD_HALF_WIDTH - 0.02, ROAD_HALF_WIDTH + 0.22, ROAD_Y + 0.12, 4),
      new THREE.MeshStandardMaterial({
        color: '#d7cdb5',
        roughness: 0.7,
      }),
    );
    curb.receiveShadow = true;
    this.group.add(curb);
  }

  private buildMarkings(): void {
    const dashes = new MarkingBuilder();
    const dashLength = 3.2;
    const gap = 4.6;
    const stride = dashLength + gap;
    for (let start = 0; start < this.path.length; start += stride) {
      dashes.addQuad(
        this.path,
        start,
        start + dashLength,
        -0.075,
        0.075,
        ROAD_Y + 0.018,
      );
    }

    const solid = new MarkingBuilder();
    for (const [a, b] of [
      [3.24, 3.36],
      [-3.36, -3.24],
    ]) {
      const steps = 180;
      for (let i = 0; i < steps; i += 1) {
        const start = (i / steps) * this.path.length;
        solid.addQuad(
          this.path,
          start,
          start + this.path.length / steps + 0.3,
          a,
          b,
          ROAD_Y + 0.016,
        );
      }
    }

    const lineMaterial = new THREE.MeshStandardMaterial({
      color: '#f3e6c8',
      roughness: 0.62,
      metalness: 0,
      emissive: '#3a2e1b',
      emissiveIntensity: 0.18,
    });
    const dashMesh = new THREE.Mesh(dashes.build(), lineMaterial);
    dashMesh.receiveShadow = true;
    this.group.add(dashMesh);
    const solidMesh = new THREE.Mesh(solid.build(), lineMaterial);
    solidMesh.receiveShadow = true;
    this.group.add(solidMesh);

    const glyphMap = createBikeLaneTexture();
    const glyphMaterial = new THREE.MeshBasicMaterial({
      map: glyphMap,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const glyphGeometry = new THREE.PlaneGeometry(1.55, 1.55);
    const glyphCount = 11;
    const glyphs = new THREE.InstancedMesh(glyphGeometry, glyphMaterial, glyphCount);
    const glyphDummy = new THREE.Object3D();
    for (let i = 0; i < glyphCount; i += 1) {
      const distance = (i / glyphCount) * this.path.length + 18;
      const frame = this.path.frameAt(distance);
      glyphDummy.position.copy(frame.position).addScaledVector(frame.right, -2.1);
      glyphDummy.position.y = ROAD_Y + 0.021;
      glyphDummy.rotation.order = 'YXZ';
      glyphDummy.rotation.y = frame.yaw;
      glyphDummy.rotation.x = -Math.PI / 2;
      glyphDummy.rotation.z = Math.PI;
      glyphDummy.updateMatrix();
      glyphs.setMatrixAt(i, glyphDummy.matrix);
    }
    glyphs.instanceMatrix.needsUpdate = true;
    this.group.add(glyphs);
  }

  private buildGuardrail(): void {
    const railMaterial = new THREE.MeshStandardMaterial({
      color: '#d8d0bd',
      roughness: 0.42,
      metalness: 0.55,
    });
    const span = 4.2;
    const railCount = Math.floor(this.path.length / span);
    const railGeometry = new THREE.BoxGeometry(0.09, 0.12, span + 0.14);
    const railsLow = new THREE.InstancedMesh(railGeometry, railMaterial, railCount);
    const railsHigh = new THREE.InstancedMesh(railGeometry, railMaterial, railCount);
    railsLow.castShadow = true;
    railsLow.receiveShadow = true;
    railsHigh.castShadow = true;
    const railDummy = new THREE.Object3D();
    for (let i = 0; i < railCount; i += 1) {
      const distance = (i / railCount) * this.path.length;
      const frame = this.path.frameAt(distance);
      const next = this.path.frameAt(distance + span * 0.5);
      const yaw = Math.atan2(next.position.x - frame.position.x, next.position.z - frame.position.z);
      railDummy.position
        .copy(frame.position)
        .addScaledVector(frame.right, SEA_SHOULDER - 0.18)
        .addScaledVector(frame.tangent, span * 0.5);
      railDummy.rotation.set(0, yaw, 0);
      railDummy.position.y = ROAD_Y + 0.56;
      railDummy.updateMatrix();
      railsLow.setMatrixAt(i, railDummy.matrix);
      railDummy.position.y = ROAD_Y + 0.88;
      railDummy.updateMatrix();
      railsHigh.setMatrixAt(i, railDummy.matrix);
    }
    railsLow.instanceMatrix.needsUpdate = true;
    railsHigh.instanceMatrix.needsUpdate = true;
    this.group.add(railsLow, railsHigh);

    const postCount = Math.floor(this.path.length / 4.2);
    const postGeometry = new THREE.BoxGeometry(0.13, 0.92, 0.13);
    const postMaterial = new THREE.MeshStandardMaterial({
      color: '#b9b3a1',
      roughness: 0.5,
      metalness: 0.45,
    });
    const posts = new THREE.InstancedMesh(postGeometry, postMaterial, postCount);
    posts.castShadow = true;
    posts.receiveShadow = true;
    const capGeometry = new THREE.BoxGeometry(0.2, 0.075, 0.2);
    const caps = new THREE.InstancedMesh(capGeometry, postMaterial, postCount);
    caps.castShadow = true;
    const markerGeometry = new THREE.BoxGeometry(0.055, 0.12, 0.055);
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: '#ff6b4a',
      emissive: '#ff5a32',
      emissiveIntensity: 0.7,
      roughness: 0.4,
    });
    const markerCount = Math.ceil(postCount / 3);
    const markers = new THREE.InstancedMesh(markerGeometry, markerMaterial, markerCount);
    const dummy = new THREE.Object3D();
    let markerIndex = 0;

    for (let i = 0; i < postCount; i += 1) {
      const distance = (i / postCount) * this.path.length;
      const frame = this.path.frameAt(distance);
      dummy.position.copy(frame.position).addScaledVector(frame.right, SEA_SHOULDER - 0.18);
      dummy.position.y = ROAD_Y + 0.46;
      dummy.rotation.set(0, frame.yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
      dummy.position.y = ROAD_Y + 0.94;
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
      if (i % 3 === 0 && markerIndex < markerCount) {
        dummy.position.copy(frame.position)
          .addScaledVector(frame.right, SEA_SHOULDER - 0.18);
        dummy.position.y = ROAD_Y + 0.86;
        dummy.rotation.set(0, frame.yaw, 0);
        dummy.updateMatrix();
        markers.setMatrixAt(markerIndex, dummy.matrix);
        markerIndex += 1;
      }
    }
    posts.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    markers.instanceMatrix.needsUpdate = true;
    this.group.add(posts, caps, markers);
  }

  private buildStoneWall(): void {
    const count = Math.floor(this.path.length / 1.15);
    const geometry = new THREE.DodecahedronGeometry(0.34, 0);
    const material = new THREE.MeshStandardMaterial({
      color: '#b7a88a',
      roughness: 0.92,
      metalness: 0,
    });
    const stones = new THREE.InstancedMesh(geometry, material, count);
    stones.castShadow = true;
    stones.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      const distance = (i / count) * this.path.length;
      const frame = this.path.frameAt(distance);
      dummy.position.copy(frame.position).addScaledVector(frame.right, -INLAND_SHOULDER + 0.08);
      dummy.position.y = ROAD_Y + 0.3 + this.rng() * 0.18;
      dummy.rotation.set(this.rng() * 0.5, frame.yaw + this.rng() * 0.6, this.rng() * 0.4);
      dummy.scale.set(1.4 + this.rng() * 0.5, 0.72 + this.rng() * 0.24, 1.05 + this.rng() * 0.3);
      dummy.updateMatrix();
      stones.setMatrixAt(i, dummy.matrix);
      const shade = 0.72 + this.rng() * 0.28;
      color.setRGB(shade * 0.78, shade * 0.71, shade * 0.56);
      stones.setColorAt(i, color);
    }
    stones.instanceMatrix.needsUpdate = true;
    if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
    this.group.add(stones);
  }

  private buildCliffs(): void {
    const laterals = [4.8, 5.6, 6.8, 8.5, 11, 14, 18, 23, 29, 36, 44];
    const geometry = buildGrid(
      this.path,
      300,
      laterals,
      (distance, lateral) => {
        const base = [
          ROAD_Y - 0.1,
          ROAD_Y - 0.9,
          ROAD_Y - 2.2,
          4.2,
          2.5,
          1.55,
          0.8,
          0.25,
          -0.15,
          -0.5,
          -1.1,
        ];
        const index = laterals.indexOf(lateral);
        const noise =
          Math.sin(distance * 0.19 + lateral * 1.7) * 0.35 +
          Math.sin(distance * 0.47 + lateral * 0.6) * 0.16;
        return base[index] + noise * (index > 1 ? 1 : 0.2);
      },
      (distance, lateral) => {
        const t = THREE.MathUtils.clamp(lateral / 44, 0, 1);
        const noise = (Math.sin(distance * 0.33 + lateral * 2.1) + 1) * 0.5;
        if (t < 0.18) {
          return new THREE.Color('#8f8d72').lerp(new THREE.Color('#7d7b65'), noise);
        }
        if (t < 0.7) {
          return new THREE.Color('#807464').lerp(new THREE.Color('#5b5953'), noise * 0.8);
        }
        return new THREE.Color('#4f5754').lerp(new THREE.Color('#3f4b49'), noise);
      },
      0.5,
      this.rng,
    );
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    material.color.set('#ffffff');
    const cliffs = new THREE.Mesh(geometry, material);
    cliffs.castShadow = true;
    cliffs.receiveShadow = true;
    this.group.add(cliffs);

    // Wet rock ledges at the waterline, broken up by scale variation.
    const rockCount = 160;
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: '#5e615c',
      roughness: 0.9,
      metalness: 0.02,
    });
    const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockCount);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < rockCount; i += 1) {
      const distance = (i / rockCount) * this.path.length + this.rng() * 3;
      const frame = this.path.frameAt(distance);
      const lateral = 30 + this.rng() * 18;
      dummy.position.copy(frame.position).addScaledVector(frame.right, lateral);
      dummy.position.y = -0.3 + this.rng() * 0.9;
      dummy.rotation.set(this.rng() * Math.PI, this.rng() * Math.PI, this.rng() * Math.PI);
      const scale = 0.7 + this.rng() * 2.4;
      dummy.scale.set(scale, scale * (0.5 + this.rng() * 0.5), scale);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      const shade = 0.72 + this.rng() * 0.3;
      color.setRGB(shade * 0.55, shade * 0.56, shade * 0.53);
      rocks.setColorAt(i, color);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    this.group.add(rocks);

    const foamMap = createCanvasTexture(256, 128, (context, width, height) => {
      context.clearRect(0, 0, width, height);
      for (let i = 0; i < 120; i += 1) {
        context.fillStyle = `rgba(245, 248, 240, ${0.04 + this.rng() * 0.25})`;
        context.beginPath();
        context.ellipse(
          this.rng() * width,
          this.rng() * height,
          4 + this.rng() * 26,
          1 + this.rng() * 4,
          this.rng() * Math.PI,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    });
    foamMap.wrapS = THREE.RepeatWrapping;
    foamMap.wrapT = THREE.RepeatWrapping;
    foamMap.repeat.set(9, 3);
    const foamMaterial = new THREE.MeshBasicMaterial({
      map: foamMap,
      color: '#e8f1e9',
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.foamMaterials.push(foamMaterial);
    const foam = new THREE.Mesh(
      buildGrid(
        this.path,
        260,
        [28, 33, 38, 43, 49],
        () => 0.09,
        () => new THREE.Color('#ffffff'),
      ),
      foamMaterial,
    );
    foam.name = 'shore-foam';
    this.group.add(foam);
  }

  private buildTerrain(): void {
    const laterals = [-4.5, -5.6, -7, -9, -12, -16, -21, -27, -33, -39];
    const heights = [ROAD_Y - 0.08, ROAD_Y + 0.04, ROAD_Y + 0.5, ROAD_Y + 1.3, ROAD_Y + 2.5, ROAD_Y + 4.1, ROAD_Y + 5.6, ROAD_Y + 6.9, ROAD_Y + 7.8, ROAD_Y + 8.2];
    const geometry = buildGrid(
      this.path,
      SEGMENTS,
      laterals,
      (distance, lateral) => {
        const index = laterals.indexOf(lateral);
        const rolling =
          Math.sin(distance * 0.055 + index * 0.7) * (0.25 + index * 0.075) +
          Math.sin(distance * 0.17 + lateral) * 0.13 * index;
        return heights[index] + rolling;
      },
      (distance, lateral) => {
        const t = THREE.MathUtils.clamp((-lateral - 4.5) / 34, 0, 1);
        const patch =
          (Math.sin(distance * 0.23 + lateral * 0.8) + 1) * 0.5;
        const base = new THREE.Color('#778758').lerp(new THREE.Color('#9aa06a'), t * 0.7);
        const dry = new THREE.Color('#b0a468');
        return base.lerp(dry, patch * 0.35 + t * 0.12);
      },
    );
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.98,
      metalness: 0,
      flatShading: false,
      side: THREE.DoubleSide,
    });
    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    this.group.add(terrain);

    // Wildflower wash and long grass strips at the verge.
    const vergeGeometry = buildRibbon(this.path, SEGMENTS, -6.4, -4.7, ROAD_Y + 0.16, 3.2);
    const vergeMaterial = new THREE.MeshStandardMaterial({
      color: '#9b9d62',
      roughness: 1,
      transparent: true,
      opacity: 0.92,
    });
    const verge = new THREE.Mesh(vergeGeometry, vergeMaterial);
    verge.receiveShadow = true;
    this.group.add(verge);
  }

  private buildCentralHills(): void {
    const radius = 122;
    const rings = 30;
    const spokes = 96;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const color = new THREE.Color();

    for (let r = 0; r <= rings; r += 1) {
      const radiusValue = (r / rings) * radius;
      for (let s = 0; s < spokes; s += 1) {
        const angle = (s / spokes) * Math.PI * 2;
        const x = Math.cos(angle) * radiusValue;
        const z = Math.sin(angle) * radiusValue;
        const edge = r / rings;
        const peak = 30;
        let height = ROAD_Y + 8.2 + (1 - edge) * peak;
        height += Math.sin(angle * 3.2 + edge * 5) * 1.5 * (1 - edge * 0.4);
        height += Math.sin(angle * 7.1) * 0.7 * (1 - edge);
        positions.push(x, height, z);
        const grassy = new THREE.Color('#8a9c69').lerp(
          new THREE.Color('#b4b47c'),
          (Math.sin(angle * 4.3 + edge * 3) + 1) * 0.5,
        );
        if (height < ROAD_Y + 12) grassy.lerp(new THREE.Color('#9a9d6c'), 0.3);
        color.copy(grassy).convertSRGBToLinear();
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let r = 0; r < rings; r += 1) {
      for (let s = 0; s < spokes; s += 1) {
        const next = (s + 1) % spokes;
        const a = r * spokes + s;
        const b = r * spokes + next;
        const c = (r + 1) * spokes + s;
        const d = (r + 1) * spokes + next;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.99,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const hills = new THREE.Mesh(geometry, material);
    hills.receiveShadow = true;
    hills.castShadow = true;
    this.group.add(hills);
  }
}
