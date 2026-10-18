import * as THREE from 'three';
import type { GamePhase } from '../types';

export type CameraMode = 'chase' | 'side' | 'front' | 'orbit' | 'pelican';

export const CAMERA_MODE_LABELS: Record<CameraMode, string> = {
  chase: '追随',
  side: '侧面跟拍',
  front: '正面跟拍',
  orbit: '电影运镜',
  pelican: '鹈鹕视角',
};

export const CAMERA_MODE_ORDER: CameraMode[] = [
  'chase',
  'side',
  'front',
  'orbit',
  'pelican',
];

export interface CameraTarget {
  position: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  speedRatio: number;
  boost: number;
  lean: number;
}

const UP = new THREE.Vector3(0, 1, 0);

function pseudoNoise(t: number, seed: number): number {
  const value = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

export class CameraRig {
  private trauma = 0;
  private shakeTime = 0;
  private fov = 52;
  private initialized = false;
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredLookAt = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly tmpOffset = new THREE.Vector3();
  private mode: CameraMode = 'chase';
  private modeBlend = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.modeBlend = 0;
  }

  getMode(): CameraMode {
    return this.mode;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  snap(target: CameraTarget, phase: GamePhase, mode: CameraMode = this.mode): void {
    this.mode = mode;
    this.computeTarget(target, phase, 0);
    this.camera.position.copy(this.desiredPosition);
    this.lookAt.copy(this.desiredLookAt);
    this.camera.lookAt(this.lookAt);
    this.initialized = true;
  }

  update(
    delta: number,
    elapsed: number,
    target: CameraTarget,
    phase: GamePhase,
    mode: CameraMode = this.mode,
  ): void {
    if (mode !== this.mode) {
      this.mode = mode;
      this.modeBlend = 0;
    }
    this.modeBlend = Math.min(1, this.modeBlend + delta * 1.8);
    this.computeTarget(target, phase, elapsed);
    const follow = phase === 'playing' ? (this.mode === 'chase' ? 7.5 : 18) : 3.2;
    const alpha = this.initialized ? 1 - Math.exp(-delta * follow) : 1;
    this.camera.position.lerp(this.desiredPosition, alpha);
    this.lookAt.lerp(this.desiredLookAt, Math.min(1, alpha * (this.mode === 'chase' ? 1.5 : 2.4)));

    const baseFov =
      this.mode === 'side'
        ? 42
        : this.mode === 'front'
          ? 47
          : this.mode === 'orbit'
            ? 45
            : this.mode === 'pelican'
              ? 58
              : 51;
    const targetFov = baseFov + target.speedRatio * (this.mode === 'chase' ? 9 : 3) + target.boost * 2;
    this.fov = THREE.MathUtils.lerp(this.fov, targetFov, 1 - Math.exp(-delta * 3.2));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    this.camera.lookAt(this.lookAt);
    if (this.mode === 'chase') this.camera.rotateZ(-target.lean * 0.055);

    this.shakeTime += delta;
    this.trauma = Math.max(0, this.trauma - delta * 1.25);
    if (this.trauma > 0.001) {
      const shake = this.trauma * this.trauma;
      const t = this.shakeTime * 26;
      this.camera.position.x += 0.5 * shake * pseudoNoise(t, 1);
      this.camera.position.y += 0.38 * shake * pseudoNoise(t, 2);
      this.camera.position.z += 0.25 * shake * pseudoNoise(t, 3);
      this.camera.rotateZ(0.02 * shake * pseudoNoise(t, 4));
    }

    this.initialized = true;
  }

  private computeTarget(target: CameraTarget, phase: GamePhase, elapsed: number): void {
    const portrait = this.camera.aspect < 0.86;
    if (phase === 'title') {
      const angle = elapsed * 0.14;
      const radius = portrait ? 7.2 : 5.6;
      this.desiredPosition
        .copy(target.position)
        .add(
          this.tmpOffset.set(
            Math.sin(angle) * radius,
            2.35 + Math.sin(angle * 0.6) * 0.2,
            Math.cos(angle) * radius,
          ),
        );
      this.desiredLookAt
        .copy(target.position)
        .addScaledVector(UP, 1.25)
        .addScaledVector(target.forward, 0.15);
      return;
    }

    if (this.mode === 'side') {
      const distance = portrait ? 7.0 : 5.45;
      this.desiredPosition
        .copy(target.position)
        .addScaledVector(target.right, -distance)
        .addScaledVector(target.forward, -0.18 + target.speedRatio * 0.2)
        .addScaledVector(UP, portrait ? 2.95 : 2.55);
      this.desiredLookAt
        .copy(target.position)
        .addScaledVector(UP, 1.18 + target.speedRatio * 0.08)
        .addScaledVector(target.forward, 0.16);
      return;
    }

    if (this.mode === 'front') {
      const distance = portrait ? 6.2 : 5.1;
      this.desiredPosition
        .copy(target.position)
        .addScaledVector(target.forward, distance)
        .addScaledVector(target.right, -0.35)
        .addScaledVector(UP, portrait ? 2.4 : 1.88);
      this.desiredLookAt
        .copy(target.position)
        .addScaledVector(UP, 1.22)
        .addScaledVector(target.forward, 0.2);
      return;
    }

    if (this.mode === 'orbit') {
      const angle = elapsed * 0.32 + Math.PI + 0.25;
      const radius = portrait ? 6.4 : 5.2;
      const lateral = Math.cos(angle) * radius;
      const longitudinal = Math.sin(angle) * radius * 0.72;
      this.desiredPosition
        .copy(target.position)
        .addScaledVector(target.right, lateral)
        .addScaledVector(target.forward, longitudinal)
        .addScaledVector(
          UP,
          (portrait ? 2.5 : 2.02) + Math.sin(angle * 0.7) * 0.2,
        );
      this.desiredLookAt
        .copy(target.position)
        .addScaledVector(UP, 1.16)
        .addScaledVector(target.forward, 0.1);
      return;
    }

    if (this.mode === 'pelican') {
      this.desiredPosition
        .copy(target.position)
        .addScaledVector(UP, 2.05)
        .addScaledVector(target.forward, 0.42);
      this.desiredLookAt
        .copy(target.position)
        .addScaledVector(target.forward, 15)
        .addScaledVector(UP, 1.28);
      return;
    }

    // Chase camera: the default gameplay view.
    const speedStretch =
      (portrait ? 5.7 : 4.15) + target.speedRatio * (portrait ? 1.3 : 1.05) + target.boost * 0.5;
    const height = (portrait ? 2.95 : 2.02) + target.speedRatio * 0.3;
    this.desiredPosition
      .copy(target.position)
      .addScaledVector(target.forward, -speedStretch)
      .addScaledVector(target.right, target.lean * 0.85)
      .addScaledVector(UP, height);
    this.desiredLookAt
      .copy(target.position)
      .addScaledVector(target.forward, 6.6)
      .addScaledVector(UP, 1.05 + target.speedRatio * 0.25)
      .addScaledVector(target.right, target.lean * 0.6);
    if (phase === 'crashed' || phase === 'finished') {
      this.desiredPosition.addScaledVector(target.forward, -1.5);
      this.desiredPosition.y += 0.9;
    }
  }
}
