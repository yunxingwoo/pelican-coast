import '../src/styles.css';
import { Hud } from '../src/ui/Hud';
import type { GamePhase, HudActions, HudSnapshot, WeatherKind } from '../src/types';

/**
 * Isolated HUD preview harness.
 *
 * Loads the real authored markup from /index.html (single source of truth),
 * mounts the real Hud controller, and feeds it deterministic snapshots so the
 * UI can be screenshotted and exercised without booting the 3D game.
 *
 * Query params:
 *   ?phase=title|playing|paused|crashed|finished
 *   ?weather=clear|cloudy|rain|storm|fog
 *   ?muted=1
 *   ?flash=1        show a checkpoint banner
 *   ?toasts=all     queue info + warn + reward toasts (or info|warn|reward)
 */

type ToastTone = 'info' | 'warn' | 'reward';

interface ActionLogEntry {
  name: string;
  value?: number | boolean;
}

interface PreviewApi {
  setPhase(phase: GamePhase): void;
  getSnapshot(): HudSnapshot;
  update(): void;
  pushToast(message: string, tone?: ToastTone): void;
  flashCheckpoint(title: string, split: string): void;
  getLog(): readonly ActionLogEntry[];
}

const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: 'CLEAR · 晴',
  cloudy: 'CLOUDY · 多云',
  rain: 'RAIN · 细雨',
  storm: 'STORM · 风暴',
  fog: 'FOG · 海雾',
};

const DAY_LABELS = ['黎明 · DAWN', '清晨 · MORNING', '正午 · NOON', '午后 · AFTERNOON', '黄金时刻 · GOLDEN HOUR', '黄昏 · DUSK', '夜晚 · NIGHT'];

function param(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function baseSnapshot(): HudSnapshot {
  return {
    phase: 'playing',
    speedKmh: 42,
    topSpeedKmh: 62,
    steer: 0.18,
    throttle: 1,
    brake: 0,
    windKmh: 18,
    gustKmh: 32,
    windBearingDeg: 58,
    weather: 'clear',
    weatherLabel: WEATHER_LABELS.clear,
    clock: '18:42',
    dayPhaseLabel: DAY_LABELS[4] ?? '黄金时刻 · GOLDEN HOUR',
    dayProgress: 0.78,
    lap: 2,
    totalLaps: 3,
    distanceKm: 3.6,
    lapDistanceKm: 4.2,
    checkpointKm: 0.42,
    shells: 7,
    score: 12480,
    hearts: 2,
    boost: 0.42,
    combo: 3,
    bestScore: 18920,
    lapTime: '01:24.6',
    totalTime: '04:12.8',
    muted: false,
    checkpointFlash: null,
  };
}

function snapshotForPhase(phase: GamePhase): HudSnapshot {
  const snapshot = baseSnapshot();
  snapshot.phase = phase;

  switch (phase) {
    case 'title':
      snapshot.speedKmh = 0;
      snapshot.topSpeedKmh = 62;
      snapshot.steer = 0;
      snapshot.throttle = 0;
      snapshot.brake = 0;
      snapshot.boost = 0;
      snapshot.combo = 0;
      snapshot.hearts = 3;
      snapshot.shells = 0;
      snapshot.score = 0;
      snapshot.lap = 1;
      snapshot.distanceKm = 0;
      snapshot.checkpointKm = 4.2;
      snapshot.lapTime = '00:00.0';
      snapshot.totalTime = '00:00.0';
      break;
    case 'paused':
      snapshot.speedKmh = 21;
      snapshot.throttle = 0;
      snapshot.brake = 0;
      snapshot.steer = 0;
      break;
    case 'crashed':
      snapshot.speedKmh = 0;
      snapshot.throttle = 0;
      snapshot.brake = 0;
      snapshot.steer = 0;
      snapshot.hearts = 0;
      snapshot.combo = 0;
      snapshot.boost = 0;
      snapshot.shells = 4;
      snapshot.score = 6840;
      snapshot.distanceKm = 2.1;
      snapshot.checkpointKm = 1.9;
      snapshot.lapTime = '00:48.2';
      snapshot.totalTime = '02:06.4';
      break;
    case 'finished':
      snapshot.speedKmh = 0;
      snapshot.topSpeedKmh = 62;
      snapshot.throttle = 0;
      snapshot.brake = 0;
      snapshot.steer = 0;
      snapshot.boost = 0;
      snapshot.combo = 0;
      snapshot.hearts = 1;
      snapshot.shells = 17;
      snapshot.score = 26340;
      snapshot.bestScore = 26340;
      snapshot.distanceKm = 12.6;
      snapshot.checkpointKm = 0;
      snapshot.lap = 3;
      snapshot.lapTime = '02:48.7';
      snapshot.totalTime = '08:36.2';
      break;
    default:
      break;
  }

  const weather = param('weather') as WeatherKind | null;
  if (weather && weather in WEATHER_LABELS) {
    snapshot.weather = weather;
    snapshot.weatherLabel = WEATHER_LABELS[weather];
    snapshot.dayProgress = weather === 'fog' ? 0.28 : weather === 'storm' ? 0.55 : snapshot.dayProgress;
    if (weather === 'fog') snapshot.dayPhaseLabel = '海雾低垂 · FOG BANK';
    if (weather === 'storm') snapshot.dayPhaseLabel = '风暴过境 · SQUALL';
  }

  if (param('muted') === '1') snapshot.muted = true;

  return snapshot;
}

async function mountHud(): Promise<void> {
  const response = await fetch('/index.html', { cache: 'no-store' });
  if (!response.ok) throw new Error(`ui-preview: could not load /index.html (${response.status})`);

  const html = await response.text();
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const hudRoot = parsed.getElementById('hud-root');
  if (!hudRoot) throw new Error('ui-preview: #hud-root was not found in index.html');

  const host = document.getElementById('preview-host');
  if (!host) throw new Error('ui-preview: missing #preview-host');
  host.append(document.importNode(hudRoot, true));

  const phaseParam = param('phase');
  const knownPhases: GamePhase[] = ['title', 'playing', 'paused', 'crashed', 'finished'];
  const initialPhase = knownPhases.includes(phaseParam as GamePhase) ? (phaseParam as GamePhase) : 'playing';

  let snapshot = snapshotForPhase(initialPhase);
  const actionLog: ActionLogEntry[] = [];

  const record = (name: string, value?: number | boolean): void => {
    actionLog.push(value === undefined ? { name } : { name, value });
    if (actionLog.length > 200) actionLog.shift();
  };

  const badge = document.getElementById('preview-badge');
  if (badge && param('badge') === '1') badge.style.display = 'block';
  const setBadge = (phase: GamePhase): void => {
    if (badge) badge.textContent = `UI Preview · ${phase}`;
  };

  const actions: HudActions = {
    onStart: () => {
      record('onStart');
      snapshot = snapshotForPhase('playing');
      setBadge(snapshot.phase);
      hud.update(snapshot);
    },
    onResume: () => {
      record('onResume');
      snapshot.phase = 'playing';
      setBadge(snapshot.phase);
      hud.update(snapshot);
    },
    onRestart: () => {
      record('onRestart');
      snapshot = snapshotForPhase('playing');
      setBadge(snapshot.phase);
      hud.update(snapshot);
    },
    onPause: () => {
      record('onPause');
      snapshot.phase = 'paused';
      setBadge(snapshot.phase);
      hud.update(snapshot);
    },
    onToggleSound: () => {
      record('onToggleSound');
      snapshot.muted = !snapshot.muted;
      hud.update(snapshot);
    },
    onSteer: (value: number) => {
      record('onSteer', value);
      snapshot.steer = value;
      hud.update(snapshot);
    },
    onSteerEnd: () => {
      record('onSteerEnd');
      snapshot.steer = 0;
      hud.update(snapshot);
    },
    onThrottle: (value: number) => {
      record('onThrottle', value);
      snapshot.throttle = value;
      hud.update(snapshot);
    },
    onBrake: (value: number) => {
      record('onBrake', value);
      snapshot.brake = value;
      hud.update(snapshot);
    },
    onBoost: (pressed: boolean) => {
      record('onBoost', pressed);
      snapshot.boost = pressed ? 1 : 0.42;
      hud.update(snapshot);
    },
  };

  const hud = new Hud(actions);
  setBadge(snapshot.phase);
  hud.update(snapshot);

  if (param('flash') === '1') {
    snapshot.checkpointFlash = { title: 'CHECKPOINT 02 · 灯塔坡', split: '01:24.6' };
    hud.update(snapshot);
  }

  const toastParam = param('toasts');
  if (toastParam) {
    const wanted: ToastTone[] =
      toastParam === 'all' ? ['info', 'warn', 'reward'] : [toastParam as ToastTone];
    const queue: Record<ToastTone, [string, ToastTone]> = {
      info: ['尾风增强 · 阵风 +12 km/h', 'info'],
      warn: ['海雾正在上岸 · 留意前方弯道', 'warn'],
      reward: ['贝壳 ×3 · 连击加成', 'reward'],
    };
    wanted.forEach((tone, index) => {
      const entry = queue[tone];
      if (!entry) return;
      window.setTimeout(() => hud.pushToast(entry[0], entry[1]), 90 + index * 60);
    });
  }

  const api: PreviewApi = {
    setPhase: (phase: GamePhase) => {
      snapshot = snapshotForPhase(phase);
      setBadge(phase);
      hud.update(snapshot);
    },
    getSnapshot: () => snapshot,
    update: () => hud.update(snapshot),
    pushToast: (message: string, tone?: ToastTone) => hud.pushToast(message, tone),
    flashCheckpoint: (title: string, split: string) => {
      snapshot.checkpointFlash = { title, split };
      hud.update(snapshot);
      window.setTimeout(() => {
        snapshot.checkpointFlash = null;
        hud.update(snapshot);
      }, 2200);
    },
    getLog: () => actionLog,
  };

  window.__hudPreview = api;
}

declare global {
  interface Window {
    __hudPreview?: PreviewApi;
  }
}

mountHud().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const failure = document.createElement('pre');
  failure.style.cssText =
    'position:fixed;inset:24px auto auto 24px;z-index:1000;max-width:80vw;padding:16px;color:#ffb3a1;background:#1a0d0b;border:1px solid #ff6b4a;font:12px/1.6 monospace;white-space:pre-wrap';
  failure.textContent = `UI preview failed:\n${message}`;
  document.body.append(failure);
  console.error(error);
});
