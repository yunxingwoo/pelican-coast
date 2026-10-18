import type { GamePhase, HudActions, HudSnapshot, WeatherKind } from '../types';

/**
 * HUD controller for Pelican Coast.
 *
 * The game owns all simulation state; this class only mirrors one HudSnapshot
 * per frame into the pre-authored DOM (scoped to #hud-root) and forwards player
 * intents through HudActions. Every element lookup is guarded with a clear
 * error so a broken index.html fails loudly instead of silently dropping input.
 *
 * Performance contract: element references are cached, textContent is only
 * written when the rendered string changes, and gauges/needles/arcs use
 * transforms / SVG attributes instead of layout-affecting properties.
 */

type ToastTone = 'info' | 'warn' | 'reward';
type ClaimedInput = 'throttle' | 'brake' | 'boost';

const SVG_NS = 'http://www.w3.org/2000/svg';

const WEATHER_ICON: Record<WeatherKind, string> = {
  clear: '#ico-sun',
  cloudy: '#ico-cloud',
  rain: '#ico-rain',
  storm: '#ico-storm',
  fog: '#ico-fog',
};

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

const MAX_HEARTS = 3;
const GAUGE_START_DEG = 135;
const GAUGE_SWEEP_DEG = 270;
const WHEEL_LOCK_DEG = 138;
const DAY_TRACK_PX = 26;
const MAX_TOASTS = 3;
const TOAST_LIFETIME_MS = 2600;
const TOAST_EXIT_MS = 260;
const BANNER_LIFETIME_MS = 2000;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function pad2(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  return rounded < 10 ? `0${rounded}` : String(rounded);
}

function compassPoint(bearing: number): string {
  const index = Math.round(bearing / 45) % COMPASS_POINTS.length;
  return COMPASS_POINTS[(index + COMPASS_POINTS.length) % COMPASS_POINTS.length] ?? 'N';
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly actions: HudActions;
  private readonly abort = new AbortController();
  private readonly textCache = new Map<Element, string>();
  private readonly intCache = new Map<Element, number>();
  private readonly integerFormat = new Intl.NumberFormat('en-US');

  // Top-left cluster.
  private readonly lapValue: HTMLElement;
  private readonly lapTotal: HTMLElement;
  private readonly rideTime: HTMLElement;
  private readonly lapTime: HTMLElement;
  private readonly cpBar: HTMLElement;
  private readonly cpFill: HTMLElement;
  private readonly cpDist: HTMLElement;
  private readonly shellValue: HTMLElement;
  private readonly scoreValue: HTMLElement;

  // Top-right cluster.
  private readonly weatherIcon: SVGUseElement;
  private readonly weatherLabel: HTMLElement;
  private readonly dayLabel: HTMLElement;
  private readonly clockValue: HTMLElement;
  private readonly dayDot: HTMLElement;
  private readonly windNeedle: HTMLElement;
  private readonly windValue: HTMLElement;
  private readonly gustValue: HTMLElement;
  private readonly windDir: HTMLElement;
  private readonly soundButtons: HTMLButtonElement[];
  private readonly pauseButton: HTMLButtonElement;

  // Speedometer.
  private readonly speedNeedle: SVGGElement;
  private readonly speedValue: HTMLElement;
  private readonly boostValue: HTMLElement;
  private readonly speedArc: SVGPathElement;
  private readonly boostArc: SVGPathElement;
  private readonly speedTicks: SVGGElement;
  private readonly speedLabels: SVGGElement;
  private readonly speedMaxMark: SVGGElement;

  // Bottom-left cluster.
  private readonly heartsRoot: HTMLElement;
  private readonly heartEls: SVGElement[];
  private readonly comboRoot: HTMLElement;
  private readonly comboValue: HTMLElement;
  private readonly bestValue: HTMLElement;

  // Controls.
  private readonly wheel: HTMLElement;
  private readonly wheelRotor: SVGGElement;
  private readonly pedalPad: HTMLButtonElement;
  private readonly brakePad: HTMLButtonElement;
  private readonly boostPad: HTMLButtonElement;

  // Centre feedback + screens.
  private readonly toastsEl: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerTitle: HTMLElement;
  private readonly bannerSplit: HTMLElement;
  private readonly titleBest: HTMLElement;
  private readonly pauseLap: HTMLElement;
  private readonly pauseLapTotal: HTMLElement;
  private readonly pauseTime: HTMLElement;
  private readonly pauseShells: HTMLElement;
  private readonly pauseScore: HTMLElement;
  private readonly crashDistance: HTMLElement;
  private readonly crashShells: HTMLElement;
  private readonly crashScore: HTMLElement;
  private readonly finishSub: HTMLElement;
  private readonly finishLapTime: HTMLElement;
  private readonly finishTotalTime: HTMLElement;
  private readonly finishDistance: HTMLElement;
  private readonly finishShells: HTMLElement;
  private readonly finishScore: HTMLElement;
  private readonly finishBest: HTMLElement;

  private phase: GamePhase = 'title';
  private steerVisual = 0;
  private dragging = false;
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartSteer = 0;
  private dragSpan = 120;
  private lastEmittedSteer = 0;
  private keySteerActive = false;
  private readonly heldInputs = new Set<ClaimedInput>();
  private readonly timers = new Set<number>();
  private bannerTimer: number | null = null;
  private readonly reducedMotion: boolean;

  // Change detectors (avoid redundant DOM writes every frame).
  private lastCpProgress = -1;
  private lastHearts = -1;
  private lastCombo = -1;
  private lastMuted: boolean | null = null;
  private lastPauseDisabled: boolean | null = null;
  private lastWeatherIcon = '';
  private lastFlashKey = '';
  private gaugeScale = 0;
  private lastNeedleDeg = Number.NaN;
  private lastMaxDeg = Number.NaN;
  private lastSpeedArc = -1;
  private lastBoostArc = -1;
  private lastBoostPct = -1;
  private lastWindBearing = Number.NaN;
  private lastDayX = Number.NaN;
  private lastWheelDeg = Number.NaN;
  private lastThrottleSeen = false;
  private lastBrakeSeen = false;
  private lastBoostSeen = false;
  private lastFinishLaps = -1;

  constructor(actions: HudActions) {
    this.actions = actions;

    const root = document.getElementById('hud-root');
    if (!root) {
      throw new Error('Hud: missing #hud-root. index.html must contain the complete HUD markup.');
    }
    this.root = root;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.lapValue = this.find('#lap-value');
    this.lapTotal = this.find('#lap-total');
    this.rideTime = this.find('#ride-time');
    this.lapTime = this.find('#lap-time');
    this.cpBar = this.find('.cp-bar');
    this.cpFill = this.find('#cp-fill');
    this.cpDist = this.find('#cp-dist');
    this.shellValue = this.find('#shell-value');
    this.scoreValue = this.find('#score-value');

    this.weatherIcon = this.find<SVGUseElement>('#wx-icon');
    this.weatherLabel = this.find('#weather-label');
    this.dayLabel = this.find('#day-label');
    this.clockValue = this.find('#clock-value');
    this.dayDot = this.find('#day-dot');
    this.windNeedle = this.find('#wind-needle');
    this.windValue = this.find('#wind-value');
    this.gustValue = this.find('#gust-value');
    this.windDir = this.find('#wind-dir');
    this.soundButtons = this.findAll<HTMLButtonElement>('[data-action="sound"]');
    this.pauseButton = this.find<HTMLButtonElement>('#pause-button');

    this.speedNeedle = this.find<SVGGElement>('#speed-needle');
    this.speedValue = this.find('#speed-value');
    this.boostValue = this.find('#boost-value');
    this.speedArc = this.find<SVGPathElement>('#speed-arc');
    this.boostArc = this.find<SVGPathElement>('#boost-arc');
    this.speedTicks = this.find<SVGGElement>('#speed-ticks');
    this.speedLabels = this.find<SVGGElement>('#speed-labels');
    this.speedMaxMark = this.find<SVGGElement>('#speed-max-mark');

    this.heartsRoot = this.find('#hearts');
    this.heartEls = this.findAll<SVGElement>('.heart');
    if (this.heartEls.length !== MAX_HEARTS) {
      throw new Error(`Hud: expected ${MAX_HEARTS} heart elements, found ${this.heartEls.length}.`);
    }
    this.comboRoot = this.find('#combo');
    this.comboValue = this.find('#combo-value');
    this.bestValue = this.find('#best-value');

    this.wheel = this.find('#steering-wheel');
    this.wheelRotor = this.find<SVGGElement>('#wheel-rotor');
    this.pedalPad = this.find<HTMLButtonElement>('#pedal-pad');
    this.brakePad = this.find<HTMLButtonElement>('#brake-pad');
    this.boostPad = this.find<HTMLButtonElement>('#boost-pad');

    this.toastsEl = this.find('#toasts');
    this.banner = this.find('#checkpoint-banner');
    this.bannerTitle = this.find('#checkpoint-title');
    this.bannerSplit = this.find('#checkpoint-split');
    this.titleBest = this.find('#title-best');
    this.pauseLap = this.find('#pause-lap');
    this.pauseLapTotal = this.find('#pause-lap-total');
    this.pauseTime = this.find('#pause-time');
    this.pauseShells = this.find('#pause-shells');
    this.pauseScore = this.find('#pause-score');
    this.crashDistance = this.find('#crash-distance');
    this.crashShells = this.find('#crash-shells');
    this.crashScore = this.find('#crash-score');
    this.finishSub = this.find('#finish-sub');
    this.finishLapTime = this.find('#finish-lap-time');
    this.finishTotalTime = this.find('#finish-total-time');
    this.finishDistance = this.find('#finish-distance');
    this.finishShells = this.find('#finish-shells');
    this.finishScore = this.find('#finish-score');
    this.finishBest = this.find('#finish-best');

    const trackPath = this.arcPath(120, 120, 100, GAUGE_START_DEG, GAUGE_SWEEP_DEG);
    this.find<SVGPathElement>('#speedo-track').setAttribute('d', trackPath);
    this.speedArc.setAttribute('d', trackPath);
    this.boostArc.setAttribute('d', this.arcPath(120, 120, 110, GAUGE_START_DEG, GAUGE_SWEEP_DEG));

    this.bindButtons();
    this.bindWheel();
    this.bindPad(this.pedalPad, 'throttle');
    this.bindPad(this.brakePad, 'brake');
    this.bindPad(this.boostPad, 'boost');
    this.bindGlobalSafety();

    this.applyHearts(MAX_HEARTS);
    this.applySound(false);
    this.renderSteer();
  }

  /** Mirror one game-frame snapshot into the HUD. */
  update(snapshot: HudSnapshot): void {
    const phaseChanged = snapshot.phase !== this.phase;
    if (phaseChanged) {
      this.phase = snapshot.phase;
      this.root.dataset.phase = snapshot.phase;
      this.onPhaseChanged(snapshot.phase);
    }

    // ── Lap / timing ────────────────────────────────────────────────────
    const totalLaps = Math.max(1, Math.round(snapshot.totalLaps));
    const lap = clamp(Math.round(snapshot.lap) || 1, 1, totalLaps);
    this.text(this.lapValue, pad2(lap));
    this.text(this.lapTotal, pad2(totalLaps));
    this.text(this.rideTime, snapshot.totalTime);
    this.text(this.lapTime, snapshot.lapTime);
    this.text(this.pauseLap, pad2(lap));
    this.text(this.pauseLapTotal, pad2(totalLaps));
    this.text(this.pauseTime, snapshot.totalTime);
    this.intText(this.pauseShells, snapshot.shells);
    this.intText(this.pauseScore, snapshot.score);

    // ── Checkpoint progress ─────────────────────────────────────────────
    const lapDistance = Number.isFinite(snapshot.lapDistanceKm) ? snapshot.lapDistanceKm : 0;
    const checkpointDistance = Number.isFinite(snapshot.checkpointKm) ? snapshot.checkpointKm : 0;
    const cpProgress = lapDistance > 0 ? clamp01(1 - checkpointDistance / lapDistance) : 0;
    if (Math.abs(cpProgress - this.lastCpProgress) > 0.002) {
      this.lastCpProgress = cpProgress;
      this.cpFill.style.transform = `scaleX(${cpProgress.toFixed(4)})`;
      this.cpBar.setAttribute('aria-valuenow', String(Math.round(cpProgress * 100)));
    }
    this.text(this.cpDist, clamp(checkpointDistance, 0, Number.MAX_SAFE_INTEGER).toFixed(2));
    this.intText(this.shellValue, snapshot.shells);
    this.intText(this.scoreValue, snapshot.score);
    this.intText(this.bestValue, snapshot.bestScore);
    this.intText(this.titleBest, snapshot.bestScore);

    // ── Weather / clock / wind ──────────────────────────────────────────
    const icon = WEATHER_ICON[snapshot.weather] ?? WEATHER_ICON.clear;
    if (icon !== this.lastWeatherIcon) {
      this.lastWeatherIcon = icon;
      this.weatherIcon.setAttribute('href', icon);
    }
    this.text(this.weatherLabel, snapshot.weatherLabel);
    this.text(this.dayLabel, snapshot.dayPhaseLabel);
    this.text(this.clockValue, snapshot.clock);

    const dayX = clamp01(snapshot.dayProgress) * DAY_TRACK_PX;
    if (!Number.isFinite(this.lastDayX) || Math.abs(dayX - this.lastDayX) > 0.35) {
      this.lastDayX = dayX;
      this.dayDot.style.transform = `translateX(${dayX.toFixed(1)}px)`;
    }

    const rawBearing = Number.isFinite(snapshot.windBearingDeg) ? snapshot.windBearingDeg : 0;
    const bearing = ((rawBearing % 360) + 360) % 360;
    if (!Number.isFinite(this.lastWindBearing) || Math.abs(bearing - this.lastWindBearing) > 0.25) {
      this.lastWindBearing = bearing;
      this.windNeedle.style.transform = `translate(-50%, -100%) rotate(${bearing.toFixed(1)}deg)`;
      const bearingLabel = String(Math.round(bearing)).padStart(3, '0');
      this.text(this.windDir, `${compassPoint(bearing)} ${bearingLabel}\u00b0`);
    }
    this.text(this.windValue, String(Math.max(0, Math.round(snapshot.windKmh))));
    this.text(this.gustValue, String(Math.max(0, Math.round(snapshot.gustKmh))));

    // ── Speedometer ─────────────────────────────────────────────────────
    const scale = this.gaugeScaleFor(snapshot.topSpeedKmh);
    if (scale !== this.gaugeScale) {
      this.gaugeScale = scale;
      this.buildGauge(scale);
      this.lastNeedleDeg = Number.NaN;
      this.lastMaxDeg = Number.NaN;
    }
    const speedRatio = clamp01(snapshot.speedKmh / scale);
    const needleDeg = GAUGE_START_DEG + GAUGE_SWEEP_DEG * speedRatio;
    if (!Number.isFinite(this.lastNeedleDeg) || Math.abs(needleDeg - this.lastNeedleDeg) > 0.15) {
      this.lastNeedleDeg = needleDeg;
      this.speedNeedle.setAttribute('transform', `rotate(${needleDeg.toFixed(1)} 120 120)`);
    }
    const maxDeg =
      GAUGE_START_DEG + GAUGE_SWEEP_DEG * clamp01(snapshot.topSpeedKmh / scale) - 270;
    if (!Number.isFinite(this.lastMaxDeg) || Math.abs(maxDeg - this.lastMaxDeg) > 0.2) {
      this.lastMaxDeg = maxDeg;
      this.speedMaxMark.setAttribute('transform', `rotate(${maxDeg.toFixed(1)} 120 120)`);
    }
    this.text(this.speedValue, String(Math.max(0, Math.round(snapshot.speedKmh))));
    this.setArcProgress(this.speedArc, speedRatio, 'speed');
    const boost = clamp01(snapshot.boost);
    this.setArcProgress(this.boostArc, boost, 'boost');
    const boostPct = Math.round(boost * 100);
    if (boostPct !== this.lastBoostPct) {
      this.lastBoostPct = boostPct;
      this.text(this.boostValue, `${boostPct}%`);
    }

    // ── Bottom-left cluster ─────────────────────────────────────────────
    const hearts = clamp(Math.round(snapshot.hearts), 0, MAX_HEARTS);
    if (hearts !== this.lastHearts) {
      this.applyHearts(hearts);
      this.lastHearts = hearts;
    }
    const combo = Math.max(0, Math.round(snapshot.combo));
    if (combo !== this.lastCombo) {
      const increased = combo > this.lastCombo;
      this.lastCombo = combo;
      this.text(this.comboValue, String(combo));
      this.comboRoot.classList.toggle('is-idle', combo < 2);
      if (increased && combo >= 2) this.popCombo();
    }

    // ── Control surfaces echo live input (keyboard or touch) ────────────
    const throttleSeen = snapshot.throttle > 0.05;
    if (throttleSeen !== this.lastThrottleSeen) {
      this.lastThrottleSeen = throttleSeen;
      this.pedalPad.classList.toggle('is-active', throttleSeen);
    }
    const brakeSeen = snapshot.brake > 0.05;
    if (brakeSeen !== this.lastBrakeSeen) {
      this.lastBrakeSeen = brakeSeen;
      this.brakePad.classList.toggle('is-active', brakeSeen);
    }
    const boostSeen = boost > 0.6;
    if (boostSeen !== this.lastBoostSeen) {
      this.lastBoostSeen = boostSeen;
      this.boostPad.classList.toggle('is-active', boostSeen);
    }
    this.setSteerAngle(snapshot.steer);

    // ── Audio / pause affordances ───────────────────────────────────────
    if (snapshot.muted !== this.lastMuted) {
      this.applySound(snapshot.muted);
    }
    const pauseDisabled = snapshot.phase !== 'playing';
    if (pauseDisabled !== this.lastPauseDisabled) {
      this.lastPauseDisabled = pauseDisabled;
      this.pauseButton.disabled = pauseDisabled;
    }

    // ── Screens: crash / finish stats ───────────────────────────────────
    const distanceLabel = (Number.isFinite(snapshot.distanceKm) ? snapshot.distanceKm : 0).toFixed(1);
    this.text(this.crashDistance, distanceLabel);
    this.intText(this.crashShells, snapshot.shells);
    this.intText(this.crashScore, snapshot.score);
    this.text(this.finishLapTime, snapshot.lapTime);
    this.text(this.finishTotalTime, snapshot.totalTime);
    this.text(this.finishDistance, distanceLabel);
    this.intText(this.finishShells, snapshot.shells);
    this.intText(this.finishScore, snapshot.score);
    this.intText(this.finishBest, Math.max(snapshot.bestScore, snapshot.score));
    if (totalLaps !== this.lastFinishLaps) {
      this.lastFinishLaps = totalLaps;
      this.text(
        this.finishSub,
        `LAPS ${pad2(totalLaps)}/${pad2(totalLaps)} — 这条海岸线被你骑成了一张明信片。`,
      );
    }

    // ── Checkpoint banner (edition on null -> object transitions) ───────
    const flash = snapshot.phase === 'playing' ? (snapshot.checkpointFlash ?? null) : null;
    if (flash && flash.title) {
      const key = `${flash.title}\u0000${flash.split}`;
      if (key !== this.lastFlashKey) {
        this.lastFlashKey = key;
        this.showCheckpoint(flash.title, flash.split);
      }
    } else if (this.lastFlashKey !== '') {
      this.lastFlashKey = '';
      this.hideCheckpoint();
    }
  }

  /**
   * Visually follow the game's steering value, normalised -1 (left) .. +1 (right).
   * Ignored while the player is dragging the wheel, so the pointer stays in
   * charge until release.
   */
  setSteerAngle(angle: number): void {
    if (this.dragging || this.keySteerActive) return;
    this.steerVisual = clamp(Number.isFinite(angle) ? angle : 0, -1, 1);
    this.renderSteer();
  }

  /** Queue a transient centre-screen message. Queue is capped at three. */
  pushToast(message: string, tone: ToastTone = 'info'): void {
    if (!message) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${tone}`;
    toast.setAttribute('role', 'status');

    const tick = document.createElement('i');
    tick.className = 'toast-tick';
    tick.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = message;

    toast.append(tick, label);
    this.toastsEl.append(toast);

    const live = this.toastsEl.querySelectorAll('.toast');
    if (live.length > MAX_TOASTS) {
      live[0]?.remove();
    }

    const removeTimer = window.setTimeout(() => {
      this.timers.delete(removeTimer);
      toast.classList.add('is-out');
      const exitTimer = window.setTimeout(() => {
        this.timers.delete(exitTimer);
        toast.remove();
      }, TOAST_EXIT_MS);
      this.timers.add(exitTimer);
    }, TOAST_LIFETIME_MS);
    this.timers.add(removeTimer);
  }

  /** Detach listeners, clear timers and drop transient DOM owned by the HUD. */
  dispose(): void {
    this.abort.abort();

    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    if (this.bannerTimer !== null) {
      window.clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }

    this.dragging = false;
    this.dragPointerId = null;
    this.heldInputs.clear();
    this.wheel.classList.remove('is-dragging');
    this.pedalPad.classList.remove('is-pressed', 'is-active');
    this.brakePad.classList.remove('is-pressed', 'is-active');
    this.boostPad.classList.remove('is-pressed', 'is-active');
    this.banner.classList.remove('is-live');
    this.toastsEl.replaceChildren();
    this.textCache.clear();
    this.intCache.clear();
  }

  // ── Wiring ────────────────────────────────────────────────────────────

  private bindButtons(): void {
    this.root.addEventListener(
      'click',
      (event: MouseEvent) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
        if (!target || !this.root.contains(target)) return;
        const action = target.dataset.action;
        if (!action) return;
        event.preventDefault();
        switch (action) {
          case 'start':
            this.actions.onStart();
            break;
          case 'resume':
            this.actions.onResume();
            break;
          case 'restart':
            this.actions.onRestart();
            break;
          case 'pause':
            if (this.phase === 'playing') this.actions.onPause();
            break;
          case 'sound':
            this.actions.onToggleSound();
            break;
          default:
            break;
        }
      },
      { signal: this.abort.signal },
    );
  }

  private bindWheel(): void {
    const opts: AddEventListenerOptions = { signal: this.abort.signal, passive: false };

    this.wheel.addEventListener('pointerdown', (event) => this.onWheelDown(event), opts);
    this.wheel.addEventListener('pointermove', (event) => this.onWheelMove(event), opts);
    this.wheel.addEventListener(
      'pointerup',
      (event) => {
        if (event.pointerId === this.dragPointerId) this.endDrag(true);
      },
      opts,
    );
    this.wheel.addEventListener(
      'pointercancel',
      (event) => {
        if (event.pointerId === this.dragPointerId) this.endDrag(true);
      },
      opts,
    );
    this.wheel.addEventListener(
      'lostpointercapture',
      (event) => {
        if (event.pointerId === this.dragPointerId) this.endDrag(true);
      },
      opts,
    );
    this.wheel.addEventListener('keydown', (event) => this.onWheelKeyDown(event), opts);
    this.wheel.addEventListener('keyup', (event) => this.onWheelKeyUp(event), opts);
    this.wheel.addEventListener(
      'blur',
      () => {
        if (this.keySteerActive) {
          this.keySteerActive = false;
          this.steerVisual = 0;
          this.renderSteer();
          this.actions.onSteerEnd();
        }
        this.endDrag(true);
      },
      { signal: this.abort.signal },
    );
  }

  private bindPad(el: HTMLButtonElement, kind: ClaimedInput): void {
    let pointerId: number | null = null;
    const signal = this.abort.signal;

    const press = (): void => {
      this.setInput(kind, true);
    };
    const release = (): void => {
      pointerId = null;
      this.setInput(kind, false);
    };

    el.addEventListener(
      'pointerdown',
      (event: PointerEvent) => {
        if (pointerId !== null) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        pointerId = event.pointerId;
        try {
          el.setPointerCapture(event.pointerId);
        } catch {
          /* pointer capture is a progressive enhancement */
        }
        el.focus({ preventScroll: true });
        press();
      },
      { signal, passive: false },
    );
    el.addEventListener('pointerup', release, { signal });
    el.addEventListener('pointercancel', release, { signal });
    el.addEventListener(
      'lostpointercapture',
      () => {
        if (pointerId !== null) release();
      },
      { signal },
    );
    el.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    el.addEventListener(
      'keydown',
      (event: KeyboardEvent) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        if (event.repeat) return;
        press();
      },
      { signal },
    );
    el.addEventListener(
      'keyup',
      (event: KeyboardEvent) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        release();
      },
      { signal },
    );
    el.addEventListener('blur', release, { signal });
  }

  private bindGlobalSafety(): void {
    const signal = this.abort.signal;
    window.addEventListener(
      'blur',
      () => {
        this.endDrag(true);
        this.releaseAllInputs();
      },
      { signal },
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (!document.hidden) return;
        this.endDrag(true);
        this.releaseAllInputs();
      },
      { signal },
    );
  }

  // ── Steering wheel input ──────────────────────────────────────────────

  private onWheelDown(event: PointerEvent): void {
    if (this.phase !== 'playing') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const rect = this.wheel.getBoundingClientRect();
    if (rect.width <= 0) return;

    this.dragging = true;
    this.dragPointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartSteer = this.steerVisual;
    this.dragSpan = Math.max(44, rect.width * 0.42);
    this.wheel.classList.add('is-dragging');
    try {
      this.wheel.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is a progressive enhancement */
    }
    this.applyDrag(event.clientX);
  }

  private onWheelMove(event: PointerEvent): void {
    if (!this.dragging || event.pointerId !== this.dragPointerId) return;
    event.preventDefault();
    this.applyDrag(event.clientX);
  }

  private applyDrag(clientX: number): void {
    const next = clamp(this.dragStartSteer + (clientX - this.dragStartX) / this.dragSpan, -1, 1);
    this.steerVisual = next;
    this.renderSteer();
    if (Math.abs(next - this.lastEmittedSteer) >= 0.008) {
      this.lastEmittedSteer = next;
      this.actions.onSteer(next);
    }
  }

  private onWheelKeyDown(event: KeyboardEvent): void {
    if (this.phase !== 'playing') return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (event.repeat) return;
    const value = event.key === 'ArrowLeft' ? -0.75 : 0.75;
    this.keySteerActive = true;
    this.steerVisual = value;
    this.renderSteer();
    this.actions.onSteer(value);
  }

  private onWheelKeyUp(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (!this.keySteerActive) return;
    this.keySteerActive = false;
    this.steerVisual = 0;
    this.renderSteer();
    this.actions.onSteerEnd();
  }

  private endDrag(emitEnd: boolean): void {
    const wasDragging = this.dragging;
    const pointerId = this.dragPointerId;
    this.dragging = false;
    this.dragPointerId = null;
    this.wheel.classList.remove('is-dragging');

    if (pointerId !== null && this.wheel.hasPointerCapture(pointerId)) {
      try {
        this.wheel.releasePointerCapture(pointerId);
      } catch {
        /* capture may already be gone */
      }
    }

    this.lastEmittedSteer = 0;
    this.steerVisual = 0;
    this.renderSteer();
    if (wasDragging && emitEnd) this.actions.onSteerEnd();
  }

  private renderSteer(): void {
    const deg = this.steerVisual * WHEEL_LOCK_DEG;
    if (Math.abs(deg - this.lastWheelDeg) < 0.05) return;
    this.lastWheelDeg = deg;
    this.wheelRotor.style.transform = `rotate(${deg.toFixed(2)}deg)`;
    this.wheel.setAttribute('aria-valuenow', this.steerVisual.toFixed(2));
  }

  // ── Pedal / brake / boost input ───────────────────────────────────────

  private setInput(kind: ClaimedInput, pressed: boolean): void {
    if (pressed) {
      if (this.phase !== 'playing' || this.heldInputs.has(kind)) return;
      this.heldInputs.add(kind);
    } else {
      if (!this.heldInputs.has(kind)) return;
      this.heldInputs.delete(kind);
    }

    const pad = kind === 'throttle' ? this.pedalPad : kind === 'brake' ? this.brakePad : this.boostPad;
    pad.classList.toggle('is-pressed', pressed);

    if (kind === 'throttle') this.actions.onThrottle(pressed ? 1 : 0);
    else if (kind === 'brake') this.actions.onBrake(pressed ? 1 : 0);
    else this.actions.onBoost(pressed);
  }

  private releaseAllInputs(): void {
    for (const kind of Array.from(this.heldInputs)) {
      this.setInput(kind, false);
    }
    this.heldInputs.clear();
  }

  // ── Phase transitions ─────────────────────────────────────────────────

  private onPhaseChanged(phase: GamePhase): void {
    this.releaseAllInputs();
    if (this.dragging) this.endDrag(true);
    if (this.keySteerActive) {
      this.keySteerActive = false;
      this.steerVisual = 0;
      this.renderSteer();
      this.actions.onSteerEnd();
    }
    if (phase !== 'playing') {
      this.hideCheckpoint();
      this.lastFlashKey = '';
    }
    if (phase === 'title') {
      this.steerVisual = 0;
      this.lastWheelDeg = Number.NaN;
      this.renderSteer();
    }
  }

  // ── Helpers: DOM / formatting ─────────────────────────────────────────

  private find<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Hud: missing required element "${selector}" inside #hud-root.`);
    }
    return element;
  }

  private findAll<T extends Element>(selector: string): T[] {
    const elements = Array.from(this.root.querySelectorAll<T>(selector));
    if (elements.length === 0) {
      throw new Error(`Hud: missing required elements "${selector}" inside #hud-root.`);
    }
    return elements;
  }

  private text(element: Element, value: string): void {
    if (this.textCache.get(element) === value) return;
    this.textCache.set(element, value);
    element.textContent = value;
  }

  /** Format an integer only when the underlying value actually changed. */
  private intText(element: Element, value: number): void {
    const rounded = Number.isFinite(value) ? Math.round(value) : 0;
    if (this.intCache.get(element) === rounded) return;
    this.intCache.set(element, rounded);
    this.text(element, this.integerFormat.format(rounded));
  }

  // ── Helpers: gauges ───────────────────────────────────────────────────

  private gaugeScaleFor(topSpeedKmh: number): number {
    const top = Number.isFinite(topSpeedKmh) ? Math.max(0, topSpeedKmh) : 0;
    return Math.max(40, Math.ceil(top / 20) * 20);
  }

  private arcPath(cx: number, cy: number, radius: number, startDeg: number, sweepDeg: number): string {
    const start = (startDeg * Math.PI) / 180;
    const end = ((startDeg + sweepDeg) * Math.PI) / 180;
    const x1 = cx + Math.cos(start) * radius;
    const y1 = cy + Math.sin(start) * radius;
    const x2 = cx + Math.cos(end) * radius;
    const y2 = cy + Math.sin(end) * radius;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 1 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  private buildGauge(scale: number): void {
    this.speedTicks.replaceChildren();
    this.speedLabels.replaceChildren();

    const step = scale <= 60 ? 5 : scale <= 120 ? 10 : 20;
    const tickCount = Math.round(scale / step);
    for (let index = 0; index <= tickCount; index += 1) {
      const value = index * step;
      const ratio = value / scale;
      const angle = ((GAUGE_START_DEG + GAUGE_SWEEP_DEG * ratio) * Math.PI) / 180;
      const major = Math.abs(value % 20) < 0.0001;
      const outer = 93;
      const inner = major ? 81 : 86;

      const tick = document.createElementNS(SVG_NS, 'line');
      tick.setAttribute('x1', (120 + Math.cos(angle) * outer).toFixed(2));
      tick.setAttribute('y1', (120 + Math.sin(angle) * outer).toFixed(2));
      tick.setAttribute('x2', (120 + Math.cos(angle) * inner).toFixed(2));
      tick.setAttribute('y2', (120 + Math.sin(angle) * inner).toFixed(2));
      if (major) tick.setAttribute('class', 'is-major');
      this.speedTicks.appendChild(tick);
    }

    for (let value = 0; value <= scale; value += 20) {
      const ratio = value / scale;
      const angle = ((GAUGE_START_DEG + GAUGE_SWEEP_DEG * ratio) * Math.PI) / 180;
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', (120 + Math.cos(angle) * 68).toFixed(2));
      label.setAttribute('y', (120 + Math.sin(angle) * 68).toFixed(2));
      label.setAttribute('dominant-baseline', 'middle');
      label.textContent = String(value);
      this.speedLabels.appendChild(label);
    }
  }

  private setArcProgress(path: SVGPathElement, progress: number, kind: 'speed' | 'boost'): void {
    const percent = Math.round(clamp01(progress) * 1000) / 10;
    const previous = kind === 'speed' ? this.lastSpeedArc : this.lastBoostArc;
    if (percent === previous) return;
    if (kind === 'speed') this.lastSpeedArc = percent;
    else this.lastBoostArc = percent;
    path.style.strokeDasharray = `${percent} 100`;
  }

  // ── Helpers: states ───────────────────────────────────────────────────

  private applyHearts(hearts: number): void {
    for (let index = 0; index < this.heartEls.length; index += 1) {
      const heart = this.heartEls[index];
      if (!heart) continue;
      heart.classList.toggle('is-empty', index >= hearts);
    }
    this.heartsRoot.setAttribute('aria-label', `剩余生命 ${hearts}`);
  }

  private applySound(muted: boolean): void {
    this.lastMuted = muted;
    this.root.dataset.muted = muted ? 'true' : 'false';
    const label = muted ? '打开声音' : '关闭声音';
    for (const button of this.soundButtons) {
      button.setAttribute('aria-pressed', String(!muted));
      button.setAttribute('aria-label', label);
    }
  }

  private popCombo(): void {
    if (this.reducedMotion || typeof this.comboRoot.animate !== 'function') return;
    this.comboRoot.animate(
      [
        { transform: 'scale(1)', offset: 0 },
        { transform: 'scale(1.16)', offset: 0.45 },
        { transform: 'scale(1)', offset: 1 },
      ],
      { duration: 230, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }

  private showCheckpoint(title: string, split: string): void {
    this.text(this.bannerTitle, title);
    this.text(this.bannerSplit, split);
    this.banner.classList.add('is-live');
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.bannerTimer = null;
      this.banner.classList.remove('is-live');
    }, BANNER_LIFETIME_MS);
  }

  private hideCheckpoint(): void {
    if (this.bannerTimer !== null) {
      window.clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
    this.banner.classList.remove('is-live');
  }
}
