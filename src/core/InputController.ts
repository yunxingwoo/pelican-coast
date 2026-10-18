export interface InputCallbacks {
  onCamera(): void;
  onBell(): void;
  onWings(): void;
  onSkipTime(): void;
  onToggleUi(): void;
  onPause(): void;
  onMute(): void;
  onRestart(): void;
}

export interface ControlState {
  steer: number;
  throttle: number;
  brake: number;
  boost: boolean;
}

const DEADZONE = 0.12;

export class InputController {
  private readonly keys = new Set<string>();
  private wheelSteer = 0;
  private touchThrottle = 0;
  private touchBrake = 0;
  private touchBoost = false;
  private gamepadSteer = 0;
  private gamepadThrottle = 0;
  private gamepadBrake = 0;
  private gamepadBoost = false;
  private paused = false;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (
      event.code === 'ArrowUp' ||
      event.code === 'ArrowDown' ||
      event.code === 'ArrowLeft' ||
      event.code === 'ArrowRight' ||
      event.code === 'Space'
    ) {
      event.preventDefault();
    }
    if (event.repeat) return;
    this.keys.add(event.code);
    if (event.code === 'Escape' || event.code === 'KeyP') this.callbacks.onPause();
    if (event.code === 'KeyC') this.callbacks.onCamera();
    if (event.code === 'KeyB') this.callbacks.onBell();
    if (event.code === 'KeyT') this.callbacks.onWings();
    if (event.code === 'KeyN') this.callbacks.onSkipTime();
    if (event.code === 'KeyU') this.callbacks.onToggleUi();
    if (event.code === 'KeyM') this.callbacks.onMute();
    if (event.code === 'KeyR') this.callbacks.onRestart();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = () => {
    this.keys.clear();
    this.touchThrottle = 0;
    this.touchBrake = 0;
    this.touchBoost = false;
    this.wheelSteer = 0;
  };

  constructor(private readonly callbacks: InputCallbacks) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.touchThrottle = 0;
      this.touchBrake = 0;
      this.touchBoost = false;
    }
  }

  setWheelSteer(value: number): void {
    this.wheelSteer = Math.max(-1, Math.min(1, value));
  }

  setThrottle(value: number): void {
    this.touchThrottle = value > 0.5 ? 1 : 0;
  }

  setBrake(value: number): void {
    this.touchBrake = value > 0.5 ? 1 : 0;
  }

  setBoost(pressed: boolean): void {
    this.touchBoost = pressed;
  }

  update(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find((candidate) => candidate && candidate.connected);
    if (pad) {
      const axis = Math.abs(pad.axes[0] ?? 0) > DEADZONE ? pad.axes[0] : 0;
      this.gamepadSteer = axis;
      this.gamepadThrottle = pad.buttons[7]?.value ?? 0;
      this.gamepadBrake = pad.buttons[6]?.value ?? 0;
      this.gamepadBoost =
        (pad.buttons[0]?.pressed ?? false) || (pad.buttons[5]?.pressed ?? false);
      if (pad.buttons[9]?.pressed) this.callbacks.onPause();
      if (pad.buttons[3]?.pressed) this.callbacks.onCamera();
    } else {
      this.gamepadSteer = 0;
      this.gamepadThrottle = 0;
      this.gamepadBrake = 0;
      this.gamepadBoost = false;
    }
  }

  read(): ControlState {
    if (this.paused) {
      return { steer: 0, throttle: 0, brake: 0, boost: false };
    }
    let keySteer = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) keySteer -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) keySteer += 1;
    const steer = Math.max(
      -1,
      Math.min(1, keySteer + this.wheelSteer + this.gamepadSteer),
    );
    const throttle = Math.max(
      this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0,
      this.touchThrottle,
      this.gamepadThrottle,
    );
    const brake = Math.max(
      this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0,
      this.touchBrake,
      this.gamepadBrake,
    );
    const boost =
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      this.keys.has('Space') ||
      this.touchBoost ||
      this.gamepadBoost;
    return { steer, throttle, brake, boost };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
