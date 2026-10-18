import * as THREE from 'three';
import { createCloudTexture, createSoftCircleTexture, type RandomSource } from './ProceduralTextures';

const skyVertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const skyFragmentShader = /* glsl */ `
  uniform vec3 uTopColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uGroundColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform vec3 uMoonColor;
  uniform vec3 uMoonDirection;
  uniform float uNight;
  uniform float uTwilight;
  uniform float uCloudCover;
  uniform float uTime;
  uniform float uStorm;
  varying vec3 vDirection;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 dir = normalize(vDirection);
    float height = clamp(dir.y, -0.12, 1.0);
    float horizonMix = pow(1.0 - clamp(height, 0.0, 1.0), 5.2);
    vec3 sky = mix(uTopColor, uHorizonColor, horizonMix);
    sky = mix(sky, uGroundColor, smoothstep(0.0, -0.12, dir.y));

    // Subtle banded high cloud deck.
    float cloudBand = smoothstep(0.35, 0.8, noise(dir.xz * 3.4 + vec2(uTime * 0.003, 0.0)));
    cloudBand *= smoothstep(0.02, 0.45, height) * uCloudCover;
    sky = mix(sky, mix(uHorizonColor, vec3(0.72, 0.74, 0.74), 0.45), cloudBand * (0.22 + uStorm * 0.28));

    // Sun: warm disc with layered corona.
    float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
    float sunDisc = smoothstep(0.9993, 0.99975, sunDot);
    float corona = pow(sunDot, 420.0) * 0.65 + pow(sunDot, 24.0) * 0.16;
    float sunAbove = smoothstep(-0.08, 0.04, uSunDirection.y);
    float sunVisibility = (1.0 - uNight) * (1.0 - uStorm * 0.9) * (1.0 - uCloudCover * 0.42);
    sky += uSunColor * (sunDisc * 2.1 + corona * (1.0 - uNight)) * sunAbove * sunVisibility;

    // Moon disc with a soft halo.
    float moonDot = max(dot(dir, normalize(uMoonDirection)), 0.0);
    float moonDisc = smoothstep(0.99955, 0.99985, moonDot);
    float moonHalo = pow(moonDot, 220.0) * 0.22;
    sky += uMoonColor * (moonDisc * 1.3 + moonHalo) * uNight;

    sky *= mix(1.0, 0.68, uStorm);

    // Warm line at the horizon during golden hour.
    float horizonLine = pow(1.0 - clamp(abs(height), 0.0, 1.0), 24.0);
    sky += uSunColor * horizonLine * uTwilight * 0.32;

    gl_FragColor = vec4(sky, 1.0);
  }
`;

export interface SkyState {
  topColor: THREE.Color;
  horizonColor: THREE.Color;
  groundColor: THREE.Color;
  sunColor: THREE.Color;
  sunDirection: THREE.Vector3;
  moonColor: THREE.Color;
  moonDirection: THREE.Vector3;
  night: number;
  twilight: number;
  cloudCover: number;
  storm: number;
  fogColor: THREE.Color;
}

export class Sky {
  readonly root = new THREE.Group();
  readonly dome: THREE.Mesh;
  readonly sunSprite: THREE.Sprite;
  readonly moonSprite: THREE.Sprite;
  readonly cloudGroup = new THREE.Group();
  readonly starField: THREE.Points;

  private readonly uniforms = {
    uTopColor: { value: new THREE.Color('#4f9fbe') },
    uHorizonColor: { value: new THREE.Color('#e4dcc9') },
    uGroundColor: { value: new THREE.Color('#adb2a2') },
    uSunColor: { value: new THREE.Color('#fff0c9') },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uMoonColor: { value: new THREE.Color('#cddcf1') },
    uMoonDirection: { value: new THREE.Vector3(0, -1, 0) },
    uNight: { value: 0 },
    uTwilight: { value: 0 },
    uCloudCover: { value: 0.3 },
    uTime: { value: 0 },
    uStorm: { value: 0 },
  };

  private readonly cloudMaterial: THREE.SpriteMaterial;
  private readonly clouds: THREE.Sprite[] = [];

  constructor(rng: RandomSource) {
    this.root.name = 'Sky';
    const geometry = new THREE.SphereGeometry(1500, 64, 40);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(geometry, material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    this.root.add(this.dome);

    const glow = createSoftCircleTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: '#fff0be',
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sunSprite.scale.setScalar(180);
    this.sunSprite.renderOrder = -90;
    this.root.add(this.sunSprite);

    this.moonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: '#d7e4ff',
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.moonSprite.scale.setScalar(95);
    this.moonSprite.renderOrder = -89;
    this.root.add(this.moonSprite);

    const cloudTexture = createCloudTexture(rng);
    this.cloudMaterial = new THREE.SpriteMaterial({
      map: cloudTexture,
      color: '#fff4e0',
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      fog: false,
    });

    const cloudCount = 10;
    for (let i = 0; i < cloudCount; i += 1) {
      const sprite = new THREE.Sprite(this.cloudMaterial);
      const angle = rng() * Math.PI * 2;
      const radius = 680 + rng() * 520;
      const height = 125 + rng() * 190;
      sprite.position.set(
        Math.cos(angle) * radius,
        height,
        Math.sin(angle) * radius,
      );
      const scale = 150 + rng() * 230;
      sprite.scale.set(scale, scale * (0.42 + rng() * 0.24), 1);
      sprite.userData.speed = 0.6 + rng() * 1.3;
      sprite.userData.offset = rng() * Math.PI * 2;
      sprite.userData.baseY = height;
      this.clouds.push(sprite);
      this.cloudGroup.add(sprite);
    }
    this.root.add(this.cloudGroup);

    const starCount = 1400;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const azimuth = rng() * Math.PI * 2;
      const elevation = Math.asin(0.03 + rng() * 0.96);
      const radius = 1280;
      starPositions[i * 3] = Math.cos(azimuth) * Math.cos(elevation) * radius;
      starPositions[i * 3 + 1] = Math.sin(elevation) * radius;
      starPositions[i * 3 + 2] = Math.sin(azimuth) * Math.cos(elevation) * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.starField = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: '#e6eefc',
        size: 1.55,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.starField.frustumCulled = false;
    this.starField.renderOrder = -95;
    this.root.add(this.starField);
  }

  update(
    delta: number,
    elapsed: number,
    cameraPosition: THREE.Vector3,
    state: SkyState,
  ): void {
    this.root.position.set(cameraPosition.x, 0, cameraPosition.z);
    this.uniforms.uTopColor.value.copy(state.topColor);
    this.uniforms.uHorizonColor.value.copy(state.horizonColor);
    this.uniforms.uGroundColor.value.copy(state.groundColor);
    this.uniforms.uSunColor.value.copy(state.sunColor);
    this.uniforms.uSunDirection.value.copy(state.sunDirection);
    this.uniforms.uMoonColor.value.copy(state.moonColor);
    this.uniforms.uMoonDirection.value.copy(state.moonDirection);
    this.uniforms.uNight.value = state.night;
    this.uniforms.uTwilight.value = state.twilight;
    this.uniforms.uCloudCover.value = state.cloudCover;
    this.uniforms.uStorm.value = state.storm;
    this.uniforms.uTime.value = elapsed;

    this.sunSprite.position.copy(state.sunDirection).multiplyScalar(1100);
    this.sunSprite.position.y = Math.max(this.sunSprite.position.y, -220);
    const sunOpacity =
      (1 - state.night) *
      (0.35 + state.sunColor.r * 0.55) *
      (1 - state.storm * 0.92) *
      (1 - state.cloudCover * 0.42);
    this.sunSprite.material.opacity = state.storm > 0.42 ? 0 : THREE.MathUtils.clamp(sunOpacity, 0, 0.95);
    this.moonSprite.position.copy(state.moonDirection).multiplyScalar(1100);
    this.moonSprite.material.opacity = state.night * 0.6 * (1 - state.cloudCover * 0.5);
    (this.starField.material as THREE.PointsMaterial).opacity =
      state.night * (1 - state.cloudCover * 0.55) * 0.9;
    this.starField.rotation.y = elapsed * 0.004;

    const cloudTint = state.horizonColor
      .clone()
      .lerp(new THREE.Color('#ffffff'), 0.35)
      .lerp(new THREE.Color('#4d5b60'), state.storm * 0.55)
      .multiplyScalar(0.75 + (1 - state.night) * 0.35);
    this.cloudMaterial.color.copy(cloudTint);
    this.cloudMaterial.opacity =
      0.06 + state.cloudCover * 0.3 + state.storm * 0.18;

    for (const cloud of this.clouds) {
      const angle = elapsed * 0.006 * cloud.userData.speed;
      cloud.position.x += Math.cos(angle + cloud.userData.offset) * delta * 3.2;
      cloud.position.z += Math.sin(angle + cloud.userData.offset) * delta * 1.6;
      const radius = Math.hypot(cloud.position.x, cloud.position.z);
      if (radius > 1150) {
        cloud.position.x *= 0.55;
        cloud.position.z *= 0.55;
      }
    }
  }
}
