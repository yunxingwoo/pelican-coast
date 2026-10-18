import * as THREE from 'three';

export interface GeneratedEnvironmentMap {
  texture: THREE.Texture;
  target: THREE.WebGLRenderTarget;
  dispose(): void;
}

/**
 * A small coastal studio environment for PBR metal/glass reflections. The
 * painted gradient follows the same warm horizon / cool zenith palette as the
 * sky so brass, chrome and wet asphalt stay coherent with the world.
 */
export function createCoastalEnvironmentMap(
  renderer: THREE.WebGLRenderer,
): GeneratedEnvironmentMap {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create environment canvas.');

  const sky = context.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, '#2a6b93');
  sky.addColorStop(0.36, '#6b9eb2');
  sky.addColorStop(0.5, '#ecc9a0');
  sky.addColorStop(0.54, '#b18b73');
  sky.addColorStop(0.7, '#265d67');
  sky.addColorStop(1, '#073641');
  context.fillStyle = sky;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const sun = context.createRadialGradient(
    canvas.width * 0.22,
    canvas.height * 0.46,
    0,
    canvas.width * 0.22,
    canvas.height * 0.46,
    180,
  );
  sun.addColorStop(0, 'rgba(255, 245, 205, 1)');
  sun.addColorStop(0.18, 'rgba(255, 218, 150, 0.72)');
  sun.addColorStop(1, 'rgba(255, 196, 120, 0)');
  context.fillStyle = sun;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 26; i += 1) {
    const x = (i / 26) * canvas.width + Math.sin(i * 2.1) * 80;
    const y = canvas.height * (0.24 + (i % 5) * 0.035);
    const w = 90 + (i % 4) * 50;
    const h = 14 + (i % 3) * 9;
    const cloud = context.createRadialGradient(x, y, 0, x, y, w);
    cloud.addColorStop(0, 'rgba(255, 244, 225, 0.22)');
    cloud.addColorStop(1, 'rgba(255, 244, 225, 0)');
    context.fillStyle = cloud;
    context.beginPath();
    context.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(texture);
  texture.dispose();
  pmrem.dispose();

  return {
    texture: target.texture,
    target,
    dispose: () => target.dispose(),
  };
}
