import * as THREE from 'three';

export type RandomSource = () => number;

export function createCanvasTexture(
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable.');
  draw(context, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function createAsphaltTexture(rng: RandomSource): THREE.CanvasTexture {
  return createCanvasTexture(1024, 1024, (context, width, height) => {
    context.fillStyle = '#4d5659';
    context.fillRect(0, 0, width, height);

    for (let i = 0; i < 42000; i += 1) {
      const x = rng() * width;
      const y = rng() * height;
      const size = 0.5 + rng() * 2.2;
      const light = 40 + rng() * 60;
      context.fillStyle = `rgba(${light + 16}, ${light + 22}, ${light + 24}, ${0.08 + rng() * 0.22})`;
      context.fillRect(x, y, size, size);
    }

    // Aggregate speckles and fine seams.
    for (let i = 0; i < 90; i += 1) {
      const x = rng() * width;
      const y = rng() * height;
      const radius = 0.6 + rng() * 2.4;
      context.fillStyle = `rgba(218, 210, 192, ${0.04 + rng() * 0.12})`;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }

    context.strokeStyle = 'rgba(27, 33, 35, 0.35)';
    for (let i = 0; i < 5; i += 1) {
      context.lineWidth = 0.6 + rng();
      context.beginPath();
      let x = rng() * width;
      let y = rng() * height;
      context.moveTo(x, y);
      for (let s = 0; s < 6; s += 1) {
        x += (rng() - 0.5) * 46;
        y += (rng() - 0.5) * 46;
        context.lineTo(x, y);
      }
      context.stroke();
    }

    // Faint tyre polish down the centre of the lane.
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, 'rgba(26, 31, 33, 0)');
    gradient.addColorStop(0.42, 'rgba(26, 31, 33, 0.16)');
    gradient.addColorStop(0.58, 'rgba(26, 31, 33, 0.16)');
    gradient.addColorStop(1, 'rgba(26, 31, 33, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  });
}

export function createAsphaltRoughness(rng: RandomSource): THREE.CanvasTexture {
  return createCanvasTexture(256, 256, (context, width, height) => {
    context.fillStyle = '#8a8a8a';
    context.fillRect(0, 0, width, height);
    for (let i = 0; i < 4200; i += 1) {
      const value = 90 + Math.floor(rng() * 110);
      context.fillStyle = `rgb(${value}, ${value}, ${value})`;
      const size = 0.6 + rng() * 2.4;
      context.fillRect(rng() * width, rng() * height, size, size);
    }
    // Slightly glossier wheel tracks.
    context.fillStyle = 'rgba(58, 58, 58, 0.4)';
    context.fillRect(width * 0.24, 0, width * 0.14, height);
    context.fillRect(width * 0.62, 0, width * 0.14, height);
  });
}

export function createSignTexture(
  title: string,
  subtitle: string,
  accent = '#ff6b4a',
): THREE.CanvasTexture {
  return createCanvasTexture(512, 256, (context, width, height) => {
    context.fillStyle = '#f2e6cd';
    context.fillRect(0, 0, width, height);
    context.fillStyle = accent;
    context.fillRect(0, 0, width, 18);
    context.fillRect(0, height - 18, width, 18);
    context.strokeStyle = '#0b2f34';
    context.lineWidth = 4;
    context.strokeRect(13, 13, width - 26, height - 26);

    context.fillStyle = '#0b2f34';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '700 76px "Avenir Next Condensed", "DIN Condensed", sans-serif';
    context.fillText(title.toUpperCase(), width / 2, height * 0.43);
    context.font = '600 34px "PingFang SC", "Avenir Next", sans-serif';
    context.fillStyle = '#2c6468';
    context.fillText(subtitle, width / 2, height * 0.7);
  });
}

export function createBikeLaneTexture(): THREE.CanvasTexture {
  return createCanvasTexture(256, 256, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    context.strokeStyle = '#f5ecd6';
    context.lineWidth = 13;
    context.lineCap = 'round';
    // Simplified bicycle glyph.
    context.beginPath();
    context.arc(70, 168, 42, 0, Math.PI * 2);
    context.arc(186, 168, 42, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(70, 168);
    context.lineTo(102, 100);
    context.lineTo(146, 100);
    context.lineTo(122, 168);
    context.lineTo(186, 168);
    context.moveTo(102, 100);
    context.lineTo(128, 78);
    context.lineTo(158, 78);
    context.stroke();
  });
}

export function createSoftCircleTexture(
  inner = 'rgba(255,255,255,1)',
  outer = 'rgba(255,255,255,0)',
  size = 128,
): THREE.CanvasTexture {
  return createCanvasTexture(size, size, (context, width, height) => {
    const gradient = context.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      width / 2,
    );
    gradient.addColorStop(0, inner);
    gradient.addColorStop(1, outer);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  });
}

export function createCloudTexture(rng: RandomSource): THREE.CanvasTexture {
  return createCanvasTexture(256, 160, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    const puffs = 16;
    for (let i = 0; i < puffs; i += 1) {
      const x = width * (0.18 + rng() * 0.64);
      const y = height * (0.36 + rng() * 0.32);
      const radius = 22 + rng() * 44;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, 'rgba(255, 252, 244, 0.62)');
      gradient.addColorStop(0.55, 'rgba(250, 244, 230, 0.3)');
      gradient.addColorStop(1, 'rgba(250, 244, 230, 0)');
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  });
}

export function createFoamTexture(rng: RandomSource): THREE.CanvasTexture {
  return createCanvasTexture(256, 256, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 70; i += 1) {
      context.lineWidth = 1 + rng() * 3;
      context.beginPath();
      const y = rng() * height;
      context.moveTo(0, y);
      for (let x = 0; x <= width; x += 16) {
        context.lineTo(x, y + Math.sin(x * 0.05 + rng() * 2) * 6);
      }
      context.stroke();
    }
  });
}

export function createLampGlowTexture(): THREE.CanvasTexture {
  return createCanvasTexture(128, 128, (context, width, height) => {
    const gradient = context.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      width / 2,
    );
    gradient.addColorStop(0, 'rgba(255, 231, 170, 0.95)');
    gradient.addColorStop(0.25, 'rgba(255, 193, 100, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 165, 80, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  });
}
