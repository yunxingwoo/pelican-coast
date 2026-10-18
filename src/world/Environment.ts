import * as THREE from 'three';
import type { WeatherKind } from '../types';
import { Ocean } from './Ocean';
import { Sky, type SkyState } from './Sky';
import type { RandomSource } from './ProceduralTextures';

export interface EnvironmentState {
  timeOfDay: number;
  clock: string;
  dayPhaseLabel: string;
  night: number;
  daylight: number;
  twilight: number;
  sunDirection: THREE.Vector3;
  moonDirection: THREE.Vector3;
  sunColor: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  weather: WeatherKind;
  weatherLabel: string;
  storm: number;
  cloudCover: number;
  rain: number;
  fogAmount: number;
  windSpeed: number;
  gustSpeed: number;
  windDirection: THREE.Vector2;
  windStrength: number;
  flash: number;
  exposure: number;
}

const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: '晴朗',
  cloudy: '多云',
  rain: '阵雨',
  storm: '雷暴',
  fog: '海雾',
};

const WEATHER_SEQUENCE: WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'clear'];

const WEATHER_PRESETS: Record<
  WeatherKind,
  {
    storm: number;
    cloud: number;
    rain: number;
    fog: number;
    wind: number;
    dim: number;
    exposure: number;
  }
> = {
  clear: { storm: 0, cloud: 0.24, rain: 0, fog: 0.04, wind: 5.5, dim: 0, exposure: 1.0 },
  cloudy: { storm: 0.1, cloud: 0.62, rain: 0, fog: 0.1, wind: 8.5, dim: 0.28, exposure: 0.98 },
  rain: { storm: 0.4, cloud: 0.82, rain: 0.65, fog: 0.24, wind: 11, dim: 0.5, exposure: 0.9 },
  storm: { storm: 0.9, cloud: 0.95, rain: 1, fog: 0.4, wind: 16, dim: 0.76, exposure: 0.82 },
  fog: { storm: 0.12, cloud: 0.72, rain: 0.04, fog: 1, wind: 4.2, dim: 0.34, exposure: 0.95 },
};

const DAY_LENGTH_SECONDS = 720;
const START_TIME = 0.685;

const gradient = (t: number, stops: Array<[number, THREE.Color]>): THREE.Color => {
  if (t <= stops[0][0]) return stops[0][1].clone();
  for (let i = 1; i < stops.length; i += 1) {
    const [position, color] = stops[i];
    const [previousPosition, previousColor] = stops[i - 1];
    if (t <= position) {
      const local = (t - previousPosition) / Math.max(position - previousPosition, 0.0001);
      return previousColor.clone().lerp(color, local);
    }
  }
  return stops[stops.length - 1][1].clone();
};

export class Environment {
  readonly state: EnvironmentState;
  readonly sky: Sky;
  readonly ocean: Ocean;
  readonly sunLight: THREE.DirectionalLight;
  readonly fillLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly root = new THREE.Group();

  private timeOfDay = START_TIME;
  private weather: WeatherKind = 'clear';
  private weatherTarget: WeatherKind = 'clear';
  private weatherBlend = 1;
  private weatherTimer = 48;
  private weatherIndex = 0;
  private currentPreset = { ...WEATHER_PRESETS.clear };
  private targetPreset = { ...WEATHER_PRESETS.clear };
  private flash = 0;
  private flashCooldown = 6;
  private readonly rng: RandomSource;
  private readonly tmpColor = new THREE.Color();
  private readonly lightDirection = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    rng: RandomSource,
  ) {
    this.rng = rng;
    this.sky = new Sky(rng);
    this.ocean = new Ocean();
    this.root.add(this.sky.root, this.ocean.mesh);

    this.hemiLight = new THREE.HemisphereLight('#cfe5e3', '#5e5b45', 1.2);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff0cc', 2.4);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 260;
    this.sunLight.shadow.camera.left = -48;
    this.sunLight.shadow.camera.right = 48;
    this.sunLight.shadow.camera.top = 48;
    this.sunLight.shadow.camera.bottom = -48;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.025;
    this.root.add(this.sunLight, this.sunLight.target);

    this.fillLight = new THREE.DirectionalLight('#93c6d0', 0.4);
    this.fillLight.castShadow = false;
    this.root.add(this.fillLight);

    this.scene.fog = new THREE.Fog('#d8d0be', 60, 1200);
    this.state = {
      timeOfDay: this.timeOfDay,
      clock: '16:26',
      dayPhaseLabel: '黄金时刻',
      night: 0,
      daylight: 1,
      twilight: 0.6,
      sunDirection: new THREE.Vector3(),
      moonDirection: new THREE.Vector3(),
      sunColor: new THREE.Color('#ffd39b'),
      skyTop: new THREE.Color('#5f93ab'),
      skyHorizon: new THREE.Color('#ffc48e'),
      fogColor: new THREE.Color('#e4c7a2'),
      fogNear: 55,
      fogFar: 1150,
      weather: 'clear',
      weatherLabel: '晴朗',
      storm: 0,
      cloudCover: 0.24,
      rain: 0,
      fogAmount: 0.04,
      windSpeed: 5.5,
      gustSpeed: 1.2,
      windDirection: new THREE.Vector2(0.72, 0.69),
      windStrength: 0.45,
      flash: 0,
      exposure: 1.02,
    };
  }

  get weatherKind(): WeatherKind {
    return this.weather;
  }

  get weatherLabel(): string {
    return WEATHER_LABELS[this.weather];
  }

  setWeather(weather: WeatherKind, immediate = false): void {
    this.weatherTarget = weather;
    this.currentPreset = { ...this.presetFor(this.weather) };
    this.targetPreset = { ...WEATHER_PRESETS[weather] };
    this.weatherBlend = immediate ? 1 : 0;
    this.weather = weather;
    if (immediate) {
      this.currentPreset = { ...this.targetPreset };
    }
    this.weatherTimer = 50 + this.rng() * 20;
  }

  setTimeOfDay(time: number): void {
    this.timeOfDay = ((time % 1) + 1) % 1;
  }

  advanceTime(seconds: number): void {
    this.timeOfDay = (this.timeOfDay + seconds / DAY_LENGTH_SECONDS) % 1;
  }

  get phaseLabel(): string {
    const elevation = this.state.sunDirection.y;
    if (elevation < -0.32) return '深夜';
    if (elevation < -0.06) return '入夜';
    if (elevation < 0.08) return '黄昏';
    if (elevation < 0.26) return '黄金时刻';
    if (elevation < 0.65) return '午后';
    if (this.timeOfDay < 0.5) return '上午';
    return '正午';
  }

  get clockLabel(): string {
    const totalMinutes = Math.floor(this.timeOfDay * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  /** Advances day, weather, wind, sky, sea and lights. */
  update(
    delta: number,
    elapsed: number,
    focus: THREE.Vector3,
    cameraPosition: THREE.Vector3,
  ): EnvironmentState {
    const safeDelta = Math.max(0, Math.min(delta, 0.05));
    this.advanceTime(safeDelta);
    this.weatherTimer -= safeDelta;
    if (this.weatherTimer <= 0) {
      this.weatherIndex = (this.weatherIndex + 1) % WEATHER_SEQUENCE.length;
      this.weather = this.weatherTarget;
      this.weatherTarget = WEATHER_SEQUENCE[this.weatherIndex];
      this.currentPreset = { ...this.targetPreset };
      this.targetPreset = { ...WEATHER_PRESETS[this.weatherTarget] };
      this.weatherBlend = 0;
      this.weatherTimer = 52 + this.rng() * 26;
    }
    if (this.weatherBlend < 1) {
      this.weatherBlend = Math.min(1, this.weatherBlend + safeDelta / 8.5);
    }

    const blend = THREE.MathUtils.smoothstep(this.weatherBlend, 0, 1);
    const preset = {
      storm: THREE.MathUtils.lerp(this.currentPreset.storm, this.targetPreset.storm, blend),
      cloud: THREE.MathUtils.lerp(this.currentPreset.cloud, this.targetPreset.cloud, blend),
      rain: THREE.MathUtils.lerp(this.currentPreset.rain, this.targetPreset.rain, blend),
      fog: THREE.MathUtils.lerp(this.currentPreset.fog, this.targetPreset.fog, blend),
      wind: THREE.MathUtils.lerp(this.currentPreset.wind, this.targetPreset.wind, blend),
      dim: THREE.MathUtils.lerp(this.currentPreset.dim, this.targetPreset.dim, blend),
      exposure: THREE.MathUtils.lerp(this.currentPreset.exposure, this.targetPreset.exposure, blend),
    };
    this.focus.copy(focus);

    // Sun and moon follow a simple east-to-west arc.
    const theta = (this.timeOfDay - 0.25) * Math.PI * 2;
    const sunDirection = this.state.sunDirection.set(
      Math.cos(theta),
      Math.sin(theta),
      0.36,
    ).normalize();
    this.state.moonDirection.copy(sunDirection).multiplyScalar(-1);
    this.state.moonDirection.x += 0.24;
    this.state.moonDirection.z -= 0.16;
    this.state.moonDirection.normalize();

    const elevation = sunDirection.y;
    const daylight = THREE.MathUtils.smoothstep(elevation, -0.12, 0.2);
    const night = 1 - daylight;
    const twilight = Math.pow(
      1 - THREE.MathUtils.clamp(Math.abs(elevation) / 0.32, 0, 1),
      1.6,
    );

    this.state.daylight = daylight;
    this.state.night = night;
    this.state.twilight = twilight;

    const top = gradient(daylight, [
      [0, new THREE.Color('#061321')],
      [0.35, new THREE.Color('#1d3451')],
      [0.7, new THREE.Color('#3f7b9b')],
      [1, new THREE.Color('#2f7ea8')],
    ]);
    const horizon = gradient(daylight, [
      [0, new THREE.Color('#0d1d2f')],
      [0.28, new THREE.Color('#5f5161')],
      [0.55, new THREE.Color('#cf8d6c')],
      [0.78, new THREE.Color('#f2c79b')],
      [1, new THREE.Color('#d9c3a3')],
    ]);
    const sunColor = gradient(daylight, [
      [0, new THREE.Color('#9fb9d8')],
      [0.3, new THREE.Color('#ff9368')],
      [0.7, new THREE.Color('#ffd09a')],
      [1, new THREE.Color('#fff4d8')],
    ]);
    this.tmpColor.copy(top).lerp(new THREE.Color('#59686c'), preset.dim * 0.5);
    this.state.skyTop.copy(this.tmpColor);
    this.tmpColor.copy(horizon).lerp(new THREE.Color('#8a8c83'), preset.dim * 0.48);
    this.state.skyHorizon.copy(this.tmpColor);
    this.state.sunColor.copy(sunColor).lerp(new THREE.Color('#c9d4d8'), preset.dim * 0.45);

    const fogBase = this.state.skyHorizon.clone().lerp(new THREE.Color('#aab8b3'), 0.46);
    fogBase.lerp(new THREE.Color('#667779'), preset.fog * 0.48 + preset.storm * 0.2);
    this.state.fogColor.copy(fogBase);
    this.state.fogNear = THREE.MathUtils.lerp(55, 2.5, preset.fog * 0.95);
    this.state.fogFar = THREE.MathUtils.lerp(1150, 98, preset.fog * 0.97 + preset.rain * 0.06);
    this.scene.fog = new THREE.Fog(
      this.state.fogColor,
      this.state.fogNear,
      this.state.fogFar,
    );

    this.state.weather = this.weatherTarget;
    this.state.weatherLabel = WEATHER_LABELS[this.weatherTarget];
    this.state.storm = preset.storm;
    this.state.cloudCover = THREE.MathUtils.clamp(preset.cloud + night * 0.08, 0, 1);
    this.state.rain = preset.rain;
    this.state.fogAmount = preset.fog;

    // Wind: a slowly rotating bearing with layered gusts.
    const directionAngle =
      0.72 + Math.sin(elapsed * 0.017) * 0.9 + Math.sin(elapsed * 0.041 + 2) * 0.3;
    this.state.windDirection.set(Math.cos(directionAngle), Math.sin(directionAngle));
    const gustWave =
      Math.max(0, Math.sin(elapsed * 0.19 + 1.2)) ** 4 * 0.65 +
      Math.max(0, Math.sin(elapsed * 0.43 + 4.3)) ** 6 * 0.35;
    const gust = gustWave * (3.4 + preset.storm * 9 + preset.rain * 2);
    this.state.windSpeed = preset.wind;
    this.state.gustSpeed = gust;
    this.state.windStrength = THREE.MathUtils.clamp((preset.wind + gust) / 18, 0.1, 1.35);

    // Lightning only in storms.
    this.flash = Math.max(0, this.flash - safeDelta * 3.6);
    if (preset.storm > 0.55) {
      this.flashCooldown -= safeDelta;
      if (this.flashCooldown <= 0) {
        this.flash = 0.75 + this.rng() * 0.25;
        this.flashCooldown = 4 + this.rng() * 8;
      }
    } else {
      this.flashCooldown = Math.max(this.flashCooldown, 3.2);
    }
    this.state.flash = this.flash;
    this.state.exposure = preset.exposure * (1 + this.flash * 0.45);

    // Sky and ocean uniforms.
    const skyState: SkyState = {
      topColor: this.state.skyTop,
      horizonColor: this.state.skyHorizon,
      groundColor: this.state.fogColor.clone().multiplyScalar(0.82),
      sunColor: this.state.sunColor,
      sunDirection,
      moonColor: new THREE.Color('#cedcf5'),
      moonDirection: this.state.moonDirection,
      night,
      twilight,
      cloudCover: this.state.cloudCover,
      storm: preset.storm,
      fogColor: this.state.fogColor,
    };
    this.sky.update(delta, elapsed, cameraPosition, skyState);
    this.ocean.update(elapsed, {
      night,
      storm: preset.storm,
      windDirection: this.state.windDirection,
      windStrength: this.state.windStrength,
      sunDirection,
      sunColor: this.state.sunColor,
      skyColor: this.state.skyTop,
      horizonColor: this.state.skyHorizon,
      fogFar: this.state.fogFar * 1.15,
    });

    this.updateLights(elevation, daylight, night, preset.storm, preset.dim, preset.exposure);

    this.state.timeOfDay = this.timeOfDay;
    this.state.clock = this.clockLabel;
    this.state.dayPhaseLabel = this.phaseLabel;
    return this.state;
  }

  private updateLights(
    elevation: number,
    daylight: number,
    night: number,
    storm: number,
    dim: number,
    exposure: number,
  ): void {
    const moonUp = this.state.moonDirection.y > 0;
    const lightDirection = this.lightDirection;
    if (elevation > 0.02 || !moonUp) {
      lightDirection.copy(this.state.sunDirection);
    } else {
      lightDirection.copy(this.state.moonDirection);
    }
    if (lightDirection.y < 0.12) lightDirection.y = 0.12;
    lightDirection.normalize();

    this.sunLight.position
      .copy(this.focus)
      .addScaledVector(lightDirection, 120);
    this.sunLight.target.position.copy(this.focus);
    this.sunLight.color
      .copy(this.state.sunColor)
      .lerp(new THREE.Color('#b9d0ff'), night * 0.8);
    this.sunLight.intensity =
      (daylight * (2.4 - dim * 1.5) + night * 0.42) * (1 - storm * 0.24) +
      this.flash * 3.2;
    this.sunLight.castShadow = daylight > 0.22 || night > 0.2;

    this.fillLight.position
      .copy(this.focus)
      .add(new THREE.Vector3(48, 34, 62));
    this.fillLight.target.position.copy(this.focus);
    this.fillLight.color.copy(this.state.skyHorizon).lerp(new THREE.Color('#ffe0b8'), 0.35);
    this.fillLight.intensity = 0.26 + (1 - night) * 0.52;

    this.hemiLight.color.copy(this.state.skyTop).lerp(new THREE.Color('#e6d7b8'), 0.3);
    this.hemiLight.groundColor
      .copy(this.state.fogColor)
      .multiplyScalar(0.58)
      .lerp(new THREE.Color('#505a43'), 0.45);
    this.hemiLight.intensity = 0.42 + daylight * 1.28 - dim * 0.2 + this.flash * 2.4;

    // Exposure is consumed by the Game renderer.
    void exposure;
  }

  private presetFor(weather: WeatherKind): typeof WEATHER_PRESETS.clear {
    return WEATHER_PRESETS[weather];
  }
}
