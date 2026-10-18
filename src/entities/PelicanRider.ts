import * as THREE from 'three';
import type { RiderRig, RiderVisualState } from '../types';
import {
  createRiderMaterials,
  disposeRiderMaterials,
  type RiderMaterialSet,
} from './pelican/materials';
import {
  PartBatch,
  createWheelGeometrySet,
  featherGeometry,
  sweepGeometry,
  webbedFootGeometry,
} from './pelican/geometry';

// ---------------------------------------------------------------------------
// Layout constants (metres, root origin on the ground between the wheels,
// forward = local +Z, up = local +Y).
// ---------------------------------------------------------------------------
const WHEEL_RADIUS = 0.335;
const TIRE_TUBE = 0.023;
const WHEELBASE = 1.12;
const REAR_Z = -WHEELBASE / 2;
const FRONT_Z = WHEELBASE / 2;
const HUB_WIDTH = 0.115;

const BB = new THREE.Vector3(0, 0.275, -0.055);
const CRANK_RADIUS = 0.17;
const SEAT_CLUSTER = new THREE.Vector3(0, 0.875, -0.235);
const HEAD_TOP = new THREE.Vector3(0, 0.9, 0.335);
const HEAD_BOTTOM = new THREE.Vector3(0, 0.703, 0.407);
const STEER_RAKE = 0.34;
const MAX_STEER = 0.34;

/** Pelican root sits at the middle of the body mass. */
const BODY_ORIGIN = new THREE.Vector3(0, 1.2, -0.06);
/** Head centre relative to the body origin. */
const HEAD_LOCAL = new THREE.Vector3(0, 0.805, 0.24);
const TAIL_BASE = new THREE.Vector3(0, -0.02, -0.32);

const THIGH_LENGTH = 0.46;
const SHIN_LENGTH = 0.5;
const DOWN = new THREE.Vector3(0, -1, 0);

const BODY_RADII = new THREE.Vector3(0.27, 0.26, 0.365);

const NEUTRAL_STATE: RiderVisualState = {
  speed: 0,
  speedRatio: 0,
  steer: 0,
  lean: 0,
  pedalling: 0,
  throttle: 0,
  brake: 1,
  boost: 0,
  daylight: 0.65,
  lampIntensity: 0.35,
  windSpeed: 0,
  windBearing: 0,
  crashed: false,
  elapsed: 0,
  reducedMotion: false,
};

interface LegRig {
  side: number;
  thigh: THREE.Mesh;
  shin: THREE.Mesh;
  knee: THREE.Mesh;
  foot: THREE.Mesh;
}

interface WheelParts {
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  spokes: THREE.BufferGeometry;
  reflector: THREE.BufferGeometry;
  rearHub: THREE.BufferGeometry;
  frontHub: THREE.BufferGeometry;
}

/**
 * Authored hero: a pelican in a coral neckerchief riding a vintage cream and
 * teal bicycle, built entirely from procedural geometry.
 *
 * Root origin is the ground contact point between the wheels, forward is local
 * +Z. Overall height ~2.2 m, wheelbase 1.12 m. The class implements `RiderRig`
 * and is driven only by `RiderVisualState`; every secondary motion is a
 * deterministic function of the supplied elapsed time (no Math.random).
 */
export class PelicanRider implements RiderRig {
  readonly group = new THREE.Group();
  readonly height = 2.22;

  private readonly materials: RiderMaterialSet;
  private readonly wheel: WheelParts;
  private readonly featherTemplate: THREE.BufferGeometry;
  private readonly auxiliaryGeometries: THREE.BufferGeometry[] = [];
  private readonly textures: THREE.Texture[] = [];

  private readonly leanGroup = new THREE.Group();
  private readonly bikeGroup = new THREE.Group();
  private readonly rearWheelSpin = new THREE.Group();
  private readonly frontWheelSpin = new THREE.Group();
  private readonly crankGroup = new THREE.Group();
  private readonly pedalLeft = new THREE.Group();
  private readonly pedalRight = new THREE.Group();
  private readonly frontAssembly = new THREE.Group();
  private readonly frontSteer = new THREE.Group();
  private readonly frontDetail = new THREE.Group();
  private readonly pelicanRoot = new THREE.Group();
  private readonly bodyGroup = new THREE.Group();
  private readonly tailGroup = new THREE.Group();
  private readonly headGroup = new THREE.Group();
  private readonly crestGroup = new THREE.Group();
  private readonly beakGroup = new THREE.Group();
  private readonly wingLeft = new THREE.Group();
  private readonly wingRight = new THREE.Group();
  private readonly spreadWingLeft = new THREE.Group();
  private readonly spreadWingRight = new THREE.Group();

  private readonly eyeGeometry: THREE.BufferGeometry;
  private readonly highlightGeometry: THREE.BufferGeometry;
  private readonly eyeRingGeometry: THREE.BufferGeometry;
  private readonly kneeGeometry: THREE.BufferGeometry;
  private readonly thighGeometry: THREE.BufferGeometry;
  private readonly shinGeometry: THREE.BufferGeometry;
  private readonly footGeometry: THREE.BufferGeometry;
  private lampLens!: THREE.Mesh;
  private readonly pouchMesh: THREE.Object3D;
  private neckMesh!: THREE.Mesh;
  private scarfGeometry!: THREE.BufferGeometry;
  private scarfPosition!: THREE.BufferAttribute;
  private readonly plateGeometry: THREE.BufferGeometry;
  private legLeft!: LegRig;
  private legRight!: LegRig;

  // Animation accumulators (all deterministic).
  private wheelAngle = 0;
  private crankAngle = 0;
  private cadenceSmooth = 0;
  private wingsTarget = false;
  private wingsSpread = 0;
  private steerSmooth = 0;
  private leanSmooth = 0;
  private crashSmooth = 0;
  private pitchSmooth = 0;
  private frozen = false;

  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();
  private readonly tmpE = new THREE.Vector3();
  private readonly tmpF = new THREE.Vector3();

  constructor() {
    this.group.name = 'PelicanRider';

    const contactTexture = this.createContactShadowTexture();
    const plateTexture = this.createPlateTexture();
    this.textures.push(contactTexture, plateTexture);
    this.materials = createRiderMaterials(plateTexture, contactTexture);

    const rearWheel = createWheelGeometrySet(WHEEL_RADIUS, TIRE_TUBE, HUB_WIDTH, true);
    const frontWheel = createWheelGeometrySet(WHEEL_RADIUS, TIRE_TUBE, HUB_WIDTH, false);
    this.wheel = {
      tire: rearWheel.tire,
      rim: rearWheel.rim,
      spokes: rearWheel.spokes,
      reflector: rearWheel.reflector,
      rearHub: rearWheel.hub,
      frontHub: frontWheel.hub,
    };
    frontWheel.tire.dispose();
    frontWheel.rim.dispose();
    frontWheel.spokes.dispose();
    frontWheel.reflector.dispose();

    this.featherTemplate = featherGeometry(1, 1);
    this.auxiliaryGeometries.push(this.featherTemplate);

    this.eyeGeometry = new THREE.SphereGeometry(1, 20, 16);
    this.highlightGeometry = new THREE.SphereGeometry(1, 8, 6);
    this.eyeRingGeometry = new THREE.TorusGeometry(0.044, 0.0075, 6, 18);
    this.kneeGeometry = new THREE.SphereGeometry(0.042, 12, 10);
    this.thighGeometry = this.createLimbGeometry(0.086, 0.036);
    this.shinGeometry = this.createLimbGeometry(0.033, 0.021);
    this.footGeometry = webbedFootGeometry();
    this.plateGeometry = new THREE.PlaneGeometry(0.112, 0.056);

    this.group.add(this.leanGroup);
    this.leanGroup.add(this.bikeGroup);
    this.bikeGroup.name = 'bicycle';
    this.bikeGroup.add(this.rearWheelSpin, this.crankGroup);
    this.crankGroup.position.copy(BB);
    this.pelicanRoot.name = 'pelican';
    this.leanGroup.add(this.pelicanRoot);
    this.pelicanRoot.position.copy(BODY_ORIGIN);
    this.pelicanRoot.add(this.bodyGroup);

    this.buildContactShadow();
    this.buildRearWheel();
    this.buildFrameAndRear();
    this.buildDrivetrain();
    this.buildFrontAssembly();
    this.buildPelicanBody();
    this.buildWings();
    this.buildSpreadWings();
    this.buildScarf();
    this.buildLegs();
    this.buildHead();
    this.pouchMesh = this.buildBeak();
    this.neckMesh = this.buildNeck();
    this.pelicanRoot.add(this.neckMesh);

    this.group.updateMatrixWorld(true);
    this.update(0, NEUTRAL_STATE);
  }

  // -------------------------------------------------------------------------
  // RiderRig API
  // -------------------------------------------------------------------------

  update(delta: number, state: RiderVisualState): void {
    const dt = this.frozen ? 0 : THREE.MathUtils.clamp(delta, 0, 0.05);
    const t = this.frozen ? 0 : Math.max(0, state.elapsed);
    const motionScale = state.reducedMotion ? 0.22 : 1;

    const speed = Math.max(0, state.speed);
    const speedRatio = THREE.MathUtils.clamp(state.speedRatio, 0, 1);
    const steer = THREE.MathUtils.clamp(state.steer, -1, 1);
    const throttle = THREE.MathUtils.clamp(state.throttle, 0, 1);
    const brake = THREE.MathUtils.clamp(state.brake, 0, 1);
    const wind = Math.max(0, state.windSpeed);
    const blend = (rate: number): number => (this.frozen ? 1 : 1 - Math.exp(-dt * rate));

    const crashTarget = state.crashed ? 1 : 0;
    this.crashSmooth += (crashTarget - this.crashSmooth) * blend(7);
    this.steerSmooth += (steer - this.steerSmooth) * blend(12);
    this.leanSmooth += (THREE.MathUtils.clamp(state.lean, -0.9, 0.9) - this.leanSmooth) * blend(8);

    // --- Wheels roll with ground speed ---------------------------------------
    this.wheelAngle += (speed / WHEEL_RADIUS) * dt;
    this.rearWheelSpin.rotation.x = this.wheelAngle;
    this.frontWheelSpin.rotation.x = this.wheelAngle;

    // --- Pedalling ------------------------------------------------------------
    // Legs keep turning whenever the bike rolls; throttle adds cadence rather
    // than gating the animation, and the smoothed rate removes the
    // start/stop hitch that made pedalling read as stepped at low speeds.
    // Keep a calm, nearly constant gear cadence instead of letting leg speed
    // track every km/h of acceleration. A real rider shifts gear to hold ~75
    // rpm, and a steady cadence reads far smoother while the bike speeds up.
    const moving = speed > 0.12 || throttle > 0.04;
    // A real rider shifts gears to hold cadence, so acceleration changes road
    // speed but not the rhythm of the legs. Constant target => zero stutter.
    const cadenceTarget = moving ? 6.4 * (1 - brake * 0.92) : 0;
    this.cadenceSmooth +=
      (THREE.MathUtils.clamp(cadenceTarget, 0, 8.4) - this.cadenceSmooth) * blend(4.8);
    // Cap the per-frame crank advance so a dropped frame cannot teleport the
    // pedals; at normal 60-120 fps cadence runs at its true rate.
    this.crankAngle += Math.min(Math.max(this.cadenceSmooth, 0) * dt, 0.16);
    this.crankGroup.rotation.x = this.crankAngle;
    this.pedalLeft.rotation.x = -this.crankAngle;
    this.pedalRight.rotation.x = -this.crankAngle;

    // --- Whole-bike lean ------------------------------------------------------
    this.leanGroup.rotation.z = -this.leanSmooth;
    this.leanGroup.rotation.y = -this.steerSmooth * 0.05;

    // --- Steering around the raked head-tube axis -----------------------------
    this.frontSteer.rotation.y = this.steerSmooth * MAX_STEER;

    // --- Pelican body: bob, roll, pitch, crash squash -------------------------
    const pedalPulse = Math.sin(this.crankAngle * 2);
    const windMood = THREE.MathUtils.clamp((wind + speed * 1.1) / 16, 0, 1.4);
    const vibration =
      Math.sin(t * 17.3 + 0.7) * 0.0015 * Math.min(speedRatio * 2, 1) * motionScale;
    const bob = (0.007 + 0.012 * speedRatio) * pedalPulse * motionScale + vibration;
    const bodyRoll = 0.03 * pedalPulse * speedRatio * motionScale + this.leanSmooth * 0.12;
    const pitchTarget = throttle * 0.055 - brake * 0.075 + this.crashSmooth * 0.16;
    this.pitchSmooth += (pitchTarget - this.pitchSmooth) * blend(6);

    this.pelicanRoot.position.x = Math.sin(t * 2.1) * 0.004 * speedRatio * motionScale;
    this.pelicanRoot.position.y = BODY_ORIGIN.y + bob - this.crashSmooth * 0.03;
    this.pelicanRoot.position.z = BODY_ORIGIN.z;
    this.pelicanRoot.rotation.set(this.pitchSmooth, -this.steerSmooth * 0.07, bodyRoll);

    this.bodyGroup.scale.set(
      1 + this.crashSmooth * 0.07,
      1 - this.crashSmooth * 0.14,
      1 + this.crashSmooth * 0.05,
    );

    // --- Head stabilisation / counter-sway ------------------------------------
    const headYaw = -0.45 + this.steerSmooth * 0.15 + Math.sin(t * 0.55) * 0.05 * motionScale;
    const headPitch =
      -this.pitchSmooth * 0.7 +
      Math.sin(t * 1.7 + 0.4) * 0.018 * motionScale +
      this.crashSmooth * 0.16;
    this.headGroup.position.set(
      HEAD_LOCAL.x,
      HEAD_LOCAL.y - bob * 0.85 - this.crashSmooth * 0.17,
      HEAD_LOCAL.z,
    );
    this.headGroup.rotation.set(headPitch, headYaw, this.leanSmooth * 0.5 + bodyRoll * 0.45);

    // Beak and pouch bounce: a heavy lunch on a bumpy coast road.
    this.beakGroup.rotation.x =
      Math.sin(this.crankAngle * 2 + 0.9) * 0.016 * speedRatio * motionScale +
      Math.sin(t * 5.1) * 0.006 * motionScale +
      this.crashSmooth * 0.2;
    const pouchBounce = Math.sin(this.crankAngle * 2 + 0.4) * (0.05 + 0.1 * speedRatio) * motionScale;
    this.pouchMesh.rotation.x = -pouchBounce + this.crashSmooth * 0.3 + Math.sin(t * 6.2) * 0.025;
    this.pouchMesh.scale.set(
      1 + Math.abs(pouchBounce) * 0.18,
      1 + pouchBounce * 0.32,
      1 + Math.abs(pouchBounce) * 0.22,
    );

    // --- Secondary motion: crest, wings, tail, scarf --------------------------
    this.crestGroup.rotation.x =
      0.05 + Math.sin(t * 8.3) * 0.06 * windMood + this.crashSmooth * 0.25;
    this.crestGroup.rotation.z =
      Math.sin(t * 10.7 + 1.2) * 0.045 * windMood + Math.sin(t * 4.1) * 0.02 * motionScale;
    this.tailGroup.rotation.x = -0.03 + Math.sin(t * 6.1 + 0.4) * 0.035 * windMood;
    this.tailGroup.rotation.z = Math.sin(t * 7.7) * 0.02 * motionScale;

    const wingFlutter = Math.sin(t * 9.1 + 0.5) * 0.022 * windMood;
    const wingDrop = this.crashSmooth * 0.32;
    // Small fore/aft shift keeps the wing tips near the bars as they steer.
    this.wingLeft.position.z = -0.03 + this.steerSmooth * 0.075;
    this.wingRight.position.z = -0.03 - this.steerSmooth * 0.075;
    this.wingLeft.rotation.set(wingFlutter * 0.6, 0, 0.03 + wingFlutter + wingDrop);
    this.wingRight.rotation.set(wingFlutter * 0.6, 0, -0.03 - wingFlutter - wingDrop);

    // Spread wings: a dedicated, much larger feather fan that unfolds while
    // the compact folded wings are hidden.
    this.wingsSpread +=
      ((this.wingsTarget ? 1 : 0) - this.wingsSpread) * blend(5.4);
    const spread = this.wingsSpread;
    const spreadFlap = Math.sin(t * 4.6) * 0.12 * spread;
    const foldedVisible = spread < 0.08;
    this.wingLeft.visible = foldedVisible;
    this.wingRight.visible = foldedVisible;
    const wingPairs: Array<{ node: THREE.Group; side: number }> = [
      { node: this.spreadWingLeft, side: -1 },
      { node: this.spreadWingRight, side: 1 },
    ];
    for (const { node, side } of wingPairs) {
      node.visible = spread > 0.015;
      node.position.y = 0.06 + spread * 0.1;
      node.rotation.z =
        side * (1 - spread) * -1.12 + side * 0.18 * spread + side * spreadFlap;
      node.rotation.y = side * ((1 - spread) * 0.38 + spread * 0.13);
      node.rotation.x = -0.045 * spread;
    }

    this.updateScarf(t, speed, wind, motionScale);

    // --- Legs follow the cranks ----------------------------------------------
    this.poseLegs(motionScale, t);

    // --- Lamp / tail light ----------------------------------------------------
    const night = 1 - THREE.MathUtils.clamp(state.daylight, 0, 1);
    const lampPower = THREE.MathUtils.clamp(state.lampIntensity, 0, 1);
    this.materials.lampGlass.emissiveIntensity = 0.25 + lampPower * (0.25 + night * 3.3);
    this.materials.taillight.emissiveIntensity = 0.4 + lampPower * (0.2 + night * 2.7);
    this.materials.reflector.emissiveIntensity = 0.2 + night * 0.7;
    this.lampLens.scale.setScalar(1 + lampPower * night * 0.03);
  }

  /** Hide the head/neck for a clean pelican-eye POV camera. */
  setWingsOpen(open: boolean): void {
    this.wingsTarget = open;
  }

  setFirstPerson(active: boolean): void {
    this.headGroup.visible = !active;
    this.neckMesh.visible = !active;
  }

  reset(): void {
    this.wheelAngle = 0;
    this.crankAngle = 0;
    this.cadenceSmooth = 0;
    this.steerSmooth = 0;
    this.leanSmooth = 0;
    this.crashSmooth = 0;
    this.pitchSmooth = 0;
    this.frozen = false;
    this.setFirstPerson(false);
    this.wingsTarget = false;
    this.wingsSpread = 0;
    this.spreadWingLeft.visible = false;
    this.spreadWingRight.visible = false;
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.leanGroup.rotation.set(0, 0, 0);
    this.frontSteer.rotation.set(0, 0, 0);
    this.update(0, { ...NEUTRAL_STATE, brake: 0 });
  }

  /** Freezes all ambient sine motion for deterministic screenshots. */
  stabilizeVisuals(): void {
    this.frozen = true;
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    this.group.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) geometries.add(mesh.geometry);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const geometry of this.auxiliaryGeometries) geometry.dispose();
    disposeRiderMaterials(this.materials);
    for (const texture of this.textures) texture.dispose();
    this.group.clear();
    this.leanGroup.clear();
    this.auxiliaryGeometries.length = 0;
    this.textures.length = 0;
  }

  // -------------------------------------------------------------------------
  // Construction helpers
  // -------------------------------------------------------------------------

  private mesh(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    castShadow = true,
    receiveShadow = false,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    return mesh;
  }

  private createLimbGeometry(topRadius: number, bottomRadius: number): THREE.BufferGeometry {
    const geometry = new THREE.CylinderGeometry(
      topRadius,
      bottomRadius,
      1,
      10,
      1,
      false,
    );
    geometry.translate(0, -0.5, 0);
    return geometry;
  }

  private createContactShadowTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(
        size / 2,
        size / 2,
        size * 0.04,
        size / 2,
        size / 2,
        size * 0.5,
      );
      gradient.addColorStop(0, 'rgba(12, 9, 6, 0.82)');
      gradient.addColorStop(0.42, 'rgba(12, 9, 6, 0.5)');
      gradient.addColorStop(0.75, 'rgba(12, 9, 6, 0.16)');
      gradient.addColorStop(1, 'rgba(12, 9, 6, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'contactShadow';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  private createPlateTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#f2e5c9';
      context.fillRect(0, 0, 256, 128);
      context.strokeStyle = '#1f6f68';
      context.lineWidth = 8;
      context.strokeRect(8, 8, 240, 112);
      context.strokeStyle = '#b8863d';
      context.lineWidth = 2;
      context.strokeRect(20, 20, 216, 88);
      context.fillStyle = '#1f6f68';
      context.font = '700 34px Georgia, "Times New Roman", serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('PELICAN', 128, 48);
      context.fillStyle = '#9a4c24';
      context.font = '600 20px Georgia, "Times New Roman", serif';
      context.fillText('COAST · 07', 128, 84);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'plateDecal';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  private buildContactShadow(): void {
    const geometry = new THREE.PlaneGeometry(1.5, 2.6);
    geometry.rotateX(-Math.PI / 2);
    const mesh = this.mesh('contactShadow', geometry, this.materials.contactShadow, false, false);
    mesh.position.set(0, 0.006, 0.05);
    mesh.renderOrder = -1;
    this.group.add(mesh);
  }

  // -------------------------------------------------------------------------
  // Bicycle
  // -------------------------------------------------------------------------

  private buildRearWheel(): void {
    this.rearWheelSpin.name = 'rearWheel';
    this.rearWheelSpin.position.set(0, WHEEL_RADIUS, REAR_Z);
    this.rearWheelSpin.add(
      this.mesh('rearTire', this.wheel.tire, this.materials.rubber, true, true),
      this.mesh('rearRim', this.wheel.rim, this.materials.frameCream, true, true),
      this.mesh('rearSpokes', this.wheel.spokes, this.materials.steel, false, false),
      this.mesh('rearHub', this.wheel.rearHub, this.materials.brass, true, false),
      this.mesh('rearReflector', this.wheel.reflector, this.materials.reflector, false, false),
    );
  }

  private buildFrameAndRear(): void {
    const cream = new PartBatch();
    const teal = new PartBatch();
    const brass = new PartBatch();
    const steel = new PartBatch();
    const rubber = new PartBatch();
    const leather = new PartBatch();
    const leatherDark = new PartBatch();
    const m = this.materials;
    const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

    // --- Frame triangle -------------------------------------------------------
    cream.addSegment(m.frameCream, BB, SEAT_CLUSTER, 0.02, 10);
    cream.addSegment(m.frameCream, SEAT_CLUSTER, HEAD_TOP, 0.019, 10);
    cream.addSegment(m.frameCream, BB, HEAD_BOTTOM, 0.022, 10);
    cream.addSegment(m.frameCream, HEAD_BOTTOM, HEAD_TOP, 0.027, 12);

    // Teal stays give the vintage frame its colour blocking.
    for (const side of [-1, 1]) {
      teal.addSegment(
        m.frameTeal,
        v(side * 0.024, SEAT_CLUSTER.y - 0.025, SEAT_CLUSTER.z + 0.01),
        v(side * 0.064, WHEEL_RADIUS, REAR_Z),
        0.0115,
        8,
      );
      teal.addSegment(
        m.frameTeal,
        v(side * 0.028, BB.y, BB.z + 0.01),
        v(side * 0.064, WHEEL_RADIUS, REAR_Z),
        0.0125,
        8,
      );
    }

    // Head-tube collars and seat-cluster lug in brass.
    const headAxis = new THREE.Vector3(0, Math.cos(STEER_RAKE), -Math.sin(STEER_RAKE));
    brass.addSegment(
      m.brass,
      HEAD_BOTTOM.clone().addScaledVector(headAxis, 0.015),
      HEAD_BOTTOM.clone().addScaledVector(headAxis, 0.055),
      0.03,
      12,
    );
    brass.addSegment(
      m.brass,
      HEAD_TOP.clone().addScaledVector(headAxis, -0.045),
      HEAD_TOP.clone().addScaledVector(headAxis, 0.005),
      0.03,
      12,
    );
    brass.addSegment(
      m.brass,
      SEAT_CLUSTER.clone().addScaledVector(new THREE.Vector3(0, 1, 0), 0.01),
      SEAT_CLUSTER.clone().addScaledVector(new THREE.Vector3(0, 1, 0), 0.04),
      0.026,
      12,
    );
    brass.addSegment(m.brass, BB.clone().add(v(-0.05, 0, 0)), BB.clone().add(v(0.05, 0, 0)), 0.034, 12);

    // Seatpost + saddle clamp.
    steel.addSegment(m.steel, SEAT_CLUSTER, v(0, 0.912, -0.255), 0.0145, 8);
    brass.addSegment(m.brass, v(0, 0.902, -0.25), v(0, 0.928, -0.258), 0.02, 10);

    // Frame pump clipped under the top tube.
    brass.addSegment(m.brass, v(0, 0.855, -0.19), v(0, 0.876, 0.09), 0.017, 10);
    rubber.addSegment(m.rubber, v(0, 0.852, -0.215), v(0, 0.856, -0.185), 0.02, 10);
    rubber.addSegment(m.rubber, v(0, 0.876, 0.085), v(0, 0.881, 0.115), 0.02, 10);

    // --- Rear fender, brass beading and stays ---------------------------------
    const fenderRadius = 0.372;
    const rearFender = new THREE.TorusGeometry(fenderRadius, 0.019, 8, 34, 2.75);
    rearFender.rotateY(Math.PI / 2);
    cream.add(
      rearFender,
      m.frameCream,
      new THREE.Matrix4()
        .makeTranslation(0, WHEEL_RADIUS, REAR_Z)
        .multiply(new THREE.Matrix4().makeRotationX(-0.5)),
    );
    const rearBeading = new THREE.TorusGeometry(fenderRadius + 0.016, 0.0045, 6, 28, 2.35);
    rearBeading.rotateY(Math.PI / 2);
    brass.add(
      rearBeading,
      m.brass,
      new THREE.Matrix4()
        .makeTranslation(0, WHEEL_RADIUS, REAR_Z)
        .multiply(new THREE.Matrix4().makeRotationX(-0.32)),
    );
    for (const side of [-1, 1]) {
      const stayA = v(side * 0.066, WHEEL_RADIUS + 0.02, REAR_Z);
      const stayB = v(side * 0.055, 0.46, REAR_Z - 0.33);
      steel.addSegment(m.steel, stayA, stayB, 0.0055, 6);
      const stayC = v(side * 0.066, WHEEL_RADIUS + 0.02, REAR_Z);
      const stayD = v(side * 0.05, 0.52, REAR_Z + 0.3);
      steel.addSegment(m.steel, stayC, stayD, 0.0055, 6);
    }

    // --- Saddle ---------------------------------------------------------------
    const saddleBody = new THREE.SphereGeometry(1, 22, 16);
    leather.add(
      saddleBody,
      m.leather,
      new THREE.Matrix4().compose(
        v(0, 0.947, -0.285),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.04, 0, 0)),
        new THREE.Vector3(0.1, 0.044, 0.19),
      ),
    );
    const saddleNose = new THREE.ConeGeometry(1, 1, 14, 1);
    leather.add(
      saddleNose,
      m.leather,
      new THREE.Matrix4().compose(
        v(0, 0.947, -0.135),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
        new THREE.Vector3(0.048, 0.09, 0.03),
      ),
    );
    for (let i = 0; i < 5; i++) {
      const angle = -0.9 + (i / 4) * 1.8;
      brass.add(
        new THREE.CylinderGeometry(0.0055, 0.0055, 0.008, 6),
        m.brass,
        new THREE.Matrix4().makeTranslation(
          Math.sin(angle) * 0.084,
          0.955,
          -0.285 - Math.cos(angle) * 0.16,
        ),
      );
    }
    for (const side of [-1, 1]) {
      steel.addSweep(
        m.steel,
        [
          v(side * 0.052, 0.937, -0.36),
          v(side * 0.04, 0.923, -0.28),
          v(side * 0.02, 0.912, -0.2),
          v(0, 0.905, -0.16),
        ],
        () => new THREE.Vector2(0.0055, 0.0055),
        10,
        6,
      );
    }

    // --- Rear rack, satchel and lights ---------------------------------------
    brass.addSegment(m.brass, v(-0.078, 0.737, -0.69), v(-0.078, 0.737, -0.37), 0.009, 6);
    brass.addSegment(m.brass, v(0.078, 0.737, -0.69), v(0.078, 0.737, -0.37), 0.009, 6);
    for (const z of [-0.69, -0.58, -0.47, -0.37]) {
      brass.addSegment(m.brass, v(-0.078, 0.737, z), v(0.078, 0.737, z), 0.0055, 6);
    }
    for (const side of [-1, 1]) {
      brass.addSegment(
        m.brass,
        v(side * 0.078, 0.737, -0.66),
        v(side * 0.072, 0.41, -0.58),
        0.0075,
        6,
      );
      brass.addSegment(
        m.brass,
        v(side * 0.078, 0.737, -0.4),
        v(side * 0.05, 0.6, -0.33),
        0.007,
        6,
      );
    }
    // Satchel hanging from the left of the rack.
    leatherDark.add(
      new THREE.BoxGeometry(0.062, 0.135, 0.175),
      m.leatherDark,
      new THREE.Matrix4().makeTranslation(-0.152, 0.648, -0.53),
    );
    leatherDark.add(
      new THREE.BoxGeometry(0.068, 0.055, 0.185),
      m.leatherDark,
      new THREE.Matrix4()
        .makeTranslation(-0.152, 0.71, -0.535)
        .multiply(new THREE.Matrix4().makeRotationZ(0.1)),
    );
    brass.addSegment(m.brass, v(-0.142, 0.7, -0.53), v(-0.142, 0.63, -0.53), 0.006, 6);
    brass.addSegment(m.brass, v(-0.185, 0.66, -0.47), v(-0.185, 0.63, -0.47), 0.008, 8);
    brass.addSegment(
      m.brass,
      v(-0.185, 0.605, -0.49),
      v(-0.185, 0.635, -0.47),
      0.007,
      6,
    );

    // Taillight on the rear fender crown, right where the chase camera looks.
    const taillightAngle = 0.62;
    const tailNormal = v(
      0,
      Math.sin(taillightAngle),
      -Math.cos(taillightAngle),
    ).normalize();
    const taillightBase = v(
      0,
      WHEEL_RADIUS + fenderRadius * Math.sin(taillightAngle),
      REAR_Z - fenderRadius * Math.cos(taillightAngle),
    ).addScaledVector(tailNormal, 0.012);
    brass.addSegment(m.brass, taillightBase, taillightBase.clone().addScaledVector(tailNormal, 0.055), 0.032, 12);
    brass.add(
      new THREE.TorusGeometry(0.03, 0.006, 6, 16),
      m.brass,
      this.orientMatrix(
        taillightBase.clone().addScaledVector(tailNormal, 0.056),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tailNormal),
      ),
    );
    const taillightLens = this.mesh(
      'taillightLens',
      new THREE.CircleGeometry(0.026, 16),
      m.taillight,
      false,
      false,
    );
    taillightLens.position.copy(taillightBase).addScaledVector(tailNormal, 0.058);
    taillightLens.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tailNormal);
    this.bikeGroup.add(taillightLens);

    // Number plate mounted on the rear fender, visible from the chase camera.
    const plateAngle = 0.86;
    const plateNormal = v(0, Math.sin(plateAngle), -Math.cos(plateAngle)).normalize();
    const platePosition = v(
      0,
      WHEEL_RADIUS + fenderRadius * Math.sin(plateAngle),
      REAR_Z - fenderRadius * Math.cos(plateAngle),
    ).addScaledVector(plateNormal, 0.026);
    const rearPlate = this.mesh('rearPlate', this.plateGeometry, m.plate, false, false);
    rearPlate.position.copy(platePosition);
    rearPlate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plateNormal);
    this.bikeGroup.add(rearPlate);

    // Head-tube badge.
    const headNormal = v(0, Math.sin(STEER_RAKE), Math.cos(STEER_RAKE)).normalize();
    const headBadge = this.mesh('headBadge', this.plateGeometry, m.plate, false, false);
    headBadge.position.copy(HEAD_BOTTOM).lerp(HEAD_TOP, 0.55).addScaledVector(headNormal, 0.03);
    headBadge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), headNormal);
    headBadge.scale.set(0.78, 0.6, 1);
    this.bikeGroup.add(headBadge);

    // Build all merged frame parts into the bike group.
    cream.buildInto(this.bikeGroup, null, 'frame', true, true);
    teal.buildInto(this.bikeGroup, null, 'frameAccent', true, true);
    brass.buildInto(this.bikeGroup, null, 'frameBrass', true, true);
    steel.buildInto(this.bikeGroup, null, 'frameSteel', true, false);
    rubber.buildInto(this.bikeGroup, null, 'frameRubber', true, false);
    leather.buildInto(this.bikeGroup, null, 'saddle', true, true);
    leatherDark.buildInto(this.bikeGroup, null, 'satchel', true, true);
  }

  private buildDrivetrain(): void {
    const m = this.materials;
    const brass = new PartBatch();
    const steel = new PartBatch();

    // Chainring (drive side, +X) and crank arms rotate with the crank group.
    const chainring = new THREE.CylinderGeometry(0.096, 0.096, 0.008, 28, 1, false);
    chainring.rotateZ(Math.PI / 2);
    chainring.translate(0.072, 0, 0);
    brass.add(chainring, m.brass);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      brass.add(
        new THREE.CylinderGeometry(0.006, 0.006, 0.014, 6),
        m.brass,
        new THREE.Matrix4().makeTranslation(
          0.081,
          Math.cos(angle) * 0.055,
          Math.sin(angle) * 0.055,
        ),
      );
    }
    const rightArm = new THREE.BoxGeometry(0.019, CRANK_RADIUS, 0.03);
    rightArm.translate(0.076, CRANK_RADIUS * 0.5, 0);
    brass.add(rightArm, m.brass);
    const leftArm = new THREE.BoxGeometry(0.019, CRANK_RADIUS, 0.03);
    leftArm.translate(0, -CRANK_RADIUS * 0.5, 0);
    brass.add(leftArm, m.brass, new THREE.Matrix4().makeTranslation(-0.076, 0, 0));
    // Bottom-bracket spindle.
    brass.addSegment(
      m.brass,
      new THREE.Vector3(-0.082, 0, 0),
      new THREE.Vector3(0.082, 0, 0),
      0.012,
      10,
    );
    brass.buildInto(this.crankGroup, null, 'crankset', true, true);

    // Chain runs from chainring to rear cog (static at this camera scale).
    steel.addSegment(
      m.steel,
      new THREE.Vector3(0.072, BB.y + 0.096, BB.z),
      new THREE.Vector3(0.072, WHEEL_RADIUS + 0.055, REAR_Z),
      0.0065,
      6,
    );
    steel.addSegment(
      m.steel,
      new THREE.Vector3(0.072, BB.y - 0.096, BB.z),
      new THREE.Vector3(0.072, WHEEL_RADIUS - 0.055, REAR_Z),
      0.0065,
      6,
    );
    steel.buildInto(this.bikeGroup, null, 'chain', true, false);

    // Pedals: counter-rotate so the platforms stay level.
    const buildPedal = (side: number, group: THREE.Group, label: string): void => {
      const spindle = new THREE.CylinderGeometry(0.009, 0.009, 0.1, 8, 1, false);
      spindle.rotateZ(Math.PI / 2);
      spindle.translate(side * 0.05, 0, 0);
      const platform = new THREE.BoxGeometry(0.085, 0.024, 0.062);
      platform.translate(side * 0.1, 0, 0);
      this.auxiliaryGeometries.push(spindle, platform);
      group.position.set(side * 0.076, side * CRANK_RADIUS, 0);
      group.add(
        this.mesh(label + 'Spindle', spindle, m.steel, false, false),
        this.mesh(label + 'Platform', platform, m.rubber, true, false),
      );
    };
    buildPedal(1, this.pedalRight, 'pedalRight');
    buildPedal(-1, this.pedalLeft, 'pedalLeft');
    this.crankGroup.add(this.pedalRight, this.pedalLeft);
  }

  private orientMatrix(position: THREE.Vector3, quaternion: THREE.Quaternion): THREE.Matrix4 {
    return new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
  }

  private buildFrontAssembly(): void {
    this.frontAssembly.name = 'frontAssembly';
    this.frontAssembly.position.copy(HEAD_BOTTOM);
    this.frontAssembly.rotation.x = -STEER_RAKE;
    this.frontSteer.name = 'frontSteer';
    this.frontAssembly.add(this.frontSteer);
    this.bikeGroup.add(this.frontAssembly);
    this.frontAssembly.updateWorldMatrix(true, false);
    const parentInverse = this.frontAssembly.matrixWorld.clone().invert();
    const assemblyQuaternion = this.frontAssembly.quaternion.clone();

    // Detail holder whose local space is the bike root space, so small parts
    // can be authored in intuitive world coordinates and still steer.
    this.frontDetail.name = 'frontDetails';
    this.frontDetail.matrix.copy(parentInverse);
    this.frontDetail.matrixAutoUpdate = false;
    this.frontSteer.add(this.frontDetail);

    const cream = new PartBatch();
    const brass = new PartBatch();
    const steel = new PartBatch();
    const rubber = new PartBatch();
    const pelican = new PartBatch();
    const wicker = new PartBatch();
    const m = this.materials;
    const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

    // --- Fork ---------------------------------------------------------------
    for (const side of [-1, 1]) {
      cream.addSweep(
        m.frameCream,
        [
          v(side * 0.058, 0.706, 0.41),
          v(side * 0.064, 0.62, 0.44),
          v(side * 0.066, 0.52, 0.485),
          v(side * 0.06, 0.42, 0.536),
          v(side * 0.052, WHEEL_RADIUS, FRONT_Z),
        ],
        (t) => new THREE.Vector2(0.023 * (1 - t * 0.45), 0.02 * (1 - t * 0.4)),
        16,
        8,
      );
    }
    cream.addSegment(m.frameCream, v(-0.055, 0.605, 0.447), v(0.055, 0.605, 0.447), 0.009, 8);
    const headAxis = new THREE.Vector3(0, Math.cos(STEER_RAKE), -Math.sin(STEER_RAKE));
    brass.addSegment(
      m.brass,
      HEAD_BOTTOM.clone().addScaledVector(headAxis, 0.005),
      HEAD_BOTTOM.clone().addScaledVector(headAxis, 0.065),
      0.036,
      12,
    );

    // --- Stem and swept handlebars -----------------------------------------
    brass.addSegment(m.brass, HEAD_TOP.clone().add(v(0, 0.005, 0)), v(0, 1.1, 0.272), 0.019, 8);
    brass.addSegment(m.brass, v(0, 1.1, 0.272), v(0, 1.132, 0.262), 0.025, 10);
    const barPoints = [
      v(-0.302, 1.159, 0.204),
      v(-0.24, 1.153, 0.219),
      v(-0.14, 1.142, 0.244),
      v(0, 1.135, 0.258),
      v(0.14, 1.142, 0.244),
      v(0.24, 1.153, 0.219),
      v(0.302, 1.159, 0.204),
    ];
    brass.addSweep(m.brass, barPoints, () => new THREE.Vector2(0.0155, 0.0155), 34, 8);

    // Grips + brass end caps.
    for (const side of [-1, 1]) {
      rubber.addSegment(
        m.rubber,
        v(side * 0.232, 1.152, 0.222),
        v(side * 0.298, 1.158, 0.205),
        0.021,
        10,
        side > 0 ? 0.018 : 0.021,
      );
      brass.addSegment(
        m.brass,
        v(side * 0.298, 1.158, 0.205),
        v(side * 0.312, 1.159, 0.201),
        0.022,
        10,
      );
    }

    // --- Bell ---------------------------------------------------------------
    const bellDome = new THREE.SphereGeometry(0.036, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    brass.add(
      bellDome,
      m.brass,
      new THREE.Matrix4().compose(
        v(0.19, 1.172, 0.235),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1.25, 1),
      ),
    );
    brass.add(
      new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6),
      m.brass,
      new THREE.Matrix4().makeTranslation(0.19, 1.19, 0.205),
    );
    brass.add(
      new THREE.BoxGeometry(0.014, 0.01, 0.036),
      m.brass,
      new THREE.Matrix4()
        .makeTranslation(0.19, 1.2, 0.215)
        .multiply(new THREE.Matrix4().makeRotationX(0.5)),
    );

    // --- Brake lever, cable and caliper ------------------------------------
    steel.addSegment(
      m.steel,
      v(-0.19, 1.16, 0.232),
      v(-0.145, 1.19, 0.258),
      0.007,
      6,
    );
    steel.add(
      new THREE.BoxGeometry(0.012, 0.018, 0.07),
      m.steel,
      new THREE.Matrix4()
        .makeTranslation(-0.175, 1.175, 0.262)
        .multiply(new THREE.Matrix4().makeRotationX(-0.5)),
    );
    steel.addSweep(
      m.steel,
      [
        v(-0.15, 1.186, 0.262),
        v(-0.11, 1.09, 0.31),
        v(-0.04, 0.9, 0.42),
        v(0.0, 0.72, 0.46),
      ],
      () => new THREE.Vector2(0.0045, 0.0045),
      18,
      6,
    );
    for (const side of [-1, 1]) {
      steel.addSweep(
        m.steel,
        [
          v(side * 0.01, 0.69, 0.452),
          v(side * 0.035, 0.62, 0.49),
          v(side * 0.05, 0.56, 0.524),
        ],
        () => new THREE.Vector2(0.007, 0.0055),
        10,
        6,
      );
    }
    rubber.add(
      new THREE.BoxGeometry(0.02, 0.05, 0.014),
      m.rubber,
      new THREE.Matrix4().makeTranslation(0, 0.545, 0.545),
    );

    // --- Wicker basket, mounted over the front wheel ------------------------
    const basketCenter = v(0, 1.005, 0.435);
    const wall = new THREE.CylinderGeometry(0.158, 0.112, 0.19, 16, 1, true);
    wicker.add(wall, m.wicker, new THREE.Matrix4().makeTranslation(basketCenter.x, basketCenter.y, basketCenter.z));
    wicker.add(
      new THREE.CylinderGeometry(0.112, 0.112, 0.014, 16),
      m.wicker,
      new THREE.Matrix4().makeTranslation(basketCenter.x, basketCenter.y - 0.095, basketCenter.z),
    );
    for (let band = 0; band < 4; band++) {
      const height = -0.075 + band * 0.05;
      const radius = 0.12 + (band / 3) * 0.038;
      const ring = new THREE.TorusGeometry(radius, 0.0085, 5, 20);
      ring.rotateX(Math.PI / 2);
      wicker.add(
        ring,
        m.wicker,
        new THREE.Matrix4().makeTranslation(basketCenter.x, basketCenter.y + height, basketCenter.z),
      );
    }
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2;
      const height = 0.19;
      const slat = new THREE.BoxGeometry(0.011, height, 0.013);
      const midRadius = 0.135;
      wicker.add(
        slat,
        m.wicker,
        new THREE.Matrix4().compose(
          v(
            basketCenter.x + Math.cos(angle) * midRadius,
            basketCenter.y,
            basketCenter.z + Math.sin(angle) * midRadius,
          ),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0.11 * Math.cos(angle))),
          new THREE.Vector3(1, 1, 1),
        ),
      );
    }
    const basketRim = new THREE.TorusGeometry(0.158, 0.012, 6, 20);
    basketRim.rotateX(Math.PI / 2);
    wicker.add(basketRim, m.wicker, new THREE.Matrix4().makeTranslation(basketCenter.x, basketCenter.y + 0.097, basketCenter.z));
    // Brass basket struts down to the fork crown.
    brass.addSegment(m.brass, v(0, 0.705, 0.408), v(0, 0.92, 0.4), 0.009, 6);
    for (const side of [-1, 1]) {
      brass.addSegment(
        m.brass,
        v(side * 0.085, 0.71, 0.42),
        v(side * 0.1, 0.91, 0.43),
        0.0075,
        6,
      );
      brass.addSegment(m.brass, v(side * 0.135, 1.1, 0.4), v(side * 0.13, 1.14, 0.29), 0.007, 6);
    }

    // --- Headlamp ------------------------------------------------------------
    brass.addSegment(m.brass, v(0, 0.705, 0.412), v(0, 0.762, 0.505), 0.012, 8);
    brass.addSegment(m.brass, v(0, 0.762, 0.5), v(0, 0.762, 0.588), 0.056, 16);
    const lampBezel = new THREE.TorusGeometry(0.05, 0.008, 6, 20);
    brass.add(
      lampBezel,
      m.brass,
      new THREE.Matrix4().makeTranslation(0, 0.762, 0.592),
    );

    // --- Wingtip "hands" resting on the grips -------------------------------
    for (const side of [-1, 1]) {
      const gripTop = v(side * 0.268, 1.178, 0.213);
      const palm = new THREE.SphereGeometry(1, 14, 10);
      pelican.add(
        palm,
        m.pelicanWhite,
        new THREE.Matrix4().compose(
          gripTop,
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0, side * 0.12)),
          new THREE.Vector3(0.046, 0.024, 0.044),
        ),
      );
      for (let i = 0; i < 3; i++) {
        const zOffset = 0.024 - i * 0.024;
        pelican.addSegment(
          m.pelicanWhite,
          v(side * 0.268, 1.173, 0.213 + zOffset),
          v(side * 0.265, 1.142, 0.225 + zOffset),
          0.0095,
          6,
          0.0045,
        );
      }
    }

    // Build the merged front assembly parts in steering-local space.
    cream.buildInto(this.frontSteer, parentInverse, 'frontFrame', true, true);
    brass.buildInto(this.frontSteer, parentInverse, 'frontBrass', true, true);
    steel.buildInto(this.frontSteer, parentInverse, 'frontSteel', true, false);
    rubber.buildInto(this.frontSteer, parentInverse, 'frontRubber', true, false);
    pelican.buildInto(this.frontSteer, parentInverse, 'frontHands', true, false);
    wicker.buildInto(this.frontSteer, parentInverse, 'basket', true, true);

    // --- Front wheel ---------------------------------------------------------
    const axleLocal = new THREE.Vector3(0, WHEEL_RADIUS, FRONT_Z).applyMatrix4(parentInverse);
    this.frontWheelSpin.name = 'frontWheel';
    this.frontWheelSpin.position.copy(axleLocal);
    this.frontWheelSpin.add(
      this.mesh('frontTire', this.wheel.tire, m.rubber, true, true),
      this.mesh('frontRim', this.wheel.rim, m.frameCream, true, true),
      this.mesh('frontSpokes', this.wheel.spokes, m.steel, false, false),
      this.mesh('frontHub', this.wheel.frontHub, m.brass, true, false),
      this.mesh('frontReflector', this.wheel.reflector, m.reflector, false, false),
    );
    this.frontSteer.add(this.frontWheelSpin);

    // --- Front fender (also steers) -----------------------------------------
    const fender = new THREE.TorusGeometry(0.372, 0.018, 8, 30, 2.9);
    fender.rotateY(Math.PI / 2);
    const frontAxleLocal = new THREE.Vector3(0, WHEEL_RADIUS, FRONT_Z).applyMatrix4(parentInverse);
    const fenderMesh = this.mesh('frontFender', fender, m.frameCream, true, true);
    fenderMesh.position.copy(frontAxleLocal);
    fenderMesh.rotation.x = -0.45 + STEER_RAKE;
    const stripe = new THREE.TorusGeometry(0.388, 0.0045, 6, 26, 2.4);
    stripe.rotateY(Math.PI / 2);
    const stripeMesh = this.mesh('frontFenderBeading', stripe, m.brass, true, false);
    stripeMesh.position.copy(frontAxleLocal);
    stripeMesh.rotation.x = -0.28 + STEER_RAKE;
    this.frontSteer.add(fenderMesh, stripeMesh);

    // --- Headlamp lens (animated material) ----------------------------------
    const lensGeometry = new THREE.CircleGeometry(0.046, 24);
    this.lampLens = this.mesh('headlampLens', lensGeometry, m.lampGlass, false, false);
    this.lampLens.position.copy(new THREE.Vector3(0, 0.762, 0.602)).applyMatrix4(parentInverse);
    this.lampLens.quaternion.copy(assemblyQuaternion.clone().invert());
    this.frontSteer.add(this.lampLens);

    // --- Basket catch: a fish tail, a shell, and some dangling line ---------
    const detail = this.frontDetail;
    const fishBody = this.mesh('fishBody', new THREE.SphereGeometry(1, 16, 12), m.fish, true, false);
    fishBody.position.set(0.062, 1.09, 0.44);
    fishBody.scale.set(0.048, 0.055, 0.135);
    fishBody.rotation.set(0.35, 0.1, -0.2);
    detail.add(fishBody);

    const fishTailShape = new THREE.Shape();
    fishTailShape.moveTo(0, 0);
    fishTailShape.bezierCurveTo(0.055, 0.03, 0.06, 0.08, 0.012, 0.105);
    fishTailShape.lineTo(0, 0.09);
    fishTailShape.lineTo(-0.012, 0.105);
    fishTailShape.bezierCurveTo(-0.06, 0.08, -0.055, 0.03, 0, 0);
    const fishTailGeometry = new THREE.ShapeGeometry(fishTailShape, 6);
    const fishTail = this.mesh('fishTail', fishTailGeometry, m.fishFin, false, false);
    fishTail.position.set(0.078, 1.152, 0.425);
    fishTail.rotation.set(0.1, 0.35, 0.25);
    detail.add(fishTail);

    const shellPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const angle = i * 0.62;
      const radius = 0.05 * (1 - i / 15);
      shellPoints.push(
        new THREE.Vector3(
          -0.085 + Math.cos(angle) * radius,
          1.06 + Math.sin(angle) * radius,
          0.425 + i * 0.0025,
        ),
      );
    }
    const shell = this.mesh(
      'shell',
      sweepGeometry(shellPoints, () => new THREE.Vector2(0.013, 0.009), 20, 6),
      m.shell,
      false,
      false,
    );
    detail.add(shell);

    const strap = this.mesh(
      'basketStrap',
      new THREE.TorusGeometry(0.075, 0.006, 5, 14, Math.PI),
      m.leather,
      false,
      false,
    );
    strap.position.set(0.1, 1.15, 0.47);
    strap.rotation.set(0.3, 0.4, 0.4);
    detail.add(strap);
  }

  // -------------------------------------------------------------------------
  // Pelican
  // -------------------------------------------------------------------------

  private buildPelicanBody(): void {
    const m = this.materials;

    const bodyGeometry = this.createBodyGeometry();
    const body = this.mesh('body', bodyGeometry, m.pelicanWhite, true, true);
    this.bodyGroup.add(body);

    const breast = this.mesh('breast', new THREE.SphereGeometry(1, 28, 20), m.pelicanWhite, true, true);
    breast.position.set(0, -0.09, 0.2);
    breast.scale.set(0.225, 0.19, 0.185);
    breast.rotation.set(-0.22, 0, 0);
    this.bodyGroup.add(breast);

    const mantle = this.mesh('mantle', new THREE.SphereGeometry(1, 26, 18), m.pelicanWhite, true, true);
    mantle.position.set(0, 0.13, 0.02);
    mantle.scale.set(0.215, 0.17, 0.2);
    mantle.rotation.set(0.15, 0, 0);
    this.bodyGroup.add(mantle);

    // Overlapping shingle feathers across the back read as plumage at chase
    // distance instead of a smooth rubber egg.
    const shingles = new PartBatch();
    const rx = BODY_RADII.x;
    const ry = BODY_RADII.y;
    const rz = BODY_RADII.z;
    for (let row = 0; row < 1; row++) {
      const phi = Math.PI * (0.36 + row * 0.1);
      for (let col = 0; col < 5; col++) {
        const azimuth = Math.PI + (col - 2) * 0.34 + (row % 2 === 0 ? 0.06 : -0.06);
        const direction = new THREE.Vector3(
          Math.sin(phi) * Math.sin(azimuth),
          Math.cos(phi),
          Math.sin(phi) * Math.cos(azimuth),
        );
        const surface = new THREE.Vector3(
          direction.x * rx,
          direction.y * ry,
          direction.z * rz,
        );
        const normal = new THREE.Vector3(
          direction.x / rx,
          direction.y / ry,
          direction.z / rz,
        ).normalize();
        const anchor = surface.clone().addScaledVector(normal, 0.002);
        const tangent = new THREE.Vector3(0.06 * (col - 1.5), -0.75, -0.66);
        tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
        this.addFeatherMatrix(
          shingles,
          row === 1 ? m.pelicanShade : m.feather,
          anchor,
          tangent,
          normal,
          0.075,
          0.07 + row * 0.006,
        );
      }
    }
    shingles.buildInto(this.bodyGroup, null, 'plumage', true, false);

    // Tail fan.
    this.tailGroup.name = 'tail';
    this.tailGroup.position.copy(TAIL_BASE);
    const tailBatch = new PartBatch();
    const tailInverse = new THREE.Matrix4().makeTranslation(
      -TAIL_BASE.x,
      -TAIL_BASE.y,
      -TAIL_BASE.z,
    );
    for (let i = 0; i < 5; i++) {
      const spread = (i - 2) / 2;
      const anchor = new THREE.Vector3(
        spread * 0.055,
        TAIL_BASE.y - 0.02 - Math.abs(spread) * 0.01,
        TAIL_BASE.z - Math.abs(spread) * 0.015,
      );
      const tangent = new THREE.Vector3(spread * 0.55, -0.1 - Math.abs(spread) * 0.09, -1);
      const normal = new THREE.Vector3(spread * 0.22, 1, 0.05);
      this.addFeatherMatrix(
        tailBatch,
        m.feather,
        anchor,
        tangent,
        normal,
        0.145,
        0.33 - Math.abs(spread) * 0.06,
      );
    }
    for (let i = 0; i < 2; i++) {
      const spread = (i - 0.5) * 0.55;
      const anchor = new THREE.Vector3(spread * 0.045, TAIL_BASE.y + 0.03, TAIL_BASE.z + 0.015);
      this.addFeatherMatrix(
        tailBatch,
        m.pelicanShade,
        anchor,
        new THREE.Vector3(spread * 0.32, -0.06, -1),
        new THREE.Vector3(0, 1, 0.05),
        0.115,
        0.28,
      );
    }
    tailBatch.buildInto(this.tailGroup, tailInverse, 'tailFeathers', true, false);
    this.pelicanRoot.add(this.tailGroup);
  }

  private createBodyGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.SphereGeometry(1, 48, 32);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).normalize();
      const { x, y, z } = vertex;
      const rear = Math.max(0, -z);
      const front = Math.max(0, z);
      const tailTaper = 1 - 0.24 * Math.pow(rear, 1.35);
      const chest = 1 + 0.06 * Math.pow(front, 1.4);
      let px = x * BODY_RADII.x * tailTaper * chest;
      let py = y * BODY_RADII.y;
      let pz = z * BODY_RADII.z;
      if (py < -0.155) py = -0.155 + (py + 0.155) * 0.42;
      const plumage = 1 + 0.01 * Math.sin(Math.atan2(pz, px) * 5.2 + y * 3.1);
      px *= plumage;
      pz *= plumage;
      position.setXYZ(i, px, py, pz);
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  private buildNeck(): THREE.Mesh {
    const points = [
      new THREE.Vector3(0, 0.14, 0.08),
      new THREE.Vector3(0, 0.26, 0.17),
      new THREE.Vector3(0, 0.38, 0.215),
      new THREE.Vector3(0, 0.5, 0.2),
      new THREE.Vector3(0, 0.61, 0.175),
      new THREE.Vector3(0, 0.71, 0.19),
      new THREE.Vector3(0, 0.765, 0.225),
    ];
    const geometry = sweepGeometry(
      points,
      (t) => {
        const radius =
          t < 0.6
            ? 0.135 + (0.082 - 0.135) * (t / 0.6)
            : 0.082 + (0.1 - 0.082) * ((t - 0.6) / 0.4);
        return new THREE.Vector2(radius * 0.95, radius);
      },
      38,
      14,
    );
    const neck = this.mesh('neck', geometry, this.materials.pelicanWhite, true, true);

    // Ruff of feathers where the neck leaves the chest.
    const ruff = new PartBatch();
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * Math.PI * 2;
      const anchor = new THREE.Vector3(
        Math.cos(angle) * 0.1,
        0.215 + Math.sin(i * 1.7) * 0.012,
        0.12 + Math.sin(angle) * 0.095,
      );
      const tangent = new THREE.Vector3(Math.cos(angle) * 0.5, -0.85, Math.sin(angle) * 0.42);
      const normal = new THREE.Vector3(Math.cos(angle) * 0.4, 0.3, Math.sin(angle) * 0.4);
      this.addFeatherMatrix(ruff, this.materials.feather, anchor, tangent, normal, 0.09, 0.14);
    }
    ruff.buildInto(this.pelicanRoot, null, 'neckRuff', true, false);

    return neck;
  }

  private buildHead(): void {
    const m = this.materials;
    this.headGroup.name = 'head';
    this.headGroup.position.copy(HEAD_LOCAL);
    this.pelicanRoot.add(this.headGroup);

    const headGeometry = new THREE.SphereGeometry(1, 36, 26);
    const position = headGeometry.getAttribute('position') as THREE.BufferAttribute;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).normalize();
      const { x, y, z } = vertex;
      const px = x * 0.172;
      const py = y * 0.16 * (y < 0 ? 0.94 : 1);
      const pz = z * 0.19 * (z < 0 ? 1.02 : 1);
      position.setXYZ(i, px, py, pz);
    }
    headGeometry.computeVertexNormals();
    const head = this.mesh('head', headGeometry, m.pelicanWhite, true, true);
    this.headGroup.add(head);

    // Glossy eyes with a bright catchlight, plus a bare eye ring.
    for (const side of [-1, 1]) {
      const eye = this.mesh('eye' + (side < 0 ? 'L' : 'R'), this.eyeGeometry, m.eye, false, false);
      eye.position.set(side * 0.14, 0.032, 0.062);
      eye.scale.set(0.033, 0.037, 0.032);
      this.headGroup.add(eye);

      const highlight = this.mesh(
        'eyeHighlight' + (side < 0 ? 'L' : 'R'),
        this.highlightGeometry,
        m.eyeHighlight,
        false,
        false,
      );
      highlight.position.set(side * 0.163, 0.051, 0.074);
      highlight.scale.setScalar(0.0078);
      this.headGroup.add(highlight);

      const ring = this.mesh('eyeRing' + (side < 0 ? 'L' : 'R'), this.eyeRingGeometry, m.eyeRing, false, false);
      ring.position.copy(eye.position);
      ring.rotation.y = Math.PI / 2;
      this.headGroup.add(ring);
    }

    // Brows: two soft ridges above the eyes.
    const brows = new PartBatch();
    for (const side of [-1, 1]) {
      brows.add(
        new THREE.SphereGeometry(1, 12, 8),
        m.pelicanShade,
        new THREE.Matrix4().compose(
          new THREE.Vector3(side * 0.115, 0.085, 0.055),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, side * 0.15, side * 0.25)),
          new THREE.Vector3(0.052, 0.014, 0.032),
        ),
      );
    }
    brows.buildInto(this.headGroup, null, 'brows', true, false);

    // Crest: a scruffy plume of tapered quills off the back of the skull.
    this.crestGroup.name = 'crest';
    this.crestGroup.position.set(0, 0.055, -0.035);
    const crest = new PartBatch();
    const crestLayout: Array<[number, number, number, number]> = [
      [-0.062, 0.16, 0.34, 0.24],
      [-0.03, 0.2, 0.4, 0.28],
      [0.008, 0.22, 0.42, 0.3],
      [0.046, 0.19, 0.38, 0.27],
      [0.076, 0.155, 0.33, 0.23],
    ];
    for (let i = 0; i < crestLayout.length; i++) {
      const [x, length, rise, spread] = crestLayout[i];
      const base = new THREE.Vector3(x * 0.8, 0.025, 0.005);
      const tip = new THREE.Vector3(x * 1.9, 0.025 + length * rise, 0.005 - length * 0.9);
      crest.addSweep(
        i % 2 === 1 ? this.materials.pelicanShade : this.materials.pelicanWhite,
        [
          base,
          base.clone().lerp(tip, 0.5).add(new THREE.Vector3(spread * 0.05, 0.03, 0)),
          tip,
        ],
        (t) => new THREE.Vector2(0.026 * (1 - t * 0.72) + 0.004, 0.016 * (1 - t * 0.68) + 0.003),
        10,
        6,
      );
    }
    crest.buildInto(this.crestGroup, null, 'crestFeathers', true, false);
    this.headGroup.add(this.crestGroup);

  }

  private buildBeak(): THREE.Object3D {
    const m = this.materials;
    this.beakGroup.name = 'beak';
    this.beakGroup.position.set(0, -0.012, 0.102);
    this.headGroup.add(this.beakGroup);

    const upper = new PartBatch();
    const lower = new PartBatch();

    // Long tapered upper mandible with a hooked tip.
    upper.addSweep(
      m.beak,
      [
        new THREE.Vector3(0, 0.026, -0.015),
        new THREE.Vector3(0, 0.016, 0.17),
        new THREE.Vector3(0, -0.004, 0.34),
        new THREE.Vector3(0, -0.042, 0.49),
        new THREE.Vector3(0, -0.092, 0.572),
        new THREE.Vector3(0, -0.138, 0.598),
      ],
      (t) => new THREE.Vector2(
        0.009 + 0.048 * Math.pow(1 - t, 1.22),
        0.012 + 0.038 * Math.pow(1 - t, 1.1),
      ),
      32,
      12,
    );
    upper.add(
      new THREE.SphereGeometry(1, 12, 8),
      m.beak,
      new THREE.Matrix4().compose(
        new THREE.Vector3(0, -0.14, 0.596),
        new THREE.Quaternion(),
        new THREE.Vector3(0.011, 0.015, 0.019),
      ),
    );
    upper.buildInto(this.beakGroup, null, 'upperMandible', true, false);

    // Thin lower mandible that closes the mouth line under the upper bill.
    lower.addSweep(
      m.beak,
      [
        new THREE.Vector3(0, -0.004, 0.0),
        new THREE.Vector3(0, -0.024, 0.17),
        new THREE.Vector3(0, -0.042, 0.34),
        new THREE.Vector3(0, -0.068, 0.49),
        new THREE.Vector3(0, -0.103, 0.57),
        new THREE.Vector3(0, -0.13, 0.598),
      ],
      (t) => new THREE.Vector2(
        0.007 + 0.041 * Math.pow(1 - t, 1.12),
        0.01 + 0.03 * Math.pow(1 - t, 1.1),
      ),
      26,
      8,
    );
    lower.add(
      new THREE.SphereGeometry(1, 10, 8),
      m.beak,
      new THREE.Matrix4().compose(
        new THREE.Vector3(0, -0.138, 0.598),
        new THREE.Quaternion(),
        new THREE.Vector3(0.008, 0.008, 0.013),
      ),
    );
    lower.buildInto(this.beakGroup, null, 'lowerMandible', true, false);

    // A dark gape line hides the bright pouch top between the mandibles.
    const gape = new PartBatch();
    gape.addSweep(
      m.beakSeam,
      [
        new THREE.Vector3(0, -0.012, 0.002),
        new THREE.Vector3(0, -0.03, 0.17),
        new THREE.Vector3(0, -0.049, 0.34),
        new THREE.Vector3(0, -0.077, 0.49),
        new THREE.Vector3(0, -0.112, 0.57),
        new THREE.Vector3(0, -0.135, 0.597),
      ],
      (t) => new THREE.Vector2(0.016 * (1 - t * 0.5), 0.006 * (1 - t * 0.45)),
      28,
      6,
    );
    gape.buildInto(this.beakGroup, null, 'gapeLine', false, false);

    // Sagging gular pouch: a flattened-top sack hanging under the bill, on its
    // own pivot so it can bounce independently.
    const pouchGroup = new THREE.Group();
    pouchGroup.name = 'gularPouch';
    pouchGroup.position.set(0, -0.03, 0.02);
    this.beakGroup.add(pouchGroup);

    const pouchBatch = new PartBatch();
    const sack = new THREE.SphereGeometry(1, 32, 24);
    const sackPosition = sack.getAttribute('position') as THREE.BufferAttribute;
    const sackVertex = new THREE.Vector3();
    for (let i = 0; i < sackPosition.count; i++) {
      sackVertex.fromBufferAttribute(sackPosition, i);
      const y = sackVertex.y;
      if (y > 0) sackVertex.y = y * 0.32;
      const taper = 1 - 0.38 * Math.pow(Math.max(0, Math.abs(sackVertex.z) - 0.45) / 0.55, 1.4);
      sackVertex.x *= taper;
      sackPosition.setXYZ(i, sackVertex.x, sackVertex.y, sackVertex.z);
    }
    sack.computeVertexNormals();
    pouchBatch.add(
      sack,
      m.pouch,
      new THREE.Matrix4().compose(
        new THREE.Vector3(0, -0.075, 0.2),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0, 0)),
        new THREE.Vector3(0.062, 0.086, 0.2),
      ),
    );
    pouchBatch.add(
      new THREE.SphereGeometry(1, 18, 12),
      m.pouch,
      new THREE.Matrix4().compose(
        new THREE.Vector3(0, -0.022, 0.06),
        new THREE.Quaternion(),
        new THREE.Vector3(0.046, 0.032, 0.075),
      ),
    );
    pouchBatch.buildInto(pouchGroup, null, 'pouchSack', true, false);
    return pouchGroup;
  }

  private buildWings(): void {
    const m = this.materials;
    for (const side of [-1, 1]) {
      const wing = side < 0 ? this.wingLeft : this.wingRight;
      wing.name = side < 0 ? 'wingLeft' : 'wingRight';
      wing.position.set(side * 0.19, 0.055, -0.03);
      this.pelicanRoot.add(wing);

      const batch = new PartBatch();

      // Folded shoulder mass blending into the body flank.
      const shoulder = new THREE.SphereGeometry(1, 20, 14);
      batch.add(
        shoulder,
        m.pelicanWhite,
        new THREE.Matrix4().compose(
          new THREE.Vector3(side * 0.01, -0.005, -0.025),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, 0, side * 0.18)),
          new THREE.Vector3(0.115, 0.17, 0.23),
        ),
      );

      // Broad overlapping coverts folded along the flank toward the tail.
      for (let i = 0; i < 1; i++) {
        const anchor = new THREE.Vector3(
          side * (0.062 + i * 0.003),
          0.062 - i * 0.03,
          -0.015 - i * 0.06,
        );
        this.addFeatherMatrix(
          batch,
          i >= 2 ? m.pelicanShade : m.feather,
          anchor,
          new THREE.Vector3(side * 0.08, -0.52 - i * 0.06, -0.85),
          new THREE.Vector3(side, 0.24, -0.1),
          0.105 - i * 0.006,
          0.2 - i * 0.012,
        );
      }

      // Forearm reaching forward to the handlebar grip.
      batch.add(
        sweepGeometry(
          [
            new THREE.Vector3(side * 0.032, 0.028, 0.03),
            new THREE.Vector3(side * 0.05, 0.0, 0.11),
            new THREE.Vector3(side * 0.057, -0.052, 0.21),
            new THREE.Vector3(side * 0.06, -0.1, 0.298),
          ],
          (t) => new THREE.Vector2(0.07 * (1 - t * 0.42), 0.06 * (1 - t * 0.4)),
          18,
          10,
        ),
        m.pelicanWhite,
      );
      for (let i = 0; i < 1; i++) {
        this.addFeatherMatrix(
          batch,
          m.feather,
          new THREE.Vector3(side * (0.052 + i * 0.004), 0.012 - i * 0.038, 0.085 + i * 0.062),
          new THREE.Vector3(side * 0.16, -0.3, 0.94),
          new THREE.Vector3(side, 0.55, 0.2),
          0.08,
          0.17,
        );
      }

      batch.buildInto(wing, null, wing.name, true, false);
    }
  }

  /**
   * A real avian wing shape: a thin underwing skin, a leading-edge arm, and
   * three overlapping feather groups (primaries with dark tips, secondaries,
   * and two rows of coverts). The previous fan of single blades read as an
   * abstract shape; this has the silhouette and layering of a spread wing.
   */
  private buildSpreadWings(): void {
    const m = this.materials;
    for (const side of [-1, 1]) {
      const wing = side < 0 ? this.spreadWingLeft : this.spreadWingRight;
      wing.name = side < 0 ? 'spreadWingLeft' : 'spreadWingRight';
      wing.position.set(side * 0.18, 0.06, -0.02);
      wing.visible = false;
      this.pelicanRoot.add(wing);

      const lightBatch = new PartBatch();
      const darkBatch = new PartBatch();

      // Leading-edge arm.
      lightBatch.add(
        sweepGeometry(
          [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(side * 0.3, 0.1, -0.02),
            new THREE.Vector3(side * 0.64, 0.2, -0.08),
            new THREE.Vector3(side * 0.98, 0.25, -0.16),
          ],
          (t) => new THREE.Vector2(0.075 * (1 - t * 0.58), 0.05 * (1 - t * 0.45)),
          22,
          10,
        ),
        m.pelicanWhite,
      );

      // Secondaries: the broad inner-wing fan.
      for (let i = 0; i < 9; i += 1) {
        const u = i / 8;
        const span = 0.06 + u * 0.44;
        const anchor = new THREE.Vector3(
          side * span,
          0.045 + Math.sin(u * Math.PI) * 0.07,
          -0.015 - u * 0.12,
        );
        const direction = new THREE.Vector3(
          side * (0.1 + u * 0.08),
          -0.05 - u * 0.035,
          -1,
        ).normalize();
        const normal = new THREE.Vector3(side * 0.03, 0.97, 0.24).normalize();
        this.addFeatherMatrix(
          lightBatch,
          i < 3 ? m.pelicanShade : m.feather,
          anchor,
          direction,
          normal,
          0.24 + u * 0.09 + Math.sin(i * 1.8) * 0.015,
          0.38 + u * 0.22 + Math.sin(i * 1.3) * 0.03,
        );
      }

      // Primaries: long outer flight feathers, white base, dark tips.
      for (let i = 0; i < 11; i += 1) {
        const u = i / 10;
        const span = 0.36 + u * 0.66;
        const anchor = new THREE.Vector3(
          side * span,
          0.09 + Math.sin(u * Math.PI * 0.85) * 0.18,
          -0.1 - u * 0.14,
        );
        const direction = new THREE.Vector3(
          side * (0.18 + u * 0.12),
          -0.11 - u * 0.13,
          -0.94 + u * 0.04,
        ).normalize();
        const normal = new THREE.Vector3(side * 0.04, 0.94, 0.34).normalize();
        const length = 0.54 + u * 0.34 + Math.sin(i * 1.6) * 0.034;
        const width = 0.14 + u * 0.06 + Math.cos(i * 2.2) * 0.008;
        this.addFeatherMatrix(
          lightBatch,
          u > 0.7 ? m.pelicanShade : m.feather,
          anchor,
          direction,
          normal,
          width,
          length,
        );
        const tipAnchor = anchor
          .clone()
          .addScaledVector(direction, length * 0.56)
          .addScaledVector(normal, 0.007);
        this.addFeatherMatrix(
          darkBatch,
          m.primaryTip,
          tipAnchor,
          direction,
          normal,
          width * 0.9,
          length * 0.44,
        );
      }

      // Two rows of short coverts overlapping the feather bases.
      for (let row = 0; row < 2; row += 1) {
        for (let i = 0; i < 7; i += 1) {
          const u = i / 6;
          const span = 0.05 + u * 0.6;
          const anchor = new THREE.Vector3(
            side * span,
            0.085 + row * 0.032 + Math.sin(u * Math.PI) * 0.045,
            -0.035 - u * 0.08 - row * 0.025,
          );
          const direction = new THREE.Vector3(
            side * (0.08 + u * 0.06),
            -0.1,
            -1,
          ).normalize();
          const normal = new THREE.Vector3(side * 0.04, 0.96, 0.27).normalize();
          this.addFeatherMatrix(
            lightBatch,
            row === 0 ? m.pelicanWhite : m.pelicanShade,
            anchor,
            direction,
            normal,
            0.18 + u * 0.07,
            0.26 + u * 0.16,
          );
        }
      }

      // A full-span row of upper coverts breaks up the wing membrane into
      // layered feather planes instead of one flat white sheet.
      for (let i = 0; i < 11; i += 1) {
        const u = i / 10;
        const span = 0.1 + u * 0.84;
        const anchor = new THREE.Vector3(
          side * span,
          0.1 + Math.sin(u * Math.PI * 0.8) * 0.12,
          -0.04 - u * 0.12,
        );
        const direction = new THREE.Vector3(
          side * (0.06 + u * 0.05),
          -0.12 - u * 0.04,
          -1,
        ).normalize();
        const normal = new THREE.Vector3(side * 0.04, 0.96, 0.28).normalize();
        this.addFeatherMatrix(
          lightBatch,
          i % 2 === 0 ? m.pelicanWhite : m.feather,
          anchor,
          direction,
          normal,
          0.19 + u * 0.07,
          0.3 + u * 0.22 + Math.sin(i * 1.5) * 0.02,
        );
      }

      // Alula at the wrist.
      for (let i = 0; i < 3; i += 1) {
        this.addFeatherMatrix(
          lightBatch,
          m.feather,
          new THREE.Vector3(side * (0.5 + i * 0.035), 0.15 + i * 0.015, -0.08),
          new THREE.Vector3(side * 0.25, -0.15, -0.96).normalize(),
          new THREE.Vector3(side * 0.05, 0.95, 0.3).normalize(),
          0.07,
          0.24 - i * 0.03,
        );
      }

      lightBatch.buildInto(wing, null, wing.name + 'Light', true, false);
      darkBatch.buildInto(wing, null, wing.name + 'Tips', true, false);
    }
  }

  private buildScarf(): void {
    const m = this.materials;

    const neckerchief = new THREE.Mesh(
      new THREE.TorusGeometry(0.132, 0.021, 8, 24),
      m.scarf,
    );
    neckerchief.name = 'neckerchief';
    neckerchief.castShadow = true;
    neckerchief.rotation.x = Math.PI / 2 + 0.12;
    neckerchief.rotation.z = 0.1;
    neckerchief.position.set(0, 0.312, 0.14);
    this.pelicanRoot.add(neckerchief);

    const knot = this.mesh(
      'scarfKnot',
      new THREE.SphereGeometry(1, 14, 10),
      m.scarf,
      true,
      false,
    );
    knot.scale.set(0.04, 0.048, 0.034);
    knot.position.set(0.104, 0.298, 0.178);
    knot.rotation.z = 0.4;
    this.pelicanRoot.add(knot);

    // Long trailing ribbon, rebuilt each frame for wind flutter.
    const segments = 24;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const uvs = new Float32Array((segments + 1) * 2 * 2);
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      uvs.set([t, 0], i * 4);
      uvs.set([t, 1], i * 4 + 2);
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    this.scarfGeometry = geometry;
    this.scarfPosition = geometry.getAttribute('position') as THREE.BufferAttribute;
    const ribbon = this.mesh('scarfRibbon', geometry, m.scarf, true, false);
    ribbon.frustumCulled = false;
    this.pelicanRoot.add(ribbon);
  }

  private buildLegs(): void {
    const m = this.materials;
    const makeLeg = (side: number): LegRig => {
      const thigh = this.mesh(
        'thigh' + (side < 0 ? 'L' : 'R'),
        this.thighGeometry,
        m.pelicanShade,
        true,
        true,
      );
      const shin = this.mesh(
        'shin' + (side < 0 ? 'L' : 'R'),
        this.shinGeometry,
        m.leg,
        true,
        false,
      );
      const knee = this.mesh(
        'knee' + (side < 0 ? 'L' : 'R'),
        this.kneeGeometry,
        m.leg,
        false,
        false,
      );
      const foot = this.mesh(
        'foot' + (side < 0 ? 'L' : 'R'),
        this.footGeometry,
        m.leg,
        true,
        false,
      );
      this.leanGroup.add(thigh, shin, knee, foot);
      return { side, thigh, shin, knee, foot };
    };
    this.legLeft = makeLeg(-1);
    this.legRight = makeLeg(1);
  }

  // -------------------------------------------------------------------------
  // Animation helpers
  // -------------------------------------------------------------------------

  private addFeatherMatrix(
    batch: PartBatch,
    material: THREE.Material,
    anchor: THREE.Vector3,
    direction: THREE.Vector3,
    normalHint: THREE.Vector3,
    width: number,
    length: number,
  ): void {
    const yAxis = direction.clone().normalize();
    const normal = normalHint.clone().normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, normal);
    if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
    xAxis.normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
    const matrix = new THREE.Matrix4().makeBasis(
      xAxis.multiplyScalar(width),
      yAxis.multiplyScalar(length),
      zAxis,
    );
    matrix.setPosition(anchor);
    batch.addShared(this.featherTemplate, material, matrix);
  }

  private poseLegs(motionScale: number, t: number): void {
    const hipLocalY = -0.19;
    const hipLocalZ = 0.065;
    const hips: Array<{ leg: LegRig; hip: THREE.Vector3 }> = [
      { leg: this.legLeft, hip: this.tmpA },
      { leg: this.legRight, hip: this.tmpB },
    ];
    for (let i = 0; i < hips.length; i++) {
      const { leg, hip } = hips[i];
      hip.set(leg.side * 0.105, hipLocalY, hipLocalZ);
      hip.applyQuaternion(this.pelicanRoot.quaternion);
      hip.add(this.pelicanRoot.position);

      const phase = this.crankAngle + (leg.side > 0 ? 0 : Math.PI);
      const pedalX = leg.side * 0.16;
      const pedalY = BB.y + Math.cos(phase) * CRANK_RADIUS + 0.065;
      const pedalZ = BB.z + Math.sin(phase) * CRANK_RADIUS + 0.012;
      const ankle = this.tmpC.set(pedalX, pedalY, pedalZ);

      const toAnkle = this.tmpD.subVectors(ankle, hip);
      const distance = Math.min(
        Math.max(toAnkle.length(), 0.12),
        THIGH_LENGTH + SHIN_LENGTH - 0.004,
      );
      const direction = this.tmpE.copy(toAnkle).normalize();
      const along =
        (THIGH_LENGTH * THIGH_LENGTH - SHIN_LENGTH * SHIN_LENGTH + distance * distance) /
        (2 * distance);
      const height = Math.sqrt(Math.max(THIGH_LENGTH * THIGH_LENGTH - along * along, 1e-4));

      const bend = this.tmpF.set(leg.side * 0.5, 0.12, 0.86).normalize();
      bend.addScaledVector(direction, -bend.dot(direction));
      if (bend.lengthSq() < 1e-5) bend.set(0, 0, 1);
      bend.normalize();
      const knee = new THREE.Vector3()
        .copy(hip)
        .addScaledVector(direction, along)
        .addScaledVector(bend, height);

      leg.thigh.position.copy(hip);
      this.tmpF.subVectors(knee, hip).normalize();
      leg.thigh.quaternion.setFromUnitVectors(DOWN, this.tmpF);
      leg.thigh.scale.set(1, THIGH_LENGTH, 1);

      leg.shin.position.copy(knee);
      this.tmpF.subVectors(ankle, knee).normalize();
      leg.shin.quaternion.setFromUnitVectors(DOWN, this.tmpF);
      leg.shin.scale.set(1, SHIN_LENGTH, 1);

      leg.knee.position.copy(knee);

      const ankling = Math.sin(phase + 0.4) * 0.16 * motionScale;
      leg.foot.position.set(ankle.x, ankle.y - 0.048, ankle.z + 0.012);
      leg.foot.rotation.set(-ankling, leg.side * 0.12, 0);

      // Keep the hip pivots hidden inside the belly feathers.
      leg.thigh.scale.x = 1 + Math.abs(Math.sin(phase)) * 0.02;
      leg.knee.scale.setScalar(1 + Math.sin(t * 3.1 + i) * 0.01 * motionScale);
    }
  }

  private updateScarf(t: number, speed: number, wind: number, motionScale: number): void {
    const segments = 24;
    const position = this.scarfPosition;
    const windFactor = THREE.MathUtils.clamp((wind + speed * 1.3) / 15, 0, 1.5) * motionScale;
    const phase = t * (4.5 + speed * 0.55 + wind * 0.35);
    const amplitude = (0.008 + 0.032 * windFactor) * motionScale;
    for (let i = 0; i <= segments; i++) {
      const f = i / segments;
      const waveX =
        Math.sin(f * 5.4 - phase) * amplitude * f * 1.4 +
        Math.sin(f * 9.1 - phase * 0.6) * amplitude * f * 0.4;
      const waveY = Math.sin(f * 4.2 - phase * 0.82 + 1.1) * amplitude * f * 0.8;
      const centerX = 0.05 + 0.19 * f + waveX;
      const centerY = 0.33 - 0.15 * f - 0.03 * f * f + waveY;
      const centerZ = 0.12 - 0.66 * f;
      const halfHeight = 0.042 * (1 - f) + 0.007;
      const twist = Math.sin(f * 4.8 - phase * 0.7) * 0.03 * f * windFactor;
      position.setXYZ(i * 2, centerX - twist, centerY - halfHeight, centerZ);
      position.setXYZ(i * 2 + 1, centerX + twist, centerY + halfHeight, centerZ);
    }
    position.needsUpdate = true;
    this.scarfGeometry.computeVertexNormals();
    this.scarfGeometry.computeBoundingSphere();
  }

}
