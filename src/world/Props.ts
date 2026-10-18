import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TrackPath, ROAD_Y } from './TrackPath';
import {
  createCanvasTexture,
  createLampGlowTexture,
  createSignTexture,
  type RandomSource,
} from './ProceduralTextures';

export interface WindUniforms {
  time: { value: number };
  direction: { value: THREE.Vector2 };
  strength: { value: number };
  night: { value: number };
}

function addWindSway(
  material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial,
  uniforms: WindUniforms,
  swayScale: number,
  heightReference: number,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.time;
    shader.uniforms.uWindDirection = uniforms.direction;
    shader.uniforms.uWindStrength = uniforms.strength;
    shader.uniforms.uSwayScale = { value: swayScale };
    shader.uniforms.uHeightReference = { value: heightReference };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uWindDirection;
        uniform float uWindStrength;
        uniform float uSwayScale;
        uniform float uHeightReference;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 instanceOffset = instanceMatrix[3].xz;
        #else
          vec2 instanceOffset = vec2(0.0);
        #endif
        float swayHeight = smoothstep(0.05, uHeightReference, transformed.y);
        float swayPhase = dot(instanceOffset, vec2(0.13, 0.11));
        float swayWave = sin(uTime * 1.15 + swayPhase) * 0.62
          + sin(uTime * 2.4 + swayPhase * 1.9) * 0.25;
        float sway = swayHeight * swayWave * uWindStrength * uSwayScale;
        transformed.x += uWindDirection.x * sway;
        transformed.z += uWindDirection.y * sway;`,
      );
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => `wind-sway-${swayScale}-${heightReference}`;
}

function buildPalmFronds(rng: RandomSource): THREE.BufferGeometry {
  const frondGeometry = buildSingleFrond();
  const fronds: THREE.BufferGeometry[] = [];
  const count = 13;
  for (let i = 0; i < count; i += 1) {
    const clone = frondGeometry.clone();
    const angle = (i / count) * Math.PI * 2 + rng() * 0.22;
    const droop = 0.15 + rng() * 0.5;
    clone.rotateY(angle);
    clone.rotateZ(Math.sin(angle) * droop * 0.16);
    clone.scale(0.92 + rng() * 0.18, 0.88 + rng() * 0.26, 0.92 + rng() * 0.18);
    fronds.push(clone);
  }
  frondGeometry.dispose();
  const merged = mergeGeometries(fronds);
  fronds.forEach((geometry) => geometry.dispose());
  if (!merged) throw new Error('Could not merge palm fronds.');
  merged.translate(0.58, 6.15, 0.12);
  merged.computeVertexNormals();
  return merged;
}

function buildSingleFrond(): THREE.BufferGeometry {
  const segments = 11;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const x0 = t0 * 3.15;
    const y0 = Math.sin(t0 * Math.PI * 0.62) * 0.9 - t0 * t0 * 1.9;
    const x1 = t1 * 3.15;
    const y1 = Math.sin(t1 * Math.PI * 0.62) * 0.9 - t1 * t1 * 1.9;
    const width = Math.sin(Math.min(t0 * 1.15, 1) * Math.PI) * 0.76 + 0.04;
    for (const side of [-1, 1]) {
      const tipX = x0 + 0.6 * (1 - t0 * 0.3);
      const tipY = y0 - 0.16 - t0 * 0.34;
      const base = positions.length / 3;
      positions.push(x0, y0, 0, x1, y1, 0, tipX, tipY, side * width);
      indices.push(base, base + 1, base + 2);
      const innerX = x0 + 0.25;
      const innerY = y0 - 0.05;
      const innerBase = positions.length / 3;
      positions.push(x0, y0 + 0.02, 0, innerX, innerY, side * width * 0.5, x1, y1 + 0.02, 0);
      indices.push(innerBase, innerBase + 1, innerBase + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildPalmTrunk(): THREE.BufferGeometry {
  const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.15, 2, 0.05),
    new THREE.Vector3(0.18, 4.1, -0.1),
    new THREE.Vector3(0.55, 6.1, 0.12),
  ];
  const curve = new THREE.CatmullRomCurve3(points);
  const trunk = new THREE.TubeGeometry(curve, 12, 0.16, 6, false);
  const crown = new THREE.SphereGeometry(0.27, 6, 5);
  crown.translate(0.58, 6.15, 0.12);
  const coconuts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const coconut = new THREE.SphereGeometry(0.13, 6, 5);
    const angle = (i / 4) * Math.PI * 2;
    coconut.translate(0.58 + Math.cos(angle) * 0.22, 6.05, 0.12 + Math.sin(angle) * 0.22);
    coconuts.push(coconut);
  }
  const merged = mergeGeometries([trunk, crown, ...coconuts]);
  if (!merged) throw new Error('Could not merge palm trunk.');
  trunk.dispose();
  crown.dispose();
  coconuts.forEach((geometry) => geometry.dispose());
  return merged;
}

function buildCypress(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.18, 2.4, 6);
  trunk.translate(0, 1.2, 0);
  parts.push(trunk);
  const layers = [
    [1.8, 3.4, 1.15],
    [2.7, 4.0, 0.95],
    [3.6, 4.4, 0.72],
    [4.4, 4.2, 0.5],
    [5.1, 3.2, 0.28],
  ];
  for (const [y, height, radius] of layers) {
    const cone = new THREE.ConeGeometry(radius, height, 12, 1);
    cone.translate(0, y + height / 2, 0);
    parts.push(cone);
  }
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('Could not merge cypress.');
  parts.forEach((geometry) => geometry.dispose());
  return merged;
}

function buildGrassTufts(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const blade = new THREE.BufferGeometry();
    const angle = (i / 4) * Math.PI * 2;
    const leanX = Math.cos(angle) * 0.22;
    const leanZ = Math.sin(angle) * 0.22;
    const width = 0.045;
    const positions = [
      -width, 0, 0,
      width, 0, 0,
      leanX * 0.7 - width * 0.35, 0.34, leanZ * 0.7,
      leanX - width * 0.1, 0.62, leanZ,
      leanX, 0.72, leanZ,
    ];
    blade.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    blade.computeVertexNormals();
    blades.push(blade);
  }
  const merged = mergeGeometries(blades);
  if (!merged) throw new Error('Could not merge grass.');
  blades.forEach((geometry) => geometry.dispose());
  return merged;
}

function buildFlower(): THREE.BufferGeometry {
  const head = new THREE.IcosahedronGeometry(0.075, 0).toNonIndexed();
  head.translate(0, 0.26, 0);
  const stem = new THREE.CylinderGeometry(0.012, 0.018, 0.26, 4).toNonIndexed();
  stem.translate(0, 0.13, 0);
  const merged = mergeGeometries([stem, head]);
  if (!merged) throw new Error('Could not merge flower.');
  stem.dispose();
  head.dispose();
  return merged;
}

function createLighthouse(): {
  group: THREE.Group;
  beam: THREE.Group;
  lanternMaterial: THREE.MeshStandardMaterial;
} {
  const group = new THREE.Group();
  group.name = 'Lighthouse';
  const stone = new THREE.MeshStandardMaterial({ color: '#777169', roughness: 0.95, flatShading: true });
  const white = new THREE.MeshStandardMaterial({ color: '#f0e8d8', roughness: 0.55, metalness: 0.05 });
  const red = new THREE.MeshStandardMaterial({ color: '#b64f3d', roughness: 0.6, metalness: 0.04 });
  const metal = new THREE.MeshStandardMaterial({ color: '#3b4c4e', roughness: 0.34, metalness: 0.72 });

  const rockParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i += 1) {
    const rock = new THREE.DodecahedronGeometry(2.2 + i * 0.25, 0);
    const angle = (i / 9) * Math.PI * 2;
    rock.scale(1.3, 0.55, 1.0);
    rock.translate(Math.cos(angle) * (2.2 + i * 0.7), 0.7 + (i % 3) * 0.45, Math.sin(angle) * (2 + i * 0.6));
    rockParts.push(rock);
  }
  const rockMesh = new THREE.Mesh(mergeGeometries(rockParts) ?? rockParts[0], stone);
  rockParts.forEach((geometry) => geometry.dispose());
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  group.add(rockMesh);

  const towerProfile: THREE.Vector2[] = [
    new THREE.Vector2(2.55, 0),
    new THREE.Vector2(2.3, 4),
    new THREE.Vector2(2.0, 9),
    new THREE.Vector2(1.65, 14),
    new THREE.Vector2(1.45, 17.4),
  ];
  const tower = new THREE.Mesh(new THREE.LatheGeometry(towerProfile, 24), white);
  tower.position.y = 2.2;
  tower.castShadow = true;
  tower.receiveShadow = true;
  group.add(tower);

  for (const [y, height] of [
    [4.9, 1.1],
    [10.4, 0.9],
  ]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.26, 2.2, height, 24, 1, true), red);
    band.position.y = y;
    group.add(band);
  }

  const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 1.6, 20), stone);
  base.position.y = 1.9;
  base.castShadow = true;
  group.add(base);

  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.15, 0.35, 24), metal);
  gallery.position.y = 20.1;
  group.add(gallery);
  const railing = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.07, 6, 32), metal);
  railing.rotation.x = Math.PI / 2;
  railing.position.y = 21.2;
  group.add(railing);
  const railingPosts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.035, 0.035, 1.0, 4),
    metal,
    16,
  );
  const railingDummy = new THREE.Object3D();
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2;
    railingDummy.position.set(Math.cos(angle) * 2.05, 20.7, Math.sin(angle) * 2.05);
    railingDummy.updateMatrix();
    railingPosts.setMatrixAt(i, railingDummy.matrix);
  }
  railingPosts.instanceMatrix.needsUpdate = true;
  group.add(railingPosts);

  const lanternMaterial = new THREE.MeshStandardMaterial({
    color: '#f8e0a2',
    emissive: '#ffca6c',
    emissiveIntensity: 0.15,
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.92,
  });
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 2.2, 12, 1, true), lanternMaterial);
  lantern.position.y = 21.6;
  group.add(lantern);
  const mullions: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const mullion = new THREE.BoxGeometry(0.06, 2.2, 0.06);
    mullion.translate(Math.cos(angle) * 1.13, 21.6, Math.sin(angle) * 1.13);
    mullions.push(mullion);
  }
  group.add(new THREE.Mesh(mergeGeometries(mullions) ?? mullions[0], metal));
  mullions.forEach((geometry) => geometry.dispose());

  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.4, 16), red);
  roof.position.y = 23.4;
  roof.castShadow = true;
  group.add(roof);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), metal);
  finial.position.y = 24.2;
  group.add(finial);

  const beam = new THREE.Group();
  beam.position.y = 21.6;
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: '#ffe6a8',
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (const rotation of [0, Math.PI]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(5.5, 44, 18, 1, true), beamMaterial);
    cone.rotation.z = Math.PI / 2;
    cone.rotation.y = rotation;
    cone.position.x = 22;
    beam.add(cone);
  }
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createLampGlowTexture(),
      color: '#ffe3a4',
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.scale.setScalar(12);
  glow.position.y = 21.6;
  group.add(glow);
  group.add(beam);

  return { group, beam, lanternMaterial };
}

function createSailboat(rng: RandomSource): THREE.Group {
  const group = new THREE.Group();
  const hullMaterial = new THREE.MeshStandardMaterial({
    color: '#efe4cc',
    roughness: 0.45,
    metalness: 0.05,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: '#1f5e63',
    roughness: 0.4,
    metalness: 0.2,
  });
  const sailMaterial = new THREE.MeshStandardMaterial({
    color: '#f7ecd5',
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 3.4, 6, 10), hullMaterial);
  hull.rotation.z = Math.PI / 2;
  hull.scale.set(1, 1, 0.6);
  hull.position.y = 0.55;
  group.add(hull);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 1.28), trimMaterial);
  stripe.position.y = 0.78;
  group.add(stripe);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6.2, 6), trimMaterial);
  mast.position.set(-0.3, 3.8, 0);
  group.add(mast);

  const sailShape = new THREE.BufferGeometry();
  sailShape.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.22, 1.1, 0, -0.22, 6.5, 0, 2.35, 1.25, 0],
      3,
    ),
  );
  sailShape.setIndex([0, 1, 2]);
  sailShape.computeVertexNormals();
  const sail = new THREE.Mesh(sailShape, sailMaterial);
  sail.rotation.y = (rng() - 0.5) * 0.2;
  group.add(sail);
  const jibShape = new THREE.BufferGeometry();
  jibShape.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.28, 1.2, 0, 1.8, 1.2, 0, -0.3, 5.2, 0],
      3,
    ),
  );
  jibShape.setIndex([0, 1, 2]);
  jibShape.computeVertexNormals();
  group.add(new THREE.Mesh(jibShape, sailMaterial));
  group.scale.setScalar(0.8 + rng() * 0.7);
  return group;
}

function createGull(): { group: THREE.Group; leftWing: THREE.Group; rightWing: THREE.Group } {
  const group = new THREE.Group();
  const feather = new THREE.MeshStandardMaterial({
    color: '#f3efe4',
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: '#4b5a5a',
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), feather);
  body.scale.set(0.7, 0.6, 1.9);
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 5), feather);
  head.position.set(0, 0.11, 0.28);
  group.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.18, 5), dark);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.1, 0.45);
  group.add(beak);

  const makeWing = (side: number) => {
    const pivot = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, side * 0.86, 0.04, 0.06, side * 0.2, 0, -0.34],
        3,
      ),
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0.5, 0.5, 0, 0.5, 0.5, 0], 2));
    geometry.setIndex([0, 1, 2]);
    geometry.computeVertexNormals();
    const wing = new THREE.Mesh(geometry, feather);
    wing.scale.set(1, 1, 1);
    pivot.add(wing);
    group.add(pivot);
    return pivot;
  };
  return { group, leftWing: makeWing(1), rightWing: makeWing(-1) };
}

function createBench(): THREE.Group {
  const group = new THREE.Group();
  const woodMaterial = new THREE.MeshStandardMaterial({ color: '#a56d45', roughness: 0.8 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: '#394849', roughness: 0.5, metalness: 0.5 });
  const woodParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    const slat = new THREE.BoxGeometry(1.8, 0.08, 0.12);
    slat.translate(0, 0.52, -0.16 + i * 0.16);
    woodParts.push(slat);
  }
  const back = new THREE.BoxGeometry(1.8, 0.55, 0.08);
  back.rotateX(-0.14);
  back.translate(0, 0.92, -0.26);
  woodParts.push(back);
  const woodMerged = mergeGeometries(woodParts);
  woodParts.forEach((geometry) => geometry.dispose());
  if (!woodMerged) throw new Error('Could not merge bench wood.');
  const wood = new THREE.Mesh(woodMerged, woodMaterial);
  group.add(wood);

  const metalParts: THREE.BufferGeometry[] = [];
  for (const x of [-0.75, 0.75]) {
    const leg = new THREE.BoxGeometry(0.09, 0.5, 0.55);
    leg.translate(x, 0.25, 0);
    metalParts.push(leg);
  }
  const metalMerged = mergeGeometries(metalParts);
  metalParts.forEach((geometry) => geometry.dispose());
  if (!metalMerged) throw new Error('Could not merge bench metal.');
  group.add(new THREE.Mesh(metalMerged, metalMaterial));
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return group;
}

function createWindsock(): { group: THREE.Group; sock: THREE.Group } {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#cfc7b4', roughness: 0.35, metalness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 5.4, 6), metal);
  pole.position.y = 2.7;
  pole.castShadow = true;
  group.add(pole);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.055, 6, 16), metal);
  collar.position.set(0, 5.15, 0);
  collar.rotation.y = Math.PI / 2;
  group.add(collar);

  const stripeTexture = createCanvasTexture(256, 64, (context, width, height) => {
    const colors = ['#ff6b4a', '#f4ead6', '#ff6b4a', '#f4ead6', '#ff6b4a', '#f4ead6'];
    const stripe = width / colors.length;
    colors.forEach((color, index) => {
      context.fillStyle = color;
      context.fillRect(index * stripe, 0, stripe + 1, height);
    });
  });
  stripeTexture.wrapS = THREE.RepeatWrapping;
  const sockMaterial = new THREE.MeshStandardMaterial({
    map: stripeTexture,
    side: THREE.DoubleSide,
    roughness: 0.82,
  });
  const sock = new THREE.Group();
  sock.position.set(0, 5.15, 0);
  for (let i = 0; i < 3; i += 1) {
    const segment = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2 - i * 0.015, 0.27 - i * 0.03, 0.68, 12, 1, true),
      sockMaterial,
    );
    segment.rotation.z = Math.PI / 2;
    segment.position.x = 0.34 + i * 0.68;
    sock.add(segment);
  }
  group.add(sock);
  return { group, sock };
}

function createDirectionSign(texture: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const postMaterial = new THREE.MeshStandardMaterial({ color: '#57615d', roughness: 0.7, metalness: 0.25 });
  const postParts: THREE.BufferGeometry[] = [];
  for (const x of [-0.65, 0.65]) {
    const post = new THREE.CylinderGeometry(0.055, 0.065, 2.4, 6);
    post.translate(x, 1.2, 0);
    postParts.push(post);
  }
  const postMerged = mergeGeometries(postParts);
  postParts.forEach((geometry) => geometry.dispose());
  if (postMerged) {
    const postsMesh = new THREE.Mesh(postMerged, postMaterial);
    postsMesh.castShadow = true;
    group.add(postsMesh);
  }
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 1.0, 0.08),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0.08 }),
  );
  panel.position.y = 2.35;
  panel.castShadow = true;
  group.add(panel);
  return group;
}

export class Props {
  readonly group = new THREE.Group();
  private readonly windUniforms: WindUniforms = {
    time: { value: 0 },
    direction: { value: new THREE.Vector2(0.72, 0.69) },
    strength: { value: 0.5 },
    night: { value: 0 },
  };
  private readonly lighthouse: ReturnType<typeof createLighthouse>;
  private readonly lighthouseBeam: THREE.Group;
  private readonly lanternMaterial: THREE.MeshStandardMaterial;
  private readonly boats: THREE.Group[] = [];
  private readonly gulls: ReturnType<typeof createGull>[] = [];
  private readonly flags: THREE.Mesh[] = [];
  private readonly flagUniforms = {
    uTime: { value: 0 },
    uStrength: { value: 1 },
    uWindDirection: { value: new THREE.Vector2(0.72, 0.69) },
  };
  private readonly windsock: ReturnType<typeof createWindsock>;
  private readonly lampGlows: THREE.Sprite[] = [];
  private readonly windmill: THREE.Group;
  private readonly windmillHub: THREE.Group;

  constructor(
    private readonly path: TrackPath,
    private readonly rng: RandomSource,
    private readonly archTexture: THREE.Texture,
  ) {
    this.group.name = 'CoastalProps';
    this.buildPalms();
    this.buildCypresses();
    this.buildGrass();
    this.buildFlowers();
    this.buildRocks();
    this.buildLamps();
    this.buildSigns();
    this.buildStartArch();
    this.buildMilestones();
    this.buildBenches();
    this.windsock = createWindsock();
    this.placeAtDistance(this.windsock.group, 28, 5.4, 0.02);
    this.group.add(this.windsock.group);

    this.lighthouse = createLighthouse();
    const frame = this.path.frameAt(84);
    this.lighthouse.group.position
      .copy(frame.position)
      .addScaledVector(frame.right, 66);
    this.lighthouse.group.position.y = 1.2;
    this.lighthouseBeam = this.lighthouse.beam;
    this.lanternMaterial = this.lighthouse.lanternMaterial;
    this.group.add(this.lighthouse.group);

    this.buildBoats();
    this.buildGulls();
    this.buildIslands();
    const windmill = this.buildWindmill();
    this.windmill = windmill.group;
    this.windmillHub = windmill.hub;
    this.group.add(this.windmill);
  }

  update(
    delta: number,
    elapsed: number,
    windSpeed: number,
    windDirection: THREE.Vector2,
    night: number,
    storm: number,
  ): void {
    this.windUniforms.time.value = elapsed;
    this.windUniforms.strength.value = THREE.MathUtils.clamp(windSpeed / 16, 0.12, 1.3);
    this.windUniforms.direction.value.copy(windDirection);
    this.windUniforms.night.value = night;
    this.flagUniforms.uTime.value = elapsed;
    this.flagUniforms.uStrength.value = THREE.MathUtils.clamp(windSpeed / 12, 0.2, 1.4);
    this.flagUniforms.uWindDirection.value.copy(windDirection);
    this.lighthouseBeam.rotation.y += delta * 0.42;
    this.lighthouseBeam.visible = night > 0.04;
    this.lanternMaterial.emissiveIntensity = 0.08 + night * 2.4;
    this.lighthouse.group.traverse((child) => {
      if (child instanceof THREE.Sprite) {
        child.material.opacity = night * 0.84;
      }
    });
    this.lighthouseBeam.children.forEach((child) => {
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (material && 'opacity' in material) material.opacity = night * 0.22;
    });

    for (let i = 0; i < this.lampGlows.length; i += 1) {
      this.lampGlows[i].material.opacity = night * (0.5 + Math.sin(elapsed * 3 + i) * 0.04);
    }

    const sockDirection = Math.atan2(-windDirection.y, windDirection.x);
    this.windsock.sock.rotation.y = sockDirection;
    const sockLift = THREE.MathUtils.smoothstep(windSpeed, 2, 14);
    this.windsock.sock.rotation.z = THREE.MathUtils.lerp(-0.82, 0.04, sockLift);
    this.windsock.sock.rotation.x = Math.sin(elapsed * 3.4) * 0.05 * (0.4 + sockLift);

    for (let i = 0; i < this.boats.length; i += 1) {
      const boat = this.boats[i];
      boat.position.y = Math.sin(elapsed * 0.7 + i * 1.8) * 0.22 - 0.05;
      boat.rotation.z = Math.sin(elapsed * 0.55 + i) * 0.045;
      boat.rotation.x = Math.sin(elapsed * 0.43 + i * 2.2) * 0.03;
    }

    for (let i = 0; i < this.gulls.length; i += 1) {
      const gull = this.gulls[i];
      const phase = elapsed * (0.16 + i * 0.012) + i * 1.4;
      const anchor = gull.group.userData.anchorDistance as number;
      const frame = this.path.frameAt(anchor + elapsed * 1.5);
      const radius = 9 + i * 1.8;
      gull.group.position
        .copy(frame.position)
        .addScaledVector(frame.right, 6 + Math.cos(phase) * radius)
        .addScaledVector(frame.tangent, Math.sin(phase) * radius * 0.5);
      gull.group.position.y += 13 + Math.sin(phase * 1.7) * 3 + i * 1.6;
      gull.group.rotation.y = frame.yaw - phase + Math.PI * 0.5;
      const flap = Math.sin(elapsed * (5 + i * 0.25) + i) * 0.55;
      gull.leftWing.rotation.z = flap;
      gull.rightWing.rotation.z = -flap;
    }

    this.windmillHub.rotation.z += delta * (0.6 + windSpeed * 0.16);
    if (this.lampHeadsMaterial) {
      this.lampHeadsMaterial.emissiveIntensity = 0.1 + night * 2.1;
    }
    void storm;
  }

  private placeAtDistance(
    object: THREE.Object3D,
    distance: number,
    lateral: number,
    heightOffset = 0,
  ): TrackFrameTransform {
    const frame = this.path.frameAt(distance);
    object.position.copy(frame.position).addScaledVector(frame.right, lateral);
    object.position.y += heightOffset;
    object.rotation.y = frame.yaw;
    return object;
  }

  private buildPalms(): void {
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: '#8c6a49',
      roughness: 0.9,
      metalness: 0,
    });
    addWindSway(trunkMaterial, this.windUniforms, 0.12, 6);
    const frondMaterial = new THREE.MeshStandardMaterial({
      color: '#5d854f',
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    addWindSway(frondMaterial, this.windUniforms, 0.9, 6);

    const trunkGeometry = buildPalmTrunk();
    const frondGeometry = buildPalmFronds(this.rng);
    const count = 26;
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
    const fronds = new THREE.InstancedMesh(frondGeometry, frondMaterial, count);
    trunks.castShadow = true;
    trunks.receiveShadow = true;
    fronds.castShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
      const distance = (i / count) * this.path.length + this.rng() * 8;
      const frame = this.path.frameAt(distance);
      const lateral = 5.9 + this.rng() * 2.6;
      dummy.position.copy(frame.position).addScaledVector(frame.right, lateral);
      dummy.position.y = ROAD_Y - 0.65 + this.rng() * 0.35;
      dummy.rotation.set(0, frame.yaw + this.rng() * Math.PI * 2, 0);
      const scale = 0.78 + this.rng() * 0.48;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      fronds.setMatrixAt(i, dummy.matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    fronds.instanceMatrix.needsUpdate = true;
    this.group.add(trunks, fronds);
  }

  private buildCypresses(): void {
    const material = new THREE.MeshStandardMaterial({
      color: '#45614e',
      roughness: 0.9,
    });
    addWindSway(material, this.windUniforms, 0.2, 7);
    const geometry = buildCypress();
    const count = 34;
    const trees = new THREE.InstancedMesh(geometry, material, count);
    trees.castShadow = true;
    trees.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
      const distance = (i / count) * this.path.length + this.rng() * 14;
      const frame = this.path.frameAt(distance);
      const lateral = -8 - this.rng() * 22;
      dummy.position.copy(frame.position).addScaledVector(frame.right, lateral);
      dummy.position.y = ROAD_Y + 2 + this.rng() * 5;
      dummy.rotation.y = this.rng() * Math.PI * 2;
      dummy.scale.set(0.8 + this.rng() * 0.7, 0.8 + this.rng() * 0.9, 0.8 + this.rng() * 0.7);
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);
    }
    trees.instanceMatrix.needsUpdate = true;
    this.group.add(trees);
  }

  private buildGrass(): void {
    const material = new THREE.MeshStandardMaterial({
      color: '#b9b661',
      roughness: 0.95,
      side: THREE.DoubleSide,
      vertexColors: false,
    });
    addWindSway(material, this.windUniforms, 0.55, 0.5);
    const geometry = buildGrassTufts();
    const count = 2200;
    const grass = new THREE.InstancedMesh(geometry, material, count);
    grass.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      const distance = this.rng() * this.path.length;
      const frame = this.path.frameAt(distance);
      const inland = this.rng() < 0.76;
      const lateral = inland
        ? -(5.0 + this.rng() * 8.5)
        : 5.1 + this.rng() * 2.0;
      dummy.position.copy(frame.position).addScaledVector(frame.right, lateral);
      dummy.position.y = ROAD_Y + (inland ? 0.1 + this.rng() * 0.45 : -0.1 + this.rng() * 0.15);
      dummy.rotation.y = this.rng() * Math.PI * 2;
      const scale = 0.65 + this.rng() * 1.15;
      dummy.scale.set(scale, scale * (0.75 + this.rng() * 0.7), scale);
      dummy.updateMatrix();
      grass.setMatrixAt(i, dummy.matrix);
      const shade = 0.72 + this.rng() * 0.35;
      color.setRGB(shade * 0.7, shade * 0.73, shade * 0.32);
      grass.setColorAt(i, color);
    }
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    this.group.add(grass);
  }

  private buildFlowers(): void {
    const geometry = buildFlower();
    const material = new THREE.MeshStandardMaterial({
      color: '#f2d488',
      roughness: 0.7,
      emissive: '#5a2910',
      emissiveIntensity: 0.08,
    });
    addWindSway(material, this.windUniforms, 0.35, 0.5);
    const count = 620;
    const flowers = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const palette = ['#f2b94e', '#f07a5c', '#f5d9b0', '#d8a6c8', '#f3e3b8'];
    for (let i = 0; i < count; i += 1) {
      const distance = this.rng() * this.path.length;
      const frame = this.path.frameAt(distance);
      const lateral = -(5.2 + this.rng() * 6.5);
      dummy.position.copy(frame.position).addScaledVector(frame.right, lateral);
      dummy.position.y = ROAD_Y + 0.15 + this.rng() * 0.45;
      dummy.rotation.y = this.rng() * Math.PI * 2;
      dummy.scale.setScalar(0.65 + this.rng() * 0.9);
      dummy.updateMatrix();
      flowers.setMatrixAt(i, dummy.matrix);
      color.setStyle(palette[Math.floor(this.rng() * palette.length)]);
      flowers.setColorAt(i, color);
    }
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    this.group.add(flowers);
  }

  private buildRocks(): void {
    const geometry = new THREE.DodecahedronGeometry(0.5, 0);
    const material = new THREE.MeshStandardMaterial({
      color: '#938d7d',
      roughness: 0.92,
    });
    addWindSway(material, this.windUniforms, 0.02, 1);
    const count = 140;
    const rocks = new THREE.InstancedMesh(geometry, material, count);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      const distance = this.rng() * this.path.length;
      const frame = this.path.frameAt(distance);
      const seaward = this.rng() < 0.55;
      const lateral = seaward ? 5.4 + this.rng() * 6 : -(5.6 + this.rng() * 12);
      dummy.position.copy(frame.position).addScaledVector(frame.right, lateral);
      dummy.position.y = ROAD_Y + (seaward ? -0.45 : 0.1) + this.rng() * 0.3;
      dummy.rotation.set(this.rng() * Math.PI, this.rng() * Math.PI, this.rng() * Math.PI);
      const scale = 0.3 + this.rng() * 1.5;
      dummy.scale.set(scale * 1.2, scale * (0.5 + this.rng() * 0.6), scale);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      const shade = 0.7 + this.rng() * 0.3;
      color.setRGB(shade * 0.68, shade * 0.66, shade * 0.58);
      rocks.setColorAt(i, color);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    this.group.add(rocks);
  }

  private buildLamps(): void {
    const poleMaterial = new THREE.MeshStandardMaterial({
      color: '#3f5354',
      roughness: 0.44,
      metalness: 0.62,
    });
    const poleGeometry = mergeGeometries([
      (() => {
        const cylinder = new THREE.CylinderGeometry(0.06, 0.12, 4.6, 8);
        cylinder.translate(0, 2.3, 0);
        return cylinder;
      })(),
      (() => {
        const arm = new THREE.BoxGeometry(0.85, 0.08, 0.08);
        arm.translate(-0.38, 4.55, 0);
        return arm;
      })(),
    ]);
    if (!poleGeometry) throw new Error('Could not merge lamp geometry.');
    const lampHeadGeometry = new THREE.BoxGeometry(0.36, 0.16, 0.3);
    const lampHeadMaterial = new THREE.MeshStandardMaterial({
      color: '#f6dda3',
      emissive: '#ffc46d',
      emissiveIntensity: 0.1,
      roughness: 0.35,
    });
    const count = 8;
    const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, count);
    poles.castShadow = true;
    const heads = new THREE.InstancedMesh(lampHeadGeometry, lampHeadMaterial, count);
    const glowTexture = createLampGlowTexture();
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
      const distance = (i / count) * this.path.length + 12;
      const frame = this.path.frameAt(distance);
      dummy.position.copy(frame.position).addScaledVector(frame.right, 5.15);
      dummy.position.y = ROAD_Y;
      dummy.rotation.set(0, frame.yaw, 0);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      dummy.position.copy(frame.position)
        .addScaledVector(frame.right, 5.15)
        .addScaledVector(frame.tangent, 0.36);
      dummy.position.y = ROAD_Y + 4.62;
      dummy.rotation.set(0, frame.yaw, 0);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture,
          color: '#ffcf87',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      glow.position.copy(dummy.position);
      glow.scale.setScalar(1.7);
      this.lampGlows.push(glow);
      this.group.add(glow);
    }
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    this.group.add(poles, heads);
    this.lampHeadsMaterial = lampHeadMaterial;
  }

  private lampHeadsMaterial: THREE.MeshStandardMaterial | null = null;

  private buildSigns(): void {
    const signSpecs: Array<{
      texture: THREE.Texture;
      distance: number;
      side: 'sea' | 'land';
      lateral: number;
    }> = [
      {
        texture: createSignTexture('Pelican Coast', '海岸公路 · 2 圈', '#ff6b4a'),
        distance: 52,
        side: 'sea',
        lateral: 4.6,
      },
      {
        texture: createSignTexture('Crosswind', '注意侧风 · 抓稳车把', '#f2b94e'),
        distance: 240,
        side: 'sea',
        lateral: 4.6,
      },
      {
        texture: createSignTexture('Lighthouse', '灯塔观景台 · 0.6 km', '#57c7b8'),
        distance: 455,
        side: 'land',
        lateral: -4.6,
      },
      {
        texture: createSignTexture('Picnic Bay', '野餐湾 · 减速慢行', '#ff6b4a'),
        distance: 620,
        side: 'sea',
        lateral: 4.6,
      },
    ];
    for (const spec of signSpecs) {
      const sign = createDirectionSign(spec.texture);
      const frame = this.path.frameAt(spec.distance);
      sign.position.copy(frame.position).addScaledVector(frame.right, spec.lateral);
      sign.position.y = ROAD_Y;
      const isSea = spec.side === 'sea';
      sign.rotation.y = isSea ? frame.yaw - Math.PI / 2 : frame.yaw + Math.PI / 2;
      this.group.add(sign);
    }
  }

  private buildStartArch(): void {
    const frame = this.path.frameAt(0);
    const group = new THREE.Group();
    group.name = 'StartArch';
    const postMaterial = new THREE.MeshStandardMaterial({
      color: '#234f51',
      roughness: 0.52,
      metalness: 0.35,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: '#f1e5cd',
      roughness: 0.55,
      metalness: 0.12,
    });
    const positions: Array<[number, number, number]> = [
      [-5.4, ROAD_Y + 3.3, 0],
      [5.4, ROAD_Y + 3.3, 0],
    ];
    for (const [lateral, height] of positions) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.6, 0.5), postMaterial);
      post.position.copy(frame.position).addScaledVector(frame.right, lateral);
      post.position.y = height;
      post.rotation.y = frame.yaw;
      post.castShadow = true;
      group.add(post);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.62), trimMaterial);
      trim.position.copy(post.position);
      trim.position.y = ROAD_Y + 6.55;
      trim.rotation.y = frame.yaw;
      group.add(trim);
    }

    const beamPosition = frame.position.clone().add(new THREE.Vector3(0, 6.4, 0));
    const beam = new THREE.Mesh(new THREE.BoxGeometry(11.4, 1.1, 0.55), postMaterial);
    beam.position.copy(beamPosition);
    beam.rotation.y = frame.yaw;
    beam.castShadow = true;
    group.add(beam);

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(8.8, 1.3),
      new THREE.MeshStandardMaterial({
        map: this.archTexture,
        roughness: 0.6,
        side: THREE.DoubleSide,
        emissive: '#4c2f19',
        emissiveIntensity: 0.16,
      }),
    );
    banner.position.copy(beamPosition).add(new THREE.Vector3(0, 0.15, 0));
    banner.rotation.y = frame.yaw;
    banner.translateZ(0.31);
    group.add(banner);

    const flagTexture = createCanvasTexture(128, 128, (context, width, height) => {
      const colors = ['#ff6b4a', '#f4ead6', '#234f51'];
      for (let i = 0; i < 6; i += 1) {
        context.fillStyle = colors[i % colors.length];
        context.fillRect((i % 2) * (width / 2), Math.floor(i / 2) * (height / 3), width / 2, height / 3);
      }
    });
    const flagMaterial = new THREE.MeshStandardMaterial({
      map: flagTexture,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
    flagMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uFlagTime = this.flagUniforms.uTime;
      shader.uniforms.uFlagStrength = this.flagUniforms.uStrength;
      shader.uniforms.uFlagWindDirection = this.flagUniforms.uWindDirection;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uFlagTime;
          uniform float uFlagStrength;
          uniform vec2 uFlagWindDirection;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float flagU = clamp((position.x + 0.85) / 1.7, 0.0, 1.0);
          float flagWave = sin(flagU * 7.5 - uFlagTime * 5.2) * 0.13
            + sin(flagU * 13.0 - uFlagTime * 8.1 + position.y * 3.0) * 0.045;
          transformed.z += flagWave * flagU * (0.35 + uFlagStrength);
          transformed.x -= abs(flagWave) * flagU * 0.05;
          transformed.z += uFlagWindDirection.y * 0.01;`,
        );
    };
    flagMaterial.customProgramCacheKey = () => 'flag-wave-v1';
    for (const side of [-1, 1]) {
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.1, 12, 4), flagMaterial);
      flag.position.copy(beamPosition).add(new THREE.Vector3(side * 4.3, 1.1, 0));
      flag.rotation.y = frame.yaw;
      flag.userData.basePosition = flag.position.clone();
      this.flags.push(flag);
      group.add(flag);
    }
    const startLineTexture = createCanvasTexture(256, 64, (context, width, height) => {
      const cell = 16;
      for (let y = 0; y < height / cell; y += 1) {
        for (let x = 0; x < width / cell; x += 1) {
          context.fillStyle = (x + y) % 2 === 0 ? '#efe4cc' : '#1d3f42';
          context.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    });
    const startLine = new THREE.Mesh(
      new THREE.PlaneGeometry(7.1, 1.3),
      new THREE.MeshBasicMaterial({
        map: startLineTexture,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    const startFrame = this.path.frameAt(0.4);
    startLine.position.copy(startFrame.position).add(new THREE.Vector3(0, 0.03, 0));
    startLine.rotation.order = 'YXZ';
    startLine.rotation.y = startFrame.yaw;
    startLine.rotation.x = -Math.PI / 2;
    this.group.add(startLine);

    this.group.add(group);
  }

  private buildMilestones(): void {
    const count = 10;
    const postGeometry = new THREE.BoxGeometry(0.16, 0.9, 0.16);
    const postMaterial = new THREE.MeshStandardMaterial({ color: '#f1e5cd', roughness: 0.6 });
    const capGeometry = new THREE.BoxGeometry(0.28, 0.24, 0.24);
    const capMaterial = new THREE.MeshStandardMaterial({ color: '#234f51', roughness: 0.5 });
    const posts = new THREE.InstancedMesh(postGeometry, postMaterial, count);
    const caps = new THREE.InstancedMesh(capGeometry, capMaterial, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
      const frame = this.path.frameAt((i / count) * this.path.length + 70);
      dummy.position.copy(frame.position).addScaledVector(frame.right, -TEAM_LATERAL);
      dummy.position.y = ROAD_Y + 0.45;
      dummy.rotation.y = frame.yaw;
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
      dummy.position.y = ROAD_Y + 0.98;
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
    }
    posts.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    this.group.add(posts, caps);
  }

  private buildBenches(): void {
    for (const [distance, lateral] of [
      [120, -7.2],
      [370, -8.4],
      [560, -7.5],
    ] as const) {
      const bench = createBench();
      const frame = this.path.frameAt(distance);
      bench.position.copy(frame.position).addScaledVector(frame.right, lateral);
      bench.position.y = ROAD_Y + 0.6;
      bench.rotation.y = frame.yaw + Math.PI / 2;
      this.group.add(bench);
    }
  }

  private buildBoats(): void {
    const specs = [
      [150, 120, 190],
      [215, 260, 330],
      [95, 500, 260],
    ] as const;
    for (let i = 0; i < specs.length; i += 1) {
      const [angleDeg, radius, distance] = specs[i];
      const boat = createSailboat(this.rng);
      const angle = (angleDeg * Math.PI) / 180;
      boat.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      boat.rotation.y = -angle + 0.8;
      boat.userData.distance = distance;
      this.boats.push(boat);
      this.group.add(boat);
    }
  }

  private buildGulls(): void {
    for (let i = 0; i < 3; i += 1) {
      const gull = createGull();
      gull.group.scale.setScalar(0.9 + this.rng() * 0.55);
      gull.group.userData.anchorDistance = (i / 3) * this.path.length + 30;
      this.gulls.push(gull);
      this.group.add(gull.group);
    }
  }

  private buildIslands(): void {
    const material = new THREE.MeshStandardMaterial({
      color: '#66796f',
      roughness: 1,
      flatShading: true,
    });
    const specs: Array<[number, number, number, number]> = [
      [220, 730, 1.7, 0.45],
      [280, 910, 2.3, 0.34],
      [330, 640, 1.2, 0.5],
      [120, 1040, 2.8, 0.28],
      [400, 830, 1.5, 0.4],
    ];
    for (const [angleDeg, radius, scale, heightScale] of specs) {
      const island = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), material);
      const angle = (angleDeg * Math.PI) / 180;
      island.position.set(Math.cos(angle) * radius, -2, Math.sin(angle) * radius);
      island.scale.set(scale * 70, scale * 22 * heightScale, scale * 50);
      island.rotation.y = this.rng() * Math.PI;
      this.group.add(island);
    }
  }

  private buildWindmill(): { group: THREE.Group; hub: THREE.Group } {
    const group = new THREE.Group();
    const frame = this.path.frameAt(430);
    group.position.copy(frame.position).addScaledVector(frame.right, -44);
    group.position.y = ROAD_Y + 9;
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.55, 8, 6),
      new THREE.MeshStandardMaterial({ color: '#cdbfa5', roughness: 0.8 }),
    );
    mast.position.y = 4;
    group.add(mast);
    const hub = new THREE.Group();
    hub.position.set(0, 8.2, 0.7);
    for (let i = 0; i < 4; i += 1) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 2.6, 0.06),
        new THREE.MeshStandardMaterial({ color: '#f0e5cd', roughness: 0.7 }),
      );
      blade.position.y = 1.3;
      const pivot = new THREE.Group();
      pivot.rotation.z = (i / 4) * Math.PI * 2;
      pivot.add(blade);
      hub.add(pivot);
    }
    group.add(hub);
    group.children.forEach((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });
    return { group, hub };
  }
}

const TEAM_LATERAL = 5.9;

// Local alias keeps the transform helper readable without importing the type.
type TrackFrameTransform = THREE.Object3D;
