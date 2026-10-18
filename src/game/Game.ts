import * as THREE from 'three';
import { InputController, type ControlState } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderPipeline, resizeRenderer, type RenderPipeline } from '../core/Renderer';
import { PelicanRider } from '../entities/PelicanRider';
import { TrackItemField } from '../entities/TrackItems';
import {
  CAMERA_MODE_LABELS,
  CAMERA_MODE_ORDER,
  CameraRig,
  type CameraMode,
  type CameraTarget,
} from '../systems/CameraRig';
import { AudioSystem } from '../systems/AudioSystem';
import { Hud } from '../ui/Hud';
import { createSeededRandom } from '../utils/random';
import { Environment, type EnvironmentState } from '../world/Environment';
import { Props } from '../world/Props';
import { ROAD_HALF_WIDTH, ROAD_Y, TrackPath } from '../world/TrackPath';
import { RoadWorld } from '../world/Road';
import { WeatherVfx } from '../world/WeatherVfx';
import { createSignTexture } from '../world/ProceduralTextures';
import { createCoastalEnvironmentMap, type GeneratedEnvironmentMap } from '../world/EnvironmentMap';
import type { GamePhase, HudSnapshot, RiderVisualState, WeatherKind } from '../types';

const MAX_SPEED = 12.4;
const BOOST_MULTIPLIER = 1.34;
const TOTAL_LAPS = 2;
const START_PROGRESS = 18;
const START_LATERAL = 0;

const formatClock = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  const whole = Math.floor(remainder);
  const tenths = Math.floor((remainder - whole) * 10);
  return `${minutes.toString().padStart(2, '0')}:${whole
    .toString()
    .padStart(2, '0')}.${tenths}`;
};

const formatSplit = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`;
};

export class Game {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.08, 2600);
  private readonly pipeline: RenderPipeline;
  private readonly loop: Loop;
  private readonly input: InputController;
  private readonly hud: Hud;
  private readonly audio = new AudioSystem();
  private readonly cameraRig: CameraRig;
  private cameraMode: CameraMode = 'chase';
  private uiHidden = false;
  private wingsOpen = false;
  private pointerSteerId: number | null = null;
  private pointerSteerStartX = 0;
  private cameraButton: HTMLButtonElement | null = null;
  private readonly hudRoot: HTMLElement;
  private readonly rng = createSeededRandom(0x5ea51de);
  private readonly track = new TrackPath();
  private readonly environment: Environment;
  private readonly road: RoadWorld;
  private readonly props: Props;
  private readonly weather: WeatherVfx;
  private readonly items: TrackItemField;
  private readonly rider: PelicanRider;
  private readonly headlamp: THREE.SpotLight;
  private readonly headlampTarget: THREE.Object3D;
  private readonly impactFlash: HTMLDivElement;
  private readonly environmentMap: GeneratedEnvironmentMap;

  private phase: GamePhase = 'title';
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private elapsed = 0;
  private visualTime = 0;
  private frame = 0;

  private speed = 0;
  private progress = START_PROGRESS;
  private lateral = START_LATERAL;
  private lateralVelocity = 0;
  private steerSmoothed = 0;
  private lean = 0;
  private lastControls: ControlState = { steer: 0, throttle: 0, brake: 0, boost: false };
  private boosting = false;
  private wasBoosting = false;
  private boostMeter = 0.72;

  private lap = 1;
  private lapStart = 0;
  private lapTimes: number[] = [];
  private hearts = 3;
  private invulnerable = 0;
  private crashTimer = 0;
  private pendingGameOver = false;

  private shells = 0;
  private score = 0;
  private bestScore = 0;
  private combo = 1;
  private comboTimer = 0;

  private lastGust = 0;
  private gustCooldown = 0;
  private lastWeather: WeatherKind = 'clear';
  private thunderCooldown = 0;
  private checkpointFlash: { title: string; split: string } | null = null;
  private checkpointFlashTimer = 0;

  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly riderState: RiderVisualState = {
    speed: 0,
    speedRatio: 0,
    steer: 0,
    lean: 0,
    pedalling: 0,
    throttle: 0,
    brake: 0,
    boost: 0,
    daylight: 1,
    lampIntensity: 0,
    windSpeed: 0,
    windBearing: 0,
    crashed: false,
    elapsed: 0,
    reducedMotion: false,
  };
  private readonly cameraTarget: CameraTarget = {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    speedRatio: 0,
    boost: 0,
    lean: 0,
  };
  private readonly tmpWind = new THREE.Vector2();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color('#0b1c25');
    const lowQuality =
      window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 860;
    this.pipeline = createRenderPipeline(canvas, this.scene, this.camera, lowQuality);
    this.pipeline.renderer.info.autoReset = false;
    this.environmentMap = createCoastalEnvironmentMap(this.pipeline.renderer);
    this.scene.environment = this.environmentMap.texture;
    this.scene.environmentIntensity = 0.42;
    this.environment = new Environment(this.scene, this.rng);
    this.scene.add(this.environment.root);
    this.road = new RoadWorld(this.track, this.rng);
    this.scene.add(this.road.group);
    this.props = new Props(
      this.track,
      this.rng,
      createSignTexture('Coastal Classic', '鹈鹕海岸线 · PELICAN COAST', '#ff6b4a'),
    );
    this.scene.add(this.props.group);
    this.weather = new WeatherVfx(this.rng);
    this.scene.add(this.weather.root);
    this.items = new TrackItemField(this.track, this.rng);
    this.scene.add(this.items.group);
    this.rider = new PelicanRider();
    this.rider.group.rotation.order = 'YXZ';
    this.scene.add(this.rider.group);

    this.headlampTarget = new THREE.Object3D();
    this.headlampTarget.position.set(0, 0.55, 15);
    this.rider.group.add(this.headlampTarget);
    this.headlamp = new THREE.SpotLight('#ffe3b0', 0, 34, 0.54, 0.62, 1.4);
    this.headlamp.position.set(0, 1.05, 0.42);
    this.headlamp.target = this.headlampTarget;
    this.headlamp.castShadow = false;
    this.rider.group.add(this.headlamp);

    this.cameraRig = new CameraRig(this.camera);
    this.input = new InputController({
      onCamera: () => this.cycleCamera(),
      onBell: () => this.ringBell(),
      onWings: () => this.toggleWings(),
      onSkipTime: () => this.skipThreeHours(),
      onToggleUi: () => this.toggleInterface(),
      onPause: () => this.togglePause(),
      onMute: () => this.toggleMute(),
      onRestart: () => {
        if (this.phase === 'finished' || this.phase === 'crashed') this.startRun();
      },
    });

    this.hudRoot = this.getElement('#hud-root');
    this.hud = new Hud({
      onStart: () => this.startRun(),
      onResume: () => this.resumeRun(),
      onRestart: () => this.startRun(),
      onPause: () => this.togglePause(),
      onToggleSound: () => this.toggleMute(),
      onSteer: (value) => this.input.setWheelSteer(value),
      onSteerEnd: () => this.input.setWheelSteer(0),
      onThrottle: (value) => this.input.setThrottle(value),
      onBrake: (value) => this.input.setBrake(value),
      onBoost: (pressed) => this.input.setBoost(pressed),
    });

    this.cameraButton = document.querySelector<HTMLButtonElement>('#camera-button');
    this.cameraButton?.addEventListener('click', this.onCameraButtonClick);
    this.updateCameraButtonLabel();

    this.loop = new Loop(
      (delta, elapsed) => this.update(delta, elapsed),
      () => this.render(),
    );

    this.canvas.addEventListener('pointerdown', this.onRidePointerDown);
    this.canvas.addEventListener('pointermove', this.onRidePointerMove);
    this.canvas.addEventListener('pointerup', this.onRidePointerUp);
    this.canvas.addEventListener('pointercancel', this.onRidePointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onRidePointerUp);

    this.impactFlash = document.createElement('div');
    this.impactFlash.setAttribute('aria-hidden', 'true');
    Object.assign(this.impactFlash.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '18',
      opacity: '0',
      background:
        'radial-gradient(circle at 50% 54%, rgba(255,248,225,0.95), rgba(255,126,85,0.35) 42%, rgba(6,26,30,0) 74%)',
      mixBlendMode: 'screen',
    });
    document.body.appendChild(this.impactFlash);

    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.bestScore = this.loadBest();
    this.resetRideState();
    this.applyRiderTransform();
    this.refreshCamera(true, this.phase, 0);
    this.hud.update(this.buildSnapshot());
    this.installTestHooks();
    resizeRenderer(this.pipeline, this.camera, lowQuality ? 1.8 : 2);
    (window as unknown as { __PELICAN_GAME__: Game }).__PELICAN_GAME__ = this;
    this.render();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.cameraButton?.removeEventListener('click', this.onCameraButtonClick);
    this.canvas.removeEventListener('pointerdown', this.onRidePointerDown);
    this.canvas.removeEventListener('pointermove', this.onRidePointerMove);
    this.canvas.removeEventListener('pointerup', this.onRidePointerUp);
    this.canvas.removeEventListener('pointercancel', this.onRidePointerUp);
    this.canvas.removeEventListener('lostpointercapture', this.onRidePointerUp);
    this.audio.dispose();
    this.hud.dispose();
    this.rider.dispose?.();
    this.environmentMap.dispose();
    this.impactFlash.remove();
    this.pipeline.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    if (this.pausedForScreenshot) return;

    const simDelta = Math.max(0, Math.min(delta, 0.05));
    this.visualTime += simDelta;
    this.input.update();
    this.input.setPaused(this.phase !== 'playing');

    if (this.phase !== 'paused') {
      this.environment.update(
        this.phase === 'title' ? simDelta * 0.7 : simDelta,
        this.visualTime,
        this.rider.group.position,
        this.camera.position,
      );
    }
    const env = this.environment.state;

    if (this.phase === 'playing') {
      this.elapsed += simDelta;
      this.updateRide(simDelta, env);
    } else if (this.phase === 'crashed' || this.phase === 'finished') {
      this.speed = Math.max(0, this.speed - simDelta * 4.2);
      this.lean = THREE.MathUtils.lerp(this.lean, 0, 1 - Math.exp(-simDelta * 3));
    } else if (this.phase === 'title') {
      this.lean = Math.sin(this.visualTime * 0.5) * 0.02;
    }

    this.weather.update(simDelta, this.visualTime, this.camera.position, {
      rain: env.rain,
      storm: env.storm,
      flash: env.flash,
      windSpeed: env.windSpeed + env.gustSpeed,
      windDirection: env.windDirection,
    });
    this.road.update(simDelta, this.visualTime, env.windStrength);
    this.road.setWetness(env.rain * 0.8 + env.storm * 0.2);
    this.props.update(
      simDelta,
      this.visualTime,
      env.windSpeed + env.gustSpeed,
      env.windDirection,
      env.night,
      env.storm,
    );
    this.items.update(simDelta, this.visualTime, env.night);
    this.applyRiderTransform();
    this.updateRiderVisuals(simDelta, env);
    this.refreshCamera(false, this.phase, simDelta);
    this.updateScenePulse(env, simDelta);
    this.hud.update(this.buildSnapshot());
    this.audio.update({
      speedRatio: this.speed / MAX_SPEED,
      windStrength: env.windStrength,
      playing: this.phase === 'playing' || this.phase === 'title',
      paused: this.phase !== 'playing',
    });
    if (this.checkpointFlashTimer > 0) {
      this.checkpointFlashTimer -= simDelta;
      if (this.checkpointFlashTimer <= 0) this.checkpointFlash = null;
    }
    this.publishDiagnostics();
    void elapsed;
  }

  private render(): void {
    resizeRenderer(
      this.pipeline,
      this.camera,
      window.matchMedia('(pointer: coarse)').matches ? 1.8 : 2,
    );
    this.pipeline.renderer.info.reset();
    this.pipeline.composer.render();
    this.publishDiagnostics();
  }

  private updateRide(delta: number, env: EnvironmentState): void {
    const controls = this.input.read();
    this.lastControls = controls;

    if (this.invulnerable > 0) this.invulnerable -= delta;
    if (this.crashTimer > 0) {
      this.crashTimer -= delta;
      this.speed = Math.max(0, this.speed - delta * 8);
      if (this.crashTimer <= 0) {
        if (this.pendingGameOver) {
          this.finishAsCrashed();
        } else {
          this.speed = Math.max(this.speed, 2.4);
        }
      }
      return;
    }

    const frame = this.track.frameAt(this.progress);
    this.forward.set(Math.sin(frame.yaw), 0, Math.cos(frame.yaw));
    this.right.crossVectors(this.up, this.forward).normalize();

    const wind = this.tmpWind.set(
      env.windDirection.x * (env.windSpeed + env.gustSpeed),
      env.windDirection.y * (env.windSpeed + env.gustSpeed),
    );
    const alongWind = wind.x * this.forward.x + wind.y * this.forward.z;
    const crossWind = wind.x * this.right.x + wind.y * this.right.z;
    const grip = THREE.MathUtils.clamp(
      1 - env.rain * 0.22 - env.storm * 0.22 - env.fogAmount * 0.05,
      0.5,
      1,
    );

    const steerTarget = controls.steer;
    this.steerSmoothed +=
      (steerTarget - this.steerSmoothed) * (1 - Math.exp(-delta * 9.5));
    // The track's `right` vector is seaward, which reads on the left of the
    // chase camera. Invert it for screen-space steering so D / → / clockwise
    // wheel input moves the bicycle to the visual right.
    const screenSteer = -this.steerSmoothed;

    const boostAvailable = this.boostMeter > 0.015 && this.speed > 0.8;
    this.boosting = controls.boost && boostAvailable;
    if (this.boosting) {
      this.boostMeter = Math.max(0, this.boostMeter - delta * 0.3);
      this.speed += delta * 3.0;
      if (!this.wasBoosting) {
        this.audio.boost();
        this.cameraRig.addTrauma(0.12);
      }
    } else {
      this.boostMeter = Math.min(1, this.boostMeter + delta * 0.027);
    }
    this.wasBoosting = this.boosting;

    const weatherTop = MAX_SPEED * (1 - env.storm * 0.07 - env.rain * 0.035);
    const topSpeed =
      weatherTop * (this.boosting ? BOOST_MULTIPLIER : 1) +
      THREE.MathUtils.clamp(alongWind * 0.045, -1.6, 2.2);
    const speedFraction = THREE.MathUtils.clamp(this.speed / Math.max(topSpeed, 1), 0, 1);
    const throttleAcceleration =
      controls.throttle * 8.2 * (1 - speedFraction * 0.86) * grip;
    const brakeDeceleration = controls.brake * 13.2;
    const rollingDrag = 0.2 + this.speed * 0.028 + speedFraction * 0.45;
    this.speed += (throttleAcceleration - brakeDeceleration - rollingDrag) * delta;
    if (this.boosting) this.speed += 1.6 * delta;
    this.speed = THREE.MathUtils.clamp(this.speed, 0, topSpeed);

    const steeringAuthority =
      (1.35 + Math.min(this.speed / MAX_SPEED, 1) * 4.7) * grip;
    this.lateralVelocity += screenSteer * steeringAuthority * delta;
    this.lateralVelocity += crossWind * 0.017 * delta * (0.35 + this.speed / MAX_SPEED);
    this.lateralVelocity -= this.lateralVelocity * delta * (2.2 + grip * 1.5);
    this.lateral += this.lateralVelocity * delta;

    const limit = ROAD_HALF_WIDTH - 0.46;
    if (Math.abs(this.lateral) > limit) {
      this.lateral = THREE.MathUtils.clamp(this.lateral, -limit, limit);
      this.lateralVelocity *= -0.22;
      this.speed *= 0.988;
    }

    const leanTarget =
      screenSteer * (0.16 + Math.min(this.speed / MAX_SPEED, 1) * 0.34) +
      frame.curvature * 0.8 * Math.min(this.speed / MAX_SPEED, 1) ** 2 +
      crossWind * 0.0018;
    this.lean += (leanTarget - this.lean) * (1 - Math.exp(-delta * 6.5));

    const advance = this.speed * delta;
    const previous = this.progress;
    const next = this.progress + advance;
    if (next >= this.track.length) {
      this.progress = next - this.track.length;
      this.onLapComplete();
    } else {
      this.progress = next;
    }
    this.progress = this.track.wrap(this.progress);

    this.checkCollisions(previous, advance);

    if (this.comboTimer > 0) {
      this.comboTimer -= delta;
      if (this.comboTimer <= 0) this.combo = 1;
    }
    this.checkWeatherEvents(env, delta);
  }

  private checkCollisions(previous: number, advance: number): void {
    if (this.invulnerable > 0 || this.crashTimer > 0) return;
    const shell = this.items.collectNear(this.progress, this.lateral);
    if (shell) {
      this.shells += 1;
      this.combo = Math.min(9, this.combo + 1);
      this.comboTimer = 5.5;
      const points = 50 * this.combo;
      this.score += points;
      this.boostMeter = Math.min(1, this.boostMeter + 0.1);
      this.audio.shell(this.shells);
      this.hud.pushToast(`+${points} · 贝壳`, 'reward');
      this.cameraRig.addTrauma(0.05);
    }

    const hit =
      this.items.findHazardHit(this.progress, this.lateral) ??
      this.items.findHazardHit(
        this.track.wrap(previous + advance * 0.55),
        this.lateral,
      ) ??
      this.items.findHazardHit(previous, this.lateral);
    if (hit) this.triggerCrash();
  }

  private triggerCrash(): void {
    this.hearts -= 1;
    this.crashTimer = 1.05;
    this.invulnerable = 2.4;
    this.speed = Math.min(this.speed, 1.7);
    this.lateralVelocity = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.score = Math.max(0, this.score - 60);
    this.boostMeter = Math.max(0, this.boostMeter - 0.18);
    this.pendingGameOver = this.hearts <= 0;
    this.audio.crash();
    this.cameraRig.addTrauma(0.72);
    this.flashImpact(0.85);
    this.hud.pushToast(
      this.hearts > 0 ? '撞上了！小心路面障碍' : '体力耗尽',
      'warn',
    );
  }

  private finishAsCrashed(): void {
    this.showInterface();
    this.phase = 'crashed';
    this.speed = 0;
    this.pendingGameOver = false;
    this.bestScore = Math.max(this.bestScore, Math.round(this.score));
    this.saveBest(this.bestScore);
  }

  private onLapComplete(): void {
    const lapTime = this.elapsed - this.lapStart;
    this.lapTimes.push(lapTime);
    this.lapStart = this.elapsed;
    this.checkpointFlash = {
      title: this.lap >= TOTAL_LAPS ? 'FINISH' : `第 ${this.lap + 1} 圈`,
      split: formatSplit(lapTime),
    };
    this.checkpointFlashTimer = 3.6;
    if (this.lap >= TOTAL_LAPS) {
      this.finishRun();
      return;
    }
    this.lap += 1;
    this.score += 500;
    this.boostMeter = Math.min(1, this.boostMeter + 0.22);
    this.items.resetShells();
    this.audio.checkpoint();
    this.hud.pushToast(`分段 ${formatSplit(lapTime)} · 第 ${this.lap} 圈`, 'info');
    this.cameraRig.addTrauma(0.15);
  }

  private finishRun(): void {
    this.showInterface();
    this.phase = 'finished';
    this.speed = 0;
    this.score += 1000 + this.hearts * 250 + Math.round(this.boostMeter * 120);
    this.bestScore = Math.max(this.bestScore, Math.round(this.score));
    this.saveBest(this.bestScore);
    this.checkpointFlash = {
      title: '完成 · FINISH',
      split: formatSplit(this.elapsed),
    };
    this.checkpointFlashTimer = 5;
    this.audio.finish();
    this.flashImpact(0.4);
  }

  private updateRiderVisuals(delta: number, env: EnvironmentState): void {
    const screenSteer = -this.steerSmoothed;
    const speedRatio = THREE.MathUtils.clamp(this.speed / MAX_SPEED, 0, 1.25);
    this.riderState.speed = this.speed;
    this.riderState.speedRatio = speedRatio;
    this.riderState.steer = screenSteer;
    this.riderState.lean = this.lean;
    this.riderState.pedalling =
      this.phase === 'title'
        ? 0.12 + Math.sin(this.visualTime * 1.6) * 0.03
        : this.phase === 'playing' && this.crashTimer <= 0
          ? 0.12 + this.lastControls.throttle * (0.45 + speedRatio * 0.55)
          : 0;
    this.riderState.throttle = this.lastControls.throttle;
    this.riderState.brake = this.lastControls.brake;
    this.riderState.boost = this.boosting ? 1 : 0;
    this.riderState.daylight = env.daylight;
    this.riderState.lampIntensity = THREE.MathUtils.clamp(
      env.night * 1.1 + env.storm * 0.3,
      0,
      1,
    );
    this.riderState.windSpeed = env.windSpeed + env.gustSpeed;
    this.riderState.windBearing = Math.atan2(env.windDirection.y, env.windDirection.x);
    this.riderState.crashed = this.crashTimer > 0 || this.phase === 'crashed';
    this.riderState.elapsed = this.visualTime;
    this.riderState.reducedMotion = this.reducedMotion;
    this.headlamp.intensity =
      (env.night * 34 + env.storm * 7 + env.fogAmount * 5) * (this.phase === 'title' ? 0.5 : 1);
    this.rider.update(delta, this.riderState);
  }

  private applyRiderTransform(): void {
    const frame = this.track.frameAt(this.progress);
    this.rider.group.position
      .copy(frame.position)
      .addScaledVector(frame.right, this.lateral);
    this.rider.group.position.y = ROAD_Y + 0.012;
    const headingOffset =
      -this.steerSmoothed * 0.13 + this.lateralVelocity * 0.025;
    this.rider.group.rotation.y = frame.yaw + headingOffset;
    this.rider.group.rotation.z = -this.lean;
    this.rider.group.rotation.x = 0;
  }

  private refreshCamera(immediate: boolean, phase: GamePhase, delta: number): void {
    const frame = this.track.frameAt(this.progress);
    const heading = frame.yaw - this.steerSmoothed * 0.13;
    this.forward.set(Math.sin(heading), 0, Math.cos(heading));
    this.right.crossVectors(this.up, this.forward).normalize();
    this.cameraTarget.position.copy(this.rider.group.position);
    this.cameraTarget.forward.copy(this.forward);
    this.cameraTarget.right.copy(this.right);
    this.cameraTarget.speedRatio = THREE.MathUtils.clamp(this.speed / MAX_SPEED, 0, 1);
    this.cameraTarget.boost = this.boosting ? 1 : 0;
    this.cameraTarget.lean = this.lean;
    if (immediate) {
      this.cameraRig.snap(this.cameraTarget, phase, this.cameraMode);
    } else {
      this.cameraRig.update(
        this.reducedMotion ? 0 : delta,
        this.visualTime,
        this.cameraTarget,
        phase,
        this.cameraMode,
      );
    }
  }

  private readonly onCameraButtonClick = (event: Event) => {
    event.preventDefault();
    this.cycleCamera();
  };

  private cycleCamera(): void {
    const index = CAMERA_MODE_ORDER.indexOf(this.cameraMode);
    this.cameraMode = CAMERA_MODE_ORDER[(index + 1) % CAMERA_MODE_ORDER.length];
    this.rider.setFirstPerson(this.cameraMode === 'pelican');
    this.updateCameraButtonLabel();
    this.hud.pushToast(`视角 · ${CAMERA_MODE_LABELS[this.cameraMode]}`, 'info');
  }

  private readonly onRidePointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target !== this.canvas) return;
    if (this.phase !== 'playing') return;
    this.pointerSteerId = event.pointerId;
    this.pointerSteerStartX = event.clientX;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a progressive enhancement.
    }
    event.preventDefault();
  };

  private readonly onRidePointerMove = (event: PointerEvent) => {
    if (this.pointerSteerId !== event.pointerId) return;
    const span = Math.max(70, this.canvas.clientWidth * 0.1);
    const value = THREE.MathUtils.clamp((event.clientX - this.pointerSteerStartX) / span, -1, 1);
    this.input.setWheelSteer(value);
    event.preventDefault();
  };

  private readonly onRidePointerUp = (event: PointerEvent) => {
    if (this.pointerSteerId !== event.pointerId) return;
    this.pointerSteerId = null;
    this.input.setWheelSteer(0);
  };

  private toggleWings(): void {
    if (this.phase === 'title' || this.phase === 'crashed' || this.phase === 'finished') return;
    this.wingsOpen = !this.wingsOpen;
    this.rider.setWingsOpen(this.wingsOpen);
    this.audio.gust(this.wingsOpen ? 0.7 : 0.35);
    this.hud.pushToast(this.wingsOpen ? '展翅 · 海岸风穿过羽翼' : '收翅 · 继续骑行', 'reward');
  }

  private ringBell(): void {
    if (this.phase === 'title') return;
    this.audio.bell();
    this.hud.pushToast('叮铃 · 鹈鹕铃铛', 'reward');
  }

  private skipThreeHours(): void {
    if (this.phase === 'title' || this.phase === 'finished' || this.phase === 'crashed') return;
    this.environment.setTimeOfDay(this.environment.state.timeOfDay + 3 / 24);
    this.hud.pushToast('时间快进 3 小时', 'info');
  }

  private toggleInterface(): void {
    if (this.phase === 'title' || this.phase === 'crashed' || this.phase === 'finished') return;
    this.uiHidden = !this.uiHidden;
    this.hudRoot.classList.toggle('is-ui-hidden', this.uiHidden);
    if (!this.uiHidden) this.hud.pushToast('界面已恢复 · U', 'info');
  }

  private showInterface(): void {
    this.uiHidden = false;
    this.hudRoot.classList.remove('is-ui-hidden');
  }

  private updateCameraButtonLabel(): void {
    this.hudRoot.dataset.camera = this.cameraMode;
    if (!this.cameraButton) return;
    const label = CAMERA_MODE_LABELS[this.cameraMode];
    this.cameraButton.setAttribute('aria-label', `切换视角，当前${label}`);
    this.cameraButton.setAttribute('title', `切换视角 · ${label} (C)`);
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }

  private updateScenePulse(env: EnvironmentState, delta: number): void {
    this.pipeline.renderer.toneMappingExposure = THREE.MathUtils.clamp(
      env.exposure,
      0.65,
      1.35,
    );
    this.pipeline.bloom.strength =
      (window.matchMedia('(pointer: coarse)').matches ? 0.045 : 0.075) +
      env.night * 0.025 +
      env.flash * 0.18;
    if (env.flash > 0.5 && this.thunderCooldown <= 0) {
      this.thunderCooldown = 6;
      this.audio.thunder();
      this.flashImpact(0.22, '#dfe8ff');
    }
    this.thunderCooldown = Math.max(0, this.thunderCooldown - delta);
  }

  private checkWeatherEvents(env: EnvironmentState, delta: number): void {
    this.gustCooldown = Math.max(0, this.gustCooldown - delta);
    if (env.gustSpeed > 6.5 && this.lastGust <= 6.5 && this.gustCooldown <= 0) {
      this.gustCooldown = 7;
      this.audio.gust(1);
      this.cameraRig.addTrauma(0.16);
      this.hud.pushToast(
        `阵风 ${((env.windSpeed + env.gustSpeed) * 3.6).toFixed(0)} km/h · 抓稳`,
        'warn',
      );
    }
    this.lastGust = env.gustSpeed;
    if (env.weather !== this.lastWeather) {
      this.lastWeather = env.weather;
      this.hud.pushToast(`天气转为 ${env.weatherLabel}`, 'info');
    }
  }

  private buildSnapshot(): HudSnapshot {
    const env = this.environment.state;
    const bearing =
      ((Math.atan2(env.windDirection.x, -env.windDirection.y) * 180) / Math.PI + 360) %
      360;
    return {
      phase: this.phase,
      speedKmh: this.speed * 3.6,
      topSpeedKmh: MAX_SPEED * BOOST_MULTIPLIER * 3.6,
      steer: this.steerSmoothed,
      throttle: this.lastControls.throttle,
      brake: this.lastControls.brake,
      windKmh: (env.windSpeed + env.gustSpeed) * 3.6,
      gustKmh: env.gustSpeed * 3.6,
      windBearingDeg: bearing,
      weather: env.weather,
      weatherLabel: env.weatherLabel,
      clock: env.clock,
      dayPhaseLabel: this.environment.phaseLabel,
      dayProgress: env.timeOfDay,
      lap: this.lap,
      totalLaps: TOTAL_LAPS,
      distanceKm:
        (this.phase === 'finished'
          ? TOTAL_LAPS * this.track.length
          : (this.lap - 1) * this.track.length + this.progress) / 1000,
      lapDistanceKm: this.track.length / 1000,
      checkpointKm: Math.max(0, this.track.length - this.progress) / 1000,
      shells: this.shells,
      score: Math.round(this.score),
      hearts: Math.max(0, this.hearts),
      boost: this.boostMeter,
      combo: this.combo,
      bestScore: Math.max(this.bestScore, Math.round(this.score)),
      lapTime: formatClock(this.elapsed - this.lapStart),
      totalTime: formatClock(this.elapsed),
      muted: this.audio.isMuted,
      checkpointFlash: this.checkpointFlash,
    };
  }

  private startRun(): void {
    void this.audio.unlock();
    this.showInterface();
    this.rider.setFirstPerson(false);
    this.wingsOpen = false;
    this.rider.setWingsOpen(false);
    this.phase = 'playing';
    this.pausedForScreenshot = false;
    this.cameraMode = 'chase';
    this.updateCameraButtonLabel();
    this.elapsed = 0;
    this.speed = 0;
    this.progress = START_PROGRESS;
    this.lateral = START_LATERAL;
    this.lateralVelocity = 0;
    this.steerSmoothed = 0;
    this.lean = 0;
    this.lap = 1;
    this.lapStart = 0;
    this.lapTimes = [];
    this.hearts = 3;
    this.invulnerable = 0;
    this.crashTimer = 0;
    this.pendingGameOver = false;
    this.shells = 0;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.boostMeter = 0.72;
    this.boosting = false;
    this.wasBoosting = false;
    this.items.resetShells();
    this.environment.setWeather('clear', true);
    this.environment.setTimeOfDay(0.665);
    this.checkpointFlash = null;
    this.checkpointFlashTimer = 0;
    this.lastWeather = 'clear';
    this.lastGust = 0;
    this.input.setPaused(false);
    this.applyRiderTransform();
    this.updateRiderVisuals(0.016, this.environment.state);
    this.refreshCamera(true, 'playing', 0.016);
    this.audio.click();
    this.hud.pushToast('按住 W 蹬车 · A/D 或左右拖动转向 · Shift 冲刺', 'info');
    this.hud.update(this.buildSnapshot());
  }

  private resumeRun(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.input.setPaused(false);
    this.audio.click();
  }

  private togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.input.setPaused(true);
      this.audio.click();
    } else if (this.phase === 'paused') {
      this.resumeRun();
    }
  }

  private toggleMute(): void {
    const muted = this.audio.toggleMuted();
    this.hud.pushToast(muted ? '声音已关闭' : '声音已开启', 'info');
    this.hud.update(this.buildSnapshot());
  }

  private flashImpact(strength: number, color?: string): void {
    if (this.reducedMotion) return;
    this.impactFlash.style.background = color
      ? `radial-gradient(circle at 50% 40%, ${color}, rgba(8,24,30,0) 68%)`
      : 'radial-gradient(circle at 50% 54%, rgba(255,248,225,0.95), rgba(255,126,85,0.35) 42%, rgba(6,26,30,0) 74%)';
    this.impactFlash.animate(
      [{ opacity: '0' }, { opacity: String(strength) }, { opacity: '0' }],
      { duration: strength > 0.5 ? 300 : 220, easing: 'ease-out' },
    );
  }

  private resetRideState(): void {
    this.speed = 0;
    this.progress = START_PROGRESS;
    this.lateral = START_LATERAL;
    this.lateralVelocity = 0;
    this.lean = 0;
    this.steerSmoothed = 0;
    this.lap = 1;
    this.elapsed = 0;
    this.lapStart = 0;
  }

  private loadBest(): number {
    try {
      return Number.parseInt(localStorage.getItem('pelican-coast-best') ?? '0', 10) || 0;
    } catch {
      return 0;
    }
  }

  private saveBest(value: number): void {
    try {
      localStorage.setItem('pelican-coast-best', String(value));
    } catch {
      // Storage is optional.
    }
  }

  private prepareScenicState(): void {
    this.rider.setFirstPerson(false);
    this.wingsOpen = false;
    this.rider.setWingsOpen(false);
    this.phase = 'playing';
    this.elapsed = 36;
    this.progress = this.track.length * 0.155;
    this.lateral = 0.4;
    this.lateralVelocity = 0;
    this.steerSmoothed = 0;
    this.lean = -0.06;
    this.speed = 8.6;
    this.hearts = 3;
    this.crashTimer = 0;
    this.pendingGameOver = false;
    this.shells = 6;
    this.score = 1480;
    this.combo = 2;
    this.comboTimer = 4;
    this.boostMeter = 0.62;
    this.lap = 1;
    this.lastControls = { steer: 0.1, throttle: 1, brake: 0, boost: false };
    this.items.resetShells();
    this.checkpointFlash = null;
    this.checkpointFlashTimer = 0;
  }

  private finalizeCapture(phase: GamePhase, stateName: string): { state: string } {
    this.applyRiderTransform();
    this.refreshCamera(true, phase, 0);
    this.environment.update(0.016, 40, this.rider.group.position, this.camera.position);
    this.props.update(
      0.016,
      40,
      this.environment.state.windSpeed,
      this.environment.state.windDirection,
      this.environment.state.night,
      this.environment.state.storm,
    );
    this.road.update(0.016, 40, this.environment.state.windStrength);
    this.road.setWetness(
      this.environment.state.rain * 0.8 + this.environment.state.storm * 0.2,
    );
    this.weather.update(0.016, 40, this.camera.position, {
      rain: this.environment.state.rain,
      storm: this.environment.state.storm,
      flash: this.environment.state.flash,
      windSpeed:
        this.environment.state.windSpeed + this.environment.state.gustSpeed,
      windDirection: this.environment.state.windDirection,
    });
    this.updateRiderVisuals(0.016, this.environment.state);
    this.hud.update(this.buildSnapshot());
    this.render();
    return { state: stateName };
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        void value;
      },
      setState: (name: string) => {
        const known = [
          'title',
          'active-play',
          'day',
          'golden-hour',
          'rain',
          'storm',
          'night',
          'fog',
          'paused',
          'crashed',
          'finished',
          'camera-side',
          'camera-front',
          'camera-orbit',
          'camera-pelican',
          'wings-open',
        ];
        if (!known.includes(name)) throw new Error(`Unknown test state: ${name}`);
        this.pausedForScreenshot = false;
        this.prepareScenicState();
        this.environment.setWeather('clear', true);
        this.environment.setTimeOfDay(0.665);
        let phase: GamePhase = 'playing';

        if (name === 'title') {
          this.phase = 'title';
          phase = 'title';
          this.speed = 0;
          this.progress = START_PROGRESS;
          this.lateral = 0;
          this.render();
        } else if (name === 'day') {
          this.environment.setTimeOfDay(0.42);
        } else if (name === 'golden-hour') {
          this.environment.setTimeOfDay(0.665);
        } else if (name === 'rain') {
          this.environment.setWeather('rain', true);
        } else if (name === 'storm') {
          this.environment.setWeather('storm', true);
          this.environment.setTimeOfDay(0.58);
        } else if (name === 'night') {
          this.environment.setTimeOfDay(0.9);
        } else if (name === 'fog') {
          this.environment.setWeather('fog', true);
          this.environment.setTimeOfDay(0.54);
        } else if (name === 'camera-side') {
          this.cameraMode = 'side';
          this.updateCameraButtonLabel();
        } else if (name === 'camera-front') {
          this.cameraMode = 'front';
          this.updateCameraButtonLabel();
        } else if (name === 'camera-orbit') {
          this.cameraMode = 'orbit';
          this.updateCameraButtonLabel();
        } else if (name === 'camera-pelican') {
          this.cameraMode = 'pelican';
          this.rider.setFirstPerson(true);
          this.updateCameraButtonLabel();
        } else if (name === 'wings-open') {
          this.wingsOpen = true;
          this.rider.setWingsOpen(true);
        } else if (name === 'paused') {
          this.phase = 'paused';
          phase = 'paused';
        } else if (name === 'crashed') {
          this.hearts = 0;
          this.phase = 'crashed';
          phase = 'crashed';
          this.speed = 0;
        } else if (name === 'finished') {
          this.phase = 'finished';
          phase = 'finished';
          this.speed = 0;
          this.elapsed = 138.4;
          this.lap = TOTAL_LAPS;
          this.progress = 0;
          this.score = 4380;
          this.shells = 29;
          this.hearts = 2;
          this.lapTimes = [67.2, 71.2];
          this.checkpointFlash = { title: '完成 · FINISH', split: '2:18.4' };
          this.checkpointFlashTimer = 4;
        }

        if (name !== 'title' && name !== 'paused' && name !== 'crashed' && name !== 'finished') {
          this.phase = 'playing';
        }
        return this.finalizeCapture(phase, name);
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
        this.render();
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        this.rider.stabilizeVisuals?.();
        this.render();
      },
      hideDebugUi: () => {
        // No debug UI is shipped.
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.pipeline.renderer.info;
    const env = this.environment.state;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: Math.round(this.score),
      targetScore: 24,
      complete: this.phase === 'finished',
      player: {
        position: {
          x: this.rider.group.position.x,
          y: this.rider.group.position.y,
          z: this.rider.group.position.z,
        },
        speed: this.speed,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(
          window.devicePixelRatio || 1,
          window.matchMedia('(pointer: coarse)').matches ? 1.8 : 2,
        ),
      },
      phase: this.phase,
      weather: env.weather,
      windKmh: (env.windSpeed + env.gustSpeed) * 3.6,
      speedKmh: this.speed * 3.6,
      hearts: this.hearts,
      lap: this.lap,
      shells: this.shells,
    };
  }
}
