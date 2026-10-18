import * as THREE from 'three';
import { ROAD_Y } from './TrackPath';
import { createSoftCircleTexture, type RandomSource } from './ProceduralTextures';

interface RainDrop {
  x: number;
  y: number;
  z: number;
  speed: number;
  length: number;
}

interface Splash {
  x: number;
  z: number;
  life: number;
  maxLife: number;
}

export interface WeatherVfxState {
  rain: number;
  storm: number;
  flash: number;
  windSpeed: number;
  windDirection: THREE.Vector2;
}

export class WeatherVfx {
  readonly root = new THREE.Group();
  private readonly rain: THREE.LineSegments;
  private readonly rainMaterial: THREE.LineBasicMaterial;
  private readonly drops: RainDrop[] = [];
  private readonly rainPositions: Float32Array;
  private readonly splashes: THREE.Points;
  private readonly splashMaterial: THREE.PointsMaterial;
  private readonly splashData: Splash[] = [];
  private readonly splashPositions: Float32Array;
  private readonly bolts: THREE.Line[] = [];
  private readonly boltMaterial: THREE.LineBasicMaterial;
  private readonly rng: RandomSource;

  constructor(rng: RandomSource) {
    this.rng = rng;
    this.root.name = 'WeatherVfx';
    const count = 1500;
    this.rainPositions = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i += 1) {
      this.drops.push({
        x: (rng() - 0.5) * 100,
        y: rng() * 48,
        z: (rng() - 0.5) * 100,
        speed: 22 + rng() * 24,
        length: 0.65 + rng() * 1.3,
      });
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.rainPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.rainMaterial = new THREE.LineBasicMaterial({
      color: '#cfe1e5',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.rain = new THREE.LineSegments(rainGeometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.root.add(this.rain);

    const splashCount = 180;
    this.splashPositions = new Float32Array(splashCount * 3);
    for (let i = 0; i < splashCount; i += 1) {
      this.splashData.push({
        x: (rng() - 0.5) * 22,
        z: (rng() - 0.5) * 22,
        life: rng(),
        maxLife: 0.35 + rng() * 0.35,
      });
      this.splashPositions[i * 3 + 1] = ROAD_Y + 0.06;
    }
    const splashGeometry = new THREE.BufferGeometry();
    splashGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.splashPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.splashMaterial = new THREE.PointsMaterial({
      map: createSoftCircleTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'),
      color: '#e8f2f1',
      size: 0.1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.splashes = new THREE.Points(splashGeometry, this.splashMaterial);
    this.splashes.frustumCulled = false;
    this.root.add(this.splashes);

    this.boltMaterial = new THREE.LineBasicMaterial({
      color: '#e8eeff',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 2; i += 1) {
      const geometry = this.createBoltGeometry();
      const bolt = new THREE.Line(geometry, this.boltMaterial);
      bolt.visible = false;
      bolt.frustumCulled = false;
      this.bolts.push(bolt);
      this.root.add(bolt);
    }
  }

  update(
    delta: number,
    elapsed: number,
    cameraPosition: THREE.Vector3,
    state: WeatherVfxState,
  ): void {
    const rainAmount = state.rain;
    this.root.position.set(cameraPosition.x, 0, cameraPosition.z);
    this.rain.visible = rainAmount > 0.02;
    this.splashes.visible = rainAmount > 0.04;
    this.rainMaterial.opacity = rainAmount * 0.34;
    this.splashMaterial.opacity = rainAmount * 0.34;
    if (rainAmount <= 0.02) {
      for (const bolt of this.bolts) bolt.visible = false;
      return;
    }

    const windX = state.windDirection.x * (0.55 + state.windSpeed * 0.06);
    const windZ = state.windDirection.y * (0.55 + state.windSpeed * 0.06);
    const drops = this.drops;
    for (let i = 0; i < drops.length; i += 1) {
      const drop = drops[i];
      drop.y -= drop.speed * delta * (0.7 + rainAmount * 0.5);
      drop.x += windX * delta * 5.5;
      drop.z += windZ * delta * 5.5;
      if (drop.y < 0.5) {
        drop.y = 38 + this.rng() * 12;
        drop.x = (this.rng() - 0.5) * 100;
        drop.z = (this.rng() - 0.5) * 100;
      }
      if (drop.x > 50) drop.x -= 100;
      if (drop.x < -50) drop.x += 100;
      if (drop.z > 50) drop.z -= 100;
      if (drop.z < -50) drop.z += 100;
      const index = i * 6;
      this.rainPositions[index] = drop.x;
      this.rainPositions[index + 1] = drop.y;
      this.rainPositions[index + 2] = drop.z;
      this.rainPositions[index + 3] = drop.x + windX * drop.length * 0.24;
      this.rainPositions[index + 4] = drop.y - drop.length;
      this.rainPositions[index + 5] = drop.z + windZ * drop.length * 0.24;
    }
    const rainAttribute = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    rainAttribute.needsUpdate = true;

    for (let i = 0; i < this.splashData.length; i += 1) {
      const splash = this.splashData[i];
      splash.life -= delta;
      if (splash.life <= 0) {
        splash.life = splash.maxLife;
        splash.x = (this.rng() - 0.5) * 24;
        splash.z = (this.rng() - 0.5) * 24;
      }
      const t = 1 - splash.life / splash.maxLife;
      this.splashPositions[i * 3] = splash.x;
      this.splashPositions[i * 3 + 1] = ROAD_Y + 0.04 + t * 0.05;
      this.splashPositions[i * 3 + 2] = splash.z;
    }
    const splashAttribute = this.splashes.geometry.getAttribute('position') as THREE.BufferAttribute;
    splashAttribute.needsUpdate = true;

    const showBolt = state.flash > 0.25;
    this.boltMaterial.opacity = state.flash * 0.9;
    this.bolts.forEach((bolt, index) => {
      bolt.visible = showBolt;
      if (showBolt) {
        const angle = elapsed * 0.09 + index * 2.3;
        bolt.position.set(
          Math.cos(angle) * 150 + 20,
          10,
          Math.sin(angle) * 150 + 30,
        );
      }
    });
    this.splashMaterial.size = 0.055 + state.rain * 0.045;
    this.splashes.rotation.y = 0;
  }

  private createBoltGeometry(): THREE.BufferGeometry {
    const points: THREE.Vector3[] = [];
    let x = 0;
    let z = 0;
    const segments = 22;
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      x += (this.rng() - 0.5) * 9;
      z += (this.rng() - 0.5) * 6;
      points.push(new THREE.Vector3(x, 68 - t * 52, z));
    }
    const branchStart = 11;
    const branch: THREE.Vector3[] = [points[branchStart].clone()];
    for (let i = 0; i < 7; i += 1) {
      branch.push(
        new THREE.Vector3(
          points[branchStart].x + (this.rng() - 0.2) * 18 * (i / 7),
          points[branchStart].y - (i / 7) * 20,
          points[branchStart].z + (this.rng() - 0.5) * 6,
        ),
      );
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    void branch;
    return geometry;
  }
}
