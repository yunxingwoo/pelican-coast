export interface AudioState {
  speedRatio: number;
  windStrength: number;
  playing: boolean;
  paused: boolean;
}

export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private oceanSource: AudioBufferSourceNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private unlocked = false;
  private lastGust = 0;

  constructor() {
    const unlock = () => {
      void this.unlock();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  async unlock(): Promise<void> {
    if (this.unlocked && this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return;
    }
    this.unlocked = true;
    const context = new AudioContext();
    this.context = context;
    const master = context.createGain();
    master.gain.value = this.muted ? 0 : 0.72;
    master.connect(context.destination);
    this.master = master;

    const ambient = context.createGain();
    ambient.gain.value = 0.0;
    ambient.connect(master);
    this.ambientGain = ambient;

    const length = context.sampleRate * 2;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    this.noiseBuffer = buffer;

    const ocean = context.createBufferSource();
    ocean.buffer = buffer;
    ocean.loop = true;
    const oceanFilter = context.createBiquadFilter();
    oceanFilter.type = 'lowpass';
    oceanFilter.frequency.value = 480;
    oceanFilter.Q.value = 0.4;
    const oceanGain = context.createGain();
    oceanGain.gain.value = 0.52;
    ocean.connect(oceanFilter).connect(oceanGain).connect(ambient);
    ocean.start();
    this.oceanSource = ocean;

    const wind = context.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 950;
    windFilter.Q.value = 0.55;
    const windGain = context.createGain();
    windGain.gain.value = 0.05;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();
    this.windSource = wind;
    this.windGain = windGain;

    if (context.state === 'suspended') await context.resume();
    ambient.gain.setTargetAtTime(0.6, context.currentTime, 1.4);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.context.currentTime, 0.08);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  update(state: AudioState): void {
    if (!this.context || !this.windGain) return;
    const targetWind = state.paused
      ? 0.02
      : 0.03 + state.speedRatio * 0.09 + state.windStrength * 0.08;
    this.windGain.gain.setTargetAtTime(targetWind, this.context.currentTime, 0.4);
    if (this.ambientGain) {
      const target = state.paused ? 0.18 : 0.6;
      this.ambientGain.gain.setTargetAtTime(target, this.context.currentTime, 0.5);
    }

    if (!state.playing || state.paused) return;
    if (state.windStrength > 0.96 && this.lastGust < 0.96) {
      this.gust(state.windStrength);
    }
    this.lastGust = state.windStrength;
  }

  shell(index = 0): void {
    const baseNotes = [523.25, 587.33, 659.25, 783.99, 880];
    const note = baseNotes[index % baseNotes.length];
    this.tone(note, 0.16, 'sine', 0.22, note * 1.5);
    this.tone(note * 2, 0.1, 'triangle', 0.08);
  }

  checkpoint(): void {
    [392, 523.25, 659.25, 783.99].forEach((note, index) => {
      window.setTimeout(() => this.tone(note, 0.32, 'sine', 0.15), index * 90);
    });
  }

  crash(): void {
    if (!this.context || !this.noiseBuffer) return;
    const context = this.context;
    const time = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1500, time);
    filter.frequency.exponentialRampToValueAtTime(180, time + 0.5);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.55, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.65);
    source.connect(filter).connect(gain).connect(this.master ?? context.destination);
    source.start(time);
    source.stop(time + 0.7);
    this.tone(72, 0.5, 'sine', 0.5, 46);
    this.tone(120, 0.25, 'square', 0.08, 60);
  }

  boost(): void {
    if (!this.context) return;
    const context = this.context;
    this.tone(180, 0.5, 'sawtooth', 0.05, 720);
    this.tone(360, 0.4, 'triangle', 0.05, 1080);
    const time = context.currentTime;
    const source = context.createBufferSource();
    if (this.noiseBuffer) source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, time);
    filter.frequency.exponentialRampToValueAtTime(2600, time + 0.4);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.15, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
    source.connect(filter).connect(gain).connect(this.master ?? context.destination);
    source.start(time);
    source.stop(time + 0.55);
  }

  gust(strength: number): void {
    if (!this.context || !this.noiseBuffer) return;
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(600, context.currentTime);
    filter.frequency.linearRampToValueAtTime(1300, context.currentTime + 0.8);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.12 * strength, context.currentTime + 0.2);
    gain.gain.linearRampToValueAtTime(0.0, context.currentTime + 1.4);
    source.connect(filter).connect(gain).connect(this.master ?? context.destination);
    source.start();
    source.stop(context.currentTime + 1.5);
  }

  thunder(): void {
    if (!this.context || !this.noiseBuffer) return;
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 0.4;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, context.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 2.2);
    source.connect(filter).connect(gain).connect(this.master ?? context.destination);
    source.start();
    source.stop(context.currentTime + 2.3);
    this.tone(48, 1.6, 'sine', 0.22, 34);
  }

  bell(): void {
    this.tone(1318.5, 0.5, 'sine', 0.12);
    window.setTimeout(() => this.tone(1760, 0.65, 'sine', 0.08), 80);
  }

  click(): void {
    this.tone(680, 0.04, 'square', 0.05);
  }

  finish(): void {
    [392, 493.88, 587.33, 783.99, 987.77].forEach((note, index) => {
      window.setTimeout(() => this.tone(note, 0.55, 'sine', 0.14), index * 120);
    });
  }

  dispose(): void {
    this.oceanSource?.stop();
    this.windSource?.stop();
    void this.context?.close();
    this.context = null;
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    slideTo?: number,
  ): void {
    if (!this.context) return;
    const context = this.context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    if (slideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, slideTo),
        context.currentTime + duration,
      );
    }
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(this.master ?? context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.02);
  }

}

// Math.random is only used to seed the ambient noise buffer at unlock time, not
// for gameplay simulation; it does not affect deterministic test hooks.
void AudioSystem;
