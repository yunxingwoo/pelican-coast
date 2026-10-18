import type * as THREE from 'three';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';
export type GamePhase = 'title' | 'playing' | 'paused' | 'crashed' | 'finished';

/**
 * Everything the hero rig needs to animate. The rider's root transform is owned
 * by the game; this state only drives pose, wheels, cloth, lamp and camera-facing
 * cues. All angles are radians, forward is local +Z, ground contact is y = 0.
 */
export interface RiderVisualState {
  /** Forward speed in metres per second. */
  speed: number;
  /** Normalised speed 0..1 (relative to top speed). */
  speedRatio: number;
  /** Smoothed steering input, -1 (left) .. +1 (right). */
  steer: number;
  /** Body lean target in radians, positive leans right. */
  lean: number;
  /** Pedalling cadence 0..1. */
  pedalling: number;
  /** Throttle input 0..1. */
  throttle: number;
  /** Brake input 0..1. */
  brake: number;
  /** Boost/tailwind surge 0..1. */
  boost: number;
  /** 0 = night, 1 = full daylight. */
  daylight: number;
  /** Bike lamp intensity 0..1. */
  lampIntensity: number;
  /** Wind speed in metres per second (world space). */
  windSpeed: number;
  /** Wind bearing in radians, world space. */
  windBearing: number;
  /** Whether the rider is currently recovering from a crash. */
  crashed: boolean;
  /** Deterministic elapsed animation time. */
  elapsed: number;
  /** Accessibility: freeze secondary ambient motion. */
  reducedMotion: boolean;
}

/** Contract implemented by the authored pelican + bicycle hero. */
export interface RiderRig {
  readonly group: THREE.Group;
  /** Approximate visual bounds used for camera framing. */
  readonly height: number;
  update(delta: number, state: RiderVisualState): void;
  /** Optional hook when the run resets. */
  reset?(): void;
  /** Freeze ambient motion for deterministic screenshots. */
  stabilizeVisuals?(): void;
  dispose?(): void;
}

export interface HudSnapshot {
  phase: GamePhase;
  speedKmh: number;
  topSpeedKmh: number;
  steer: number;
  throttle: number;
  brake: number;
  windKmh: number;
  gustKmh: number;
  /** Direction the wind is blowing toward, compass degrees (0 = north). */
  windBearingDeg: number;
  weather: WeatherKind;
  weatherLabel: string;
  /** Local clock label, e.g. 18:42. */
  clock: string;
  /** e.g. 黄昏 / 黄金时刻. */
  dayPhaseLabel: string;
  /** 0..1 through the full day. */
  dayProgress: number;
  lap: number;
  totalLaps: number;
  distanceKm: number;
  lapDistanceKm: number;
  checkpointKm: number;
  shells: number;
  score: number;
  hearts: number;
  boost: number;
  combo: number;
  bestScore: number;
  lapTime: string;
  totalTime: string;
  muted: boolean;
  checkpointFlash?: { title: string; split: string } | null;
}

/** Intents emitted by the HUD / steering wheel. Game writes state, UI reads it. */
export interface HudActions {
  onStart(): void;
  onResume(): void;
  onRestart(): void;
  onPause(): void;
  onToggleSound(): void;
  onSteer(value: number): void;
  onSteerEnd(): void;
  onThrottle(value: number): void;
  onBrake(value: number): void;
  onBoost(pressed: boolean): void;
}
