import * as THREE from 'three';
import { PelicanRider } from '../src/entities/PelicanRider';
import type { RiderVisualState } from '../src/types';

interface PreviewView {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const VIEWS: Record<string, PreviewView> = {
  chase: {
    position: new THREE.Vector3(0, 2.2, -5.05),
    target: new THREE.Vector3(0, 1.32, 0.12),
  },
  front: {
    position: new THREE.Vector3(3.55, 2.05, 4.35),
    target: new THREE.Vector3(0, 1.22, 0.22),
  },
  side: {
    position: new THREE.Vector3(5.6, 1.75, 0.35),
    target: new THREE.Vector3(0, 1.15, 0.05),
  },
};

const params = new URLSearchParams(window.location.search);
const frozen = params.get('freeze') === '1';
let viewName = params.get('view') ?? 'chase';
if (!(viewName in VIEWS)) viewName = 'chase';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (!canvas) throw new Error('Missing #stage canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x5d5d6e, 24, 70);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 160);

// --- Sunset sky ---------------------------------------------------------------
const skyUniforms = {
  topColor: { value: new THREE.Color(0x1d2a44) },
  midColor: { value: new THREE.Color(0x8d6a78) },
  horizonColor: { value: new THREE.Color(0xffb877) },
  sunColor: { value: new THREE.Color(0xffd9a0) },
  sunDirection: { value: new THREE.Vector3(-0.72, 0.16, -0.68).normalize() },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(110, 40, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      varying vec3 vWorldPosition;
      void main() {
        vec3 direction = normalize(vWorldPosition);
        float height = clamp(direction.y, -0.15, 1.0);
        float horizonMix = smoothstep(-0.02, 0.24, height);
        vec3 color = mix(horizonColor, midColor, smoothstep(0.0, 0.22, height));
        color = mix(color, topColor, smoothstep(0.16, 0.72, height));
        float sun = pow(max(dot(direction, sunDirection), 0.0), 180.0);
        float glow = pow(max(dot(direction, sunDirection), 0.0), 7.0);
        color += sunColor * sun * 2.2 + sunColor * glow * 0.24;
        float band = smoothstep(0.06, 0.0, abs(height - 0.01));
        color += vec3(0.32, 0.2, 0.16) * band * 0.5;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }),
);
scene.add(sky);

// --- Lighting -----------------------------------------------------------------
const hemisphere = new THREE.HemisphereLight(0xbfd3e8, 0x4c3a2c, 0.7);
scene.add(hemisphere);

const key = new THREE.DirectionalLight(0xffd2a2, 2.55);
key.position.set(-5.5, 5.2, -4.4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 24;
key.shadow.camera.left = -4.2;
key.shadow.camera.right = 4.2;
key.shadow.camera.top = 4.2;
key.shadow.camera.bottom = -4.2;
key.shadow.bias = -0.0008;
key.shadow.normalBias = 0.02;
scene.add(key);
scene.add(key.target);

const fill = new THREE.DirectionalLight(0xffe6cf, 0.95);
fill.position.set(4.5, 3.2, 4.5);
scene.add(fill);

const rim = new THREE.DirectionalLight(0x86c3ff, 1.2);
rim.position.set(4.2, 3.6, -5.4);
scene.add(rim);

// Warm bounce from the camera side keeps the chase-view back readable.
const backFill = new THREE.DirectionalLight(0xffd7ac, 0.65);
backFill.position.set(0.6, 1.8, -5.5);
scene.add(backFill);

// --- Coastal road -------------------------------------------------------------
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(70, 64),
  new THREE.MeshStandardMaterial({ color: 0x8a7358, roughness: 0.97, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const road = new THREE.Mesh(
  new THREE.PlaneGeometry(4.4, 80),
  new THREE.MeshStandardMaterial({ color: 0x3d3b3d, roughness: 0.9, metalness: 0.02 }),
);
road.rotation.x = -Math.PI / 2;
road.position.y = 0.004;
road.receiveShadow = true;
scene.add(road);

const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xe7d9b6, roughness: 0.7 });
for (const side of [-1, 1]) {
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.012, 80), lineMaterial);
  edge.position.set(side * 2.08, 0.008, 0);
  scene.add(edge);
}

const dashGeometry = new THREE.BoxGeometry(0.06, 0.012, 0.85);
for (let i = 0; i < 26; i++) {
  const dash = new THREE.Mesh(dashGeometry, lineMaterial);
  dash.position.set(0, 0.008, -38 + i * 3);
  scene.add(dash);
}

// Dune mounds + beach grass at the edges keep the stage from floating in void.
const duneMaterial = new THREE.MeshStandardMaterial({ color: 0x9b8562, roughness: 1 });
const duneGeometry = new THREE.SphereGeometry(1, 18, 12);
for (let i = 0; i < 9; i++) {
  const side = i % 2 === 0 ? -1 : 1;
  const dune = new THREE.Mesh(duneGeometry, duneMaterial);
  const scale = 1.3 + ((i * 7) % 5) * 0.42;
  dune.scale.set(scale * 1.6, scale * 0.28, scale);
  dune.position.set(side * (5.5 + ((i * 3) % 7) * 0.9), 0, -20 + i * 5.2);
  dune.rotation.y = i * 0.7;
  dune.castShadow = true;
  dune.receiveShadow = true;
  scene.add(dune);
}
const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x6c6b44, roughness: 0.9, side: THREE.DoubleSide });
const grassGeometry = new THREE.ConeGeometry(0.03, 0.42, 3);
for (let i = 0; i < 40; i++) {
  const side = i % 2 === 0 ? -1 : 1;
  const grass = new THREE.Mesh(grassGeometry, grassMaterial);
  grass.position.set(
    side * (2.55 + ((i * 11) % 9) * 0.22),
    0.21,
    -22 + ((i * 17) % 44) + ((i * 13) % 5) * 0.4,
  );
  grass.rotation.z = ((i % 4) - 1.5) * 0.28;
  grass.rotation.x = ((i % 3) - 1) * 0.18;
  scene.add(grass);
}

// A couple of roadside posts for depth and speed cues.
const postMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5340, roughness: 0.85 });
for (let i = 0; i < 6; i++) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.8, 8), postMaterial);
  post.position.set(-2.62, 0.4, -16 + i * 6.2);
  post.castShadow = true;
  scene.add(post);
}

// --- Hero ---------------------------------------------------------------------
const rider = new PelicanRider();
rider.group.position.set(0, 0, 0);
scene.add(rider.group);

// --- Camera control -----------------------------------------------------------
const target = VIEWS[viewName].target.clone();
const offset = VIEWS[viewName].position.clone().sub(target);
let yaw = 0;
let pitch = 0;
let dragging = false;
let previousX = 0;
let previousY = 0;

const applyCamera = (): void => {
  const base = VIEWS[viewName];
  target.copy(base.target);
  offset.copy(base.position).sub(base.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta += yaw;
  spherical.phi = THREE.MathUtils.clamp(spherical.phi + pitch, 0.22, 1.48);
  offset.setFromSpherical(spherical);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
};

canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  previousX = event.clientX;
  previousY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointerup', (event) => {
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  yaw -= (event.clientX - previousX) * 0.005;
  pitch -= (event.clientY - previousY) * 0.003;
  previousX = event.clientX;
  previousY = event.clientY;
});

const viewLabel = document.querySelector<HTMLElement>('#r-view');
const speedLabel = document.querySelector<HTMLElement>('#r-speed');
const steerLabel = document.querySelector<HTMLElement>('#r-steer');
const leanLabel = document.querySelector<HTMLElement>('#r-lean');
const setView = (name: string): void => {
  if (!(name in VIEWS)) return;
  viewName = name;
  yaw = 0;
  pitch = 0;
  if (viewLabel) viewLabel.textContent = name;
};
window.addEventListener('keydown', (event) => {
  if (event.key === '1') setView('chase');
  if (event.key === '2') setView('front');
  if (event.key === '3') setView('side');
});

// --- Animation state ----------------------------------------------------------
const createState = (time: number): RiderVisualState => {
  const speed = 9.4 + Math.sin(time * 0.55) * 2.6;
  const steer = Math.sin(time * 0.72) * 0.26 + Math.sin(time * 1.7) * 0.05;
  return {
    speed,
    speedRatio: THREE.MathUtils.clamp(speed / 14, 0, 1),
    steer,
    lean: steer * 0.72,
    pedalling: 1,
    throttle: 0.8 + Math.sin(time * 0.9) * 0.12,
    brake: Math.max(0, Math.sin(time * 0.31) - 0.9) * 2.2,
    boost: 0.3,
    daylight: 0.32,
    lampIntensity: 0.95,
    windSpeed: 7.5 + Math.sin(time * 0.4) * 1.6,
    windBearing: 1.2,
    crashed: false,
    elapsed: time,
  };
};

const crashedParam = params.get('crashed') === '1';
const frozenState: RiderVisualState = {
  speed: 11.6,
  speedRatio: 0.83,
  steer: 0.17,
  lean: 0.13,
  pedalling: 1,
  throttle: 0.86,
  brake: 0,
  boost: 0.3,
  daylight: 0.3,
  lampIntensity: 0.95,
  windSpeed: 8.2,
  windBearing: 1.2,
  crashed: crashedParam,
  elapsed: 1.7,
  reducedMotion: false,
};
if (crashedParam) {
  frozenState.speed = 2.2;
  frozenState.speedRatio = 0.16;
  frozenState.steer = 0.05;
  frozenState.lean = -0.22;
  frozenState.throttle = 0;
  frozenState.brake = 1;
  frozenState.daylight = 0.18;
}

if (frozen) {
  for (let i = 0; i < 110; i++) {
    rider.update(1 / 60, { ...frozenState, elapsed: 1.7 });
  }
  rider.stabilizeVisuals();
  rider.update(0, frozenState);
}

// --- Loop ---------------------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = frozen ? frozenState.elapsed : 0;
let firstFrame = true;

const resize = (): void => {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);

const frame = (): void => {
  const delta = Math.min(clock.getDelta(), 0.05);
  let state: RiderVisualState;
  if (frozen) {
    state = frozenState;
    rider.update(0, state);
  } else {
    elapsed += delta;
    state = createState(elapsed);
    rider.update(delta, state);
  }

  if (speedLabel) speedLabel.textContent = (state.speed * 3.6).toFixed(0);
  if (steerLabel) steerLabel.textContent = state.steer.toFixed(2);
  if (leanLabel) leanLabel.textContent = state.lean.toFixed(2);

  applyCamera();
  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    (window as unknown as { __heroPreviewReady: boolean }).__heroPreviewReady = true;
  }
  requestAnimationFrame(frame);
};

resize();
applyCamera();
requestAnimationFrame(frame);

// Debug handle used by the screenshot script.
const debugHandle = {
  rider,
  scene,
  camera,
  renderer,
  setView,
  get stats(): Record<string, number> {
    const info = renderer.info;
    let meshes = 0;
    rider.group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes++;
    });
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      meshes,
    };
  },
};
(window as unknown as { __heroPreview: typeof debugHandle }).__heroPreview = debugHandle;
