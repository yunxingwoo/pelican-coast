import * as THREE from 'three';
import type { RandomSource } from '../world/ProceduralTextures';
import { createSoftCircleTexture } from '../world/ProceduralTextures';
import { TrackPath, ROAD_Y } from '../world/TrackPath';

export type HazardKind = 'driftwood' | 'rocks' | 'crab';

const SOFT_GLOW = createSoftCircleTexture(
  'rgba(255, 226, 150, 0.95)',
  'rgba(255, 192, 80, 0)',
);

function buildStarfish(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const points = 5;
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? 0.4 : 0.16;
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.045,
    bevelThickness: 0.04,
    curveSegments: 2,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0.08, 0);
  return geometry;
}

const STARFISH_GEOMETRY = buildStarfish();

export class ShellItem {
  readonly group = new THREE.Group();
  readonly distance: number;
  private readonly bobOffset: number;
  readonly lateral: number;
  active = true;
  collected = false;
  collectTime = 0;
  private readonly baseY: number;

  constructor(
    private readonly path: TrackPath,
    distance: number,
    lateral: number,
    rng: RandomSource,
  ) {
    this.distance = distance;
    this.lateral = lateral;
    this.bobOffset = rng() * Math.PI * 2;
    this.baseY = ROAD_Y + 0.72;
    this.group.name = 'Shell';
    const material = new THREE.MeshStandardMaterial({
      color: '#f4c96a',
      roughness: 0.32,
      metalness: 0.42,
      emissive: '#8c4c12',
      emissiveIntensity: 0.42,
    });
    const shell = new THREE.Mesh(STARFISH_GEOMETRY, material);
    shell.castShadow = true;
    this.group.add(shell);

    const pearl = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshStandardMaterial({
        color: '#fff4dc',
        roughness: 0.18,
        metalness: 0.1,
        emissive: '#fff1cc',
        emissiveIntensity: 0.7,
      }),
    );
    pearl.position.y = 0.22;
    this.group.add(pearl);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.58, 0.018, 5, 32),
      new THREE.MeshBasicMaterial({
        color: '#ffe1a0',
        transparent: true,
        opacity: 0.64,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    this.group.add(ring);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: SOFT_GLOW,
        color: '#ffd88a',
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.scale.setScalar(1.65);
    glow.position.y = 0.15;
    this.group.add(glow);
    this.group.position
      .copy(path.frameAt(distance).position)
      .addScaledVector(path.frameAt(distance).right, lateral);
    this.group.position.y = this.baseY;
  }

  update(delta: number, elapsed: number, night: number): void {
    if (!this.active) {
      this.collectTime += delta;
      this.group.position.y += delta * 1.4;
      this.group.scale.multiplyScalar(Math.max(0.01, 1 - delta * 2.4));
      this.group.rotation.y += delta * 6;
      if (this.collectTime > 0.6) this.group.visible = false;
      return;
    }
    this.group.position.y = this.baseY + Math.sin(elapsed * 1.8 + this.bobOffset) * 0.12;
    this.group.rotation.y += delta * 1.35;
    const glow = this.group.children[3] as THREE.Sprite | undefined;
    if (glow) glow.material.opacity = 0.26 + night * 0.22 + Math.sin(elapsed * 3 + this.bobOffset) * 0.06;
  }

  collect(): void {
    this.active = false;
    this.collected = true;
  }

  respawn(): void {
    this.active = true;
    this.collected = false;
    this.collectTime = 0;
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.group.rotation.set(0, 0, 0);
    const frame = this.path.frameAt(this.distance);
    this.group.position.copy(frame.position).addScaledVector(frame.right, this.lateral);
    this.group.position.y = this.baseY;
  }
}

export class Hazard {
  readonly group = new THREE.Group();
  readonly kind: HazardKind;
  readonly radius: number;
  readonly distance: number;
  readonly baseLateral: number;
  lateral: number;
  private readonly phase: number;
  private readonly path: TrackPath;

  constructor(
    path: TrackPath,
    kind: HazardKind,
    distance: number,
    lateral: number,
    rng: RandomSource,
  ) {
    this.path = path;
    this.kind = kind;
    this.distance = distance;
    this.baseLateral = lateral;
    this.lateral = lateral;
    this.phase = rng() * Math.PI * 2;
    this.group.name = `Hazard-${kind}`;
    this.radius = kind === 'driftwood' ? 0.85 : kind === 'rocks' ? 0.95 : 0.62;
    const frame = path.frameAt(distance);
    this.group.position.copy(frame.position).addScaledVector(frame.right, lateral);
    this.group.rotation.y = frame.yaw;

    if (kind === 'driftwood') {
      this.buildDriftwood(rng);
      this.group.position.y = ROAD_Y + 0.16;
      this.group.rotation.y = frame.yaw + (rng() - 0.5) * 0.5;
    } else if (kind === 'rocks') {
      this.buildRocks(rng);
      this.group.position.y = ROAD_Y + 0.1;
    } else {
      this.buildCrab(rng);
      this.group.position.y = ROAD_Y + 0.16;
      this.group.rotation.y = frame.yaw + Math.PI / 2;
    }
  }

  update(delta: number, elapsed: number): void {
    if (this.kind === 'crab') {
      const frame = this.path.frameAt(this.distance);
      this.lateral = this.baseLateral + Math.sin(elapsed * 0.72 + this.phase) * 1.1;
      this.group.position.copy(frame.position).addScaledVector(frame.right, this.lateral);
      this.group.position.y = ROAD_Y + 0.16 + Math.abs(Math.sin(elapsed * 8 + this.phase)) * 0.035;
      this.group.rotation.y = frame.yaw + Math.PI / 2 + Math.sin(elapsed * 0.72 + this.phase) * 0.2;
      this.group.children.forEach((child, index) => {
        if (child.userData.leg) {
          child.rotation.z = Math.sin(elapsed * 9 + index) * 0.3;
        }
        if (child.userData.claw) {
          child.rotation.y = Math.sin(elapsed * 5 + index) * 0.22;
        }
      });
    } else if (this.kind === 'driftwood') {
      this.group.rotation.z = Math.sin(elapsed * 1.1 + this.phase) * 0.008;
    }
    void delta;
  }

  private buildDriftwood(rng: RandomSource): void {
    const wood = new THREE.MeshStandardMaterial({
      color: '#86705a',
      roughness: 0.92,
      flatShading: true,
    });
    const branchMaterial = new THREE.MeshStandardMaterial({
      color: '#6d5a48',
      roughness: 0.95,
      flatShading: true,
    });
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 2.05, 7), wood);
    log.rotation.z = Math.PI / 2;
    log.rotation.x = 0.05;
    log.castShadow = true;
    log.receiveShadow = true;
    this.group.add(log);
    for (let i = 0; i < 3; i += 1) {
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.07, 0.75, 5),
        branchMaterial,
      );
      branch.position.set(-0.5 + i * 0.55, 0.14, (i % 2 === 0 ? 0.14 : -0.12));
      branch.rotation.z = Math.PI / 2 + (rng() - 0.5) * 0.8;
      branch.rotation.y = (rng() - 0.5) * 1.2;
      branch.castShadow = true;
      this.group.add(branch);
    }
    for (let i = 0; i < 5; i += 1) {
      const chip = new THREE.Mesh(new THREE.DodecahedronGeometry(0.09, 0), branchMaterial);
      chip.position.set((rng() - 0.5) * 2.4, 0.03, (rng() - 0.5) * 0.7);
      chip.scale.y = 0.4;
      this.group.add(chip);
    }
  }

  private buildRocks(rng: RandomSource): void {
    const material = new THREE.MeshStandardMaterial({
      color: '#8d897c',
      roughness: 0.96,
      flatShading: true,
    });
    const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 0), material);
    boulder.scale.set(1.25, 0.8, 1);
    boulder.castShadow = true;
    boulder.receiveShadow = true;
    this.group.add(boulder);
    for (let i = 0; i < 4; i += 1) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + rng() * 0.18, 0), material);
      const angle = rng() * Math.PI * 2;
      rock.position.set(Math.cos(angle) * 0.7, 0.08, Math.sin(angle) * 0.45);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.castShadow = true;
      this.group.add(rock);
    }
  }

  private buildCrab(rng: RandomSource): void {
    const shell = new THREE.MeshStandardMaterial({
      color: '#cf5a3d',
      roughness: 0.55,
      metalness: 0.08,
      emissive: '#5c1a0c',
      emissiveIntensity: 0.2,
    });
    const dark = new THREE.MeshStandardMaterial({ color: '#7c2f1f', roughness: 0.65 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 7), shell);
    body.scale.set(1.2, 0.55, 0.95);
    body.castShadow = true;
    this.group.add(body);
    for (const side of [-1, 1]) {
      const claw = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.32, 5), dark);
      arm.rotation.z = Math.PI / 2;
      arm.position.x = side * 0.36;
      const pincer = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 5), shell);
      pincer.rotation.z = side * -1.3;
      pincer.position.set(side * 0.55, 0.02, 0);
      claw.add(arm, pincer);
      claw.userData.claw = true;
      this.group.add(claw);
      for (let i = 0; i < 3; i += 1) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.3, 4), dark);
        leg.position.set(side * (0.15 + i * 0.09), -0.05, -0.18 + i * 0.17);
        leg.rotation.z = side * 1.2;
        leg.userData.leg = true;
        this.group.add(leg);
      }
    }
    const eyeMaterial = new THREE.MeshStandardMaterial({
      color: '#191412',
      emissive: '#ffcf7a',
      emissiveIntensity: 0.8,
      roughness: 0.2,
    });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), eyeMaterial);
      eye.position.set(side * 0.1, 0.16, 0.2);
      this.group.add(eye);
    }
    this.group.scale.setScalar(1);
    void rng;
  }
}

export class TrackItemField {
  readonly group = new THREE.Group();
  readonly shells: ShellItem[] = [];
  readonly hazards: Hazard[] = [];
  private readonly shellSpots: Array<{ distance: number; lateral: number }> = [];
  private readonly rng: RandomSource;
  private readonly path: TrackPath;

  constructor(path: TrackPath, rng: RandomSource) {
    this.path = path;
    this.rng = rng;
    this.group.name = 'TrackItems';
    this.buildShellSpots();
    for (const spot of this.shellSpots) {
      const shell = new ShellItem(path, spot.distance, spot.lateral, rng);
      this.shells.push(shell);
      this.group.add(shell.group);
    }
    this.buildHazards();
  }

  update(delta: number, elapsed: number, night: number): void {
    for (const shell of this.shells) shell.update(delta, elapsed, night);
    for (const hazard of this.hazards) hazard.update(delta, elapsed);
  }

  resetShells(): void {
    for (const shell of this.shells) {
      shell.active = true;
      shell.collected = false;
      shell.collectTime = 0;
      shell.group.visible = true;
      shell.group.scale.setScalar(1);
      shell.respawn();
    }
  }

  /** Returns the first shell within reach, or null. */
  collectNear(distance: number, lateral: number): ShellItem | null {
    for (const shell of this.shells) {
      if (!shell.active) continue;
      const along = Math.abs(this.path.delta(shell.distance, distance));
      if (along < 1.4 && Math.abs(shell.lateral - lateral) < 1.05) {
        shell.collect();
        return shell;
      }
    }
    return null;
  }

  findHazardHit(distance: number, lateral: number): Hazard | null {
    for (const hazard of this.hazards) {
      const along = Math.abs(this.path.delta(hazard.distance, distance));
      const reach = hazard.kind === 'driftwood' ? 1.1 : hazard.kind === 'crab' ? 0.6 : 1.0;
      if (along < reach && Math.abs(hazard.lateral - lateral) < hazard.radius + 0.18) {
        return hazard;
      }
    }
    return null;
  }

  private buildShellSpots(): void {
    const count = 18;
    for (let i = 0; i < count; i += 1) {
      const distance = ((i + 0.35) / count) * this.path.length;
      const lateral = -2.4 + this.rng() * 4.8;
      this.shellSpots.push({ distance, lateral });
    }
    // A gentle slalom of shells through the first bend.
    const extra = [0.09, 0.12, 0.15, 0.18, 0.21, 0.24];
    for (let i = 0; i < extra.length; i += 1) {
      const distance = extra[i] * this.path.length;
      const lateral = Math.sin((i / extra.length) * Math.PI * 2) * 2.1;
      this.shellSpots.push({ distance, lateral });
    }
  }

  private buildHazards(): void {
    const specs: Array<{ fraction: number; kind: HazardKind; lateral: number }> = [
      { fraction: 0.06, kind: 'driftwood', lateral: 1.8 },
      { fraction: 0.12, kind: 'rocks', lateral: -2.3 },
      { fraction: 0.18, kind: 'crab', lateral: 0.5 },
      { fraction: 0.25, kind: 'driftwood', lateral: -1.7 },
      { fraction: 0.31, kind: 'crab', lateral: -2.2 },
      { fraction: 0.37, kind: 'rocks', lateral: 2.2 },
      { fraction: 0.44, kind: 'driftwood', lateral: 0.8 },
      { fraction: 0.51, kind: 'rocks', lateral: -2.5 },
      { fraction: 0.57, kind: 'crab', lateral: 2.2 },
      { fraction: 0.63, kind: 'driftwood', lateral: -2.1 },
      { fraction: 0.7, kind: 'rocks', lateral: 1.5 },
      { fraction: 0.77, kind: 'crab', lateral: -0.3 },
      { fraction: 0.84, kind: 'driftwood', lateral: -1.4 },
      { fraction: 0.91, kind: 'rocks', lateral: 2.4 },
      { fraction: 0.96, kind: 'crab', lateral: 0.2 },
    ];
    for (const spec of specs) {
      const hazard = new Hazard(
        this.path,
        spec.kind,
        spec.fraction * this.path.length,
        spec.lateral,
        this.rng,
      );
      this.hazards.push(hazard);
      this.group.add(hazard.group);
    }
  }
}
