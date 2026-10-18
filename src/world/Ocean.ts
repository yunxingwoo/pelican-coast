import * as THREE from 'three';

export interface OceanUniforms {
  uTime: { value: number };
  uSunDirection: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSkyColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uDeepColor: { value: THREE.Color };
  uShallowColor: { value: THREE.Color };
  uNight: { value: number };
  uStorm: { value: number };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uWindDirection: { value: THREE.Vector2 };
  uWindStrength: { value: number };
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uStorm;
  uniform vec2 uWindDirection;
  uniform float uWindStrength;
  varying vec3 vWorldPosition;
  varying vec3 vWaveNormal;
  varying float vWaveHeight;

  float waveHeight(vec2 p) {
    float time = uTime;
    vec2 wind = normalize(uWindDirection + vec2(0.0001));
    vec2 crossWind = vec2(-wind.y, wind.x);
    float direction = dot(p, wind);
    float side = dot(p, crossWind);
    float swell =
      sin(direction * 0.052 + time * 0.72) * 0.55 +
      sin(direction * 0.11 - time * 1.13) * 0.26 +
      sin(side * 0.19 + time * 1.4) * 0.12 +
      sin(direction * 0.23 + side * 0.12 + time * 1.9) * 0.06;
    float chop = sin(direction * 0.37 + time * 2.6) * 0.035;
    return (swell + chop) * (0.55 + uStorm * 1.35) * (0.55 + uWindStrength * 0.8);
  }

  void main() {
    vec3 pos = position;
    float h = waveHeight(pos.xz);
    pos.y += h;
    float eps = 1.1;
    float hx = waveHeight(pos.xz + vec2(eps, 0.0));
    float hz = waveHeight(pos.xz + vec2(0.0, eps));
    vec3 worldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    vWorldPosition = worldPos;
    vWaveHeight = h;
    vWaveNormal = normalize(vec3(-(hx - h) / eps, 1.0, -(hz - h) / eps));
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform float uNight;
  uniform float uStorm;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec2 uWindDirection;
  uniform float uWindStrength;
  varying vec3 vWorldPosition;
  varying vec3 vWaveNormal;
  varying float vWaveHeight;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 normal = normalize(vWaveNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    float radius = length(vWorldPosition.xz);
    float shore = 1.0 - smoothstep(155.0, 380.0, radius);

    vec3 water = mix(uDeepColor, uShallowColor, shore * 0.72);
    water = mix(water, uHorizonColor * 0.42, fresnel * 0.2);

    vec3 reflected = reflect(-viewDir, normal);
    vec3 skyReflection = mix(uHorizonColor * 0.45, uSkyColor, clamp(reflected.y * 1.5, 0.0, 1.0));
    water = mix(water, skyReflection, fresnel * 0.42);

    float sunAmount = max(dot(reflected, normalize(uSunDirection)), 0.0);
    float specular = pow(sunAmount, 180.0) * (0.7 + uStorm * 0.15);
    float sparkle = pow(sunAmount, 30.0) * 0.08;
    water += uSunColor * (specular + sparkle);
    water += mix(vec3(0.008, 0.035, 0.042), vec3(0.06, 0.15, 0.14), shore) * (1.0 - uNight);

    float foamNoise = noise(vWorldPosition.xz * 0.32 + vec2(uTime * 0.08, -uTime * 0.05));
    float foamDetail = noise(vWorldPosition.xz * 1.1 - vec2(uTime * 0.16, uTime * 0.1));
    float foam = smoothstep(0.62, 0.82, foamNoise + foamDetail * 0.28);
    float foamMask = smoothstep(0.55, 0.95, shore) + smoothstep(0.18, 0.42, vWaveHeight) * 0.22;
    foam *= foamMask * (0.22 + uStorm * 1.4);
    water = mix(water, vec3(0.9, 0.96, 0.93), clamp(foam, 0.0, 0.5));

    // Whitecaps far out, denser in storm.
    float chop = noise(vWorldPosition.xz * 0.5 + vec2(-uTime * 0.1, uTime * 0.05));
    float whitecap = smoothstep(0.78, 0.98, chop + vWaveHeight * 0.5) * uStorm;
    water = mix(water, vec3(0.82, 0.88, 0.86), whitecap * 0.35);

    water = mix(water, uHorizonColor * 0.7, 1.0 - exp(-pow(distance(cameraPosition, vWorldPosition) / uFogFar, 1.35)));
    water *= mix(1.0, 0.72, uStorm);
    water *= mix(0.14, 1.0, 1.0 - uNight);
    water += vec3(0.0, 0.008, 0.012) * (1.0 - uNight);
    gl_FragColor = vec4(water, 1.0);
  }
`;

export class Ocean {
  readonly mesh: THREE.Mesh;
  readonly uniforms: OceanUniforms;

  constructor() {
    const geometry = new THREE.PlaneGeometry(2800, 2800, 190, 190);
    geometry.rotateX(-Math.PI / 2);
    this.uniforms = {
      uTime: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(0.4, 0.6, 0.2).normalize() },
      uSunColor: { value: new THREE.Color('#ffdca8') },
      uSkyColor: { value: new THREE.Color('#6fa5b5') },
      uHorizonColor: { value: new THREE.Color('#e8cfac') },
      uDeepColor: { value: new THREE.Color('#0c5366') },
      uShallowColor: { value: new THREE.Color('#3d9d99') },
      uNight: { value: 0 },
      uStorm: { value: 0 },
      uFogNear: { value: 220 },
      uFogFar: { value: 1500 },
      uWindDirection: { value: new THREE.Vector2(0.72, 0.69) },
      uWindStrength: { value: 0.5 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = -0.18;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'ocean';
    this.mesh.frustumCulled = false;
  }

  update(
    elapsed: number,
    state: {
      night: number;
      storm: number;
      windDirection: THREE.Vector2;
      windStrength: number;
      sunDirection: THREE.Vector3;
      sunColor: THREE.Color;
      skyColor: THREE.Color;
      horizonColor: THREE.Color;
      fogFar: number;
    },
  ): void {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uNight.value = state.night;
    this.uniforms.uStorm.value = state.storm;
    this.uniforms.uWindDirection.value.copy(state.windDirection);
    this.uniforms.uWindStrength.value = state.windStrength;
    this.uniforms.uSunDirection.value.copy(state.sunDirection);
    this.uniforms.uSunColor.value.copy(state.sunColor);
    this.uniforms.uSkyColor.value.copy(state.skyColor);
    this.uniforms.uHorizonColor.value.copy(state.horizonColor);
    this.uniforms.uFogFar.value = state.fogFar;
  }
}
