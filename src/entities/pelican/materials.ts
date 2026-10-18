import * as THREE from 'three';

/**
 * Shared material roles for the pelican hero rig.
 *
 * The whole rider is built from a small named palette so every part reuses one
 * of these instances. Colours are authored for a sunset coastal scene rendered
 * through ACES filmic tone mapping, so the creams are deliberately warm and the
 * metals sit a little darker than their albedo.
 */
export interface RiderMaterialSet {
  frameCream: THREE.MeshPhysicalMaterial;
  frameTeal: THREE.MeshPhysicalMaterial;
  brass: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  leatherDark: THREE.MeshStandardMaterial;
  pelicanWhite: THREE.MeshStandardMaterial;
  pelicanShade: THREE.MeshStandardMaterial;
  feather: THREE.MeshStandardMaterial;
  primaryTip: THREE.MeshStandardMaterial;
  beak: THREE.MeshStandardMaterial;
  beakSeam: THREE.MeshStandardMaterial;
  pouch: THREE.MeshStandardMaterial;
  leg: THREE.MeshStandardMaterial;
  eye: THREE.MeshPhysicalMaterial;
  eyeHighlight: THREE.MeshBasicMaterial;
  eyeRing: THREE.MeshStandardMaterial;
  scarf: THREE.MeshStandardMaterial;
  scarfDark: THREE.MeshStandardMaterial;
  wicker: THREE.MeshStandardMaterial;
  fish: THREE.MeshStandardMaterial;
  fishFin: THREE.MeshStandardMaterial;
  shell: THREE.MeshStandardMaterial;
  lampGlass: THREE.MeshStandardMaterial;
  taillight: THREE.MeshStandardMaterial;
  reflector: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
  contactShadow: THREE.MeshBasicMaterial;
}

function standard(
  name: string,
  parameters: THREE.MeshStandardMaterialParameters,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ envMapIntensity: 0.9, ...parameters });
  material.name = name;
  return material;
}

function physical(
  name: string,
  parameters: THREE.MeshPhysicalMaterialParameters,
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ envMapIntensity: 1, ...parameters });
  material.name = name;
  return material;
}

export function createRiderMaterials(
  plateMap: THREE.Texture | null,
  contactMap: THREE.Texture,
): RiderMaterialSet {
  return {
    // --- Bicycle paint and trim -------------------------------------------------
    frameCream: physical('frameCream', {
      color: 0xf3e7cd,
      roughness: 0.34,
      metalness: 0.14,
      clearcoat: 0.5,
      clearcoatRoughness: 0.28,
    }),
    frameTeal: physical('frameTeal', {
      color: 0x1f6f68,
      roughness: 0.38,
      metalness: 0.12,
      clearcoat: 0.45,
      clearcoatRoughness: 0.3,
    }),
    brass: standard('brass', {
      color: 0xc08a3e,
      metalness: 0.82,
      roughness: 0.28,
      envMapIntensity: 1.35,
    }),
    steel: standard('steel', {
      color: 0x8f9297,
      metalness: 0.86,
      roughness: 0.32,
      envMapIntensity: 1.15,
    }),
    rubber: standard('rubber', {
      color: 0x1b1a1a,
      roughness: 0.92,
      metalness: 0.02,
    }),
    leather: standard('leather', {
      color: 0x7a4a2c,
      roughness: 0.56,
      metalness: 0.02,
    }),
    leatherDark: standard('leatherDark', {
      color: 0x59341f,
      roughness: 0.6,
      metalness: 0.02,
    }),

    // --- Pelican plumage --------------------------------------------------------
    pelicanWhite: standard('pelicanWhite', {
      color: 0xf1e8d6,
      roughness: 0.62,
      metalness: 0.0,
      envMapIntensity: 0.7,
    }),
    pelicanShade: standard('pelicanShade', {
      color: 0xe4d8bf,
      roughness: 0.7,
      metalness: 0.0,
      envMapIntensity: 0.6,
    }),
    feather: standard('feather', {
      color: 0xece2cf,
      roughness: 0.74,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.55,
    }),
    primaryTip: standard('primaryTip', {
      color: 0x464b49,
      roughness: 0.7,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.45,
    }),

    // --- Beak, legs, eyes -------------------------------------------------------
    beak: standard('beak', {
      color: 0xef8a36,
      roughness: 0.42,
      metalness: 0.0,
      emissive: 0x2a1003,
      emissiveIntensity: 0.18,
    }),
    beakSeam: standard('beakSeam', {
      color: 0x8c4319,
      roughness: 0.52,
      metalness: 0.0,
    }),
    pouch: standard('pouch', {
      color: 0xe5793f,
      roughness: 0.56,
      metalness: 0.0,
      emissive: 0x2c0e04,
      emissiveIntensity: 0.14,
      side: THREE.DoubleSide,
    }),
    leg: standard('leg', {
      color: 0xe8852f,
      roughness: 0.48,
      metalness: 0.0,
      emissive: 0x200c02,
      emissiveIntensity: 0.12,
    }),
    eye: physical('eye', {
      color: 0x07080a,
      roughness: 0.05,
      metalness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.6,
    }),
    eyeHighlight: new THREE.MeshBasicMaterial({ color: 0xfffdf4, toneMapped: false }),
    eyeRing: standard('eyeRing', {
      color: 0xd9a24b,
      roughness: 0.5,
      metalness: 0.0,
    }),

    // --- Cloth, wicker, catch ---------------------------------------------------
    scarf: standard('scarf', {
      color: 0xe8573e,
      roughness: 0.72,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.6,
    }),
    scarfDark: standard('scarfDark', {
      color: 0xb83e2c,
      roughness: 0.74,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    wicker: standard('wicker', {
      color: 0xc79a5c,
      roughness: 0.86,
      metalness: 0.0,
      flatShading: true,
    }),
    fish: standard('fish', {
      color: 0x8fa9b8,
      roughness: 0.32,
      metalness: 0.55,
      envMapIntensity: 1.1,
    }),
    fishFin: standard('fishFin', {
      color: 0x647f92,
      roughness: 0.42,
      metalness: 0.25,
      side: THREE.DoubleSide,
    }),
    shell: standard('shell', {
      color: 0xf0dcc0,
      roughness: 0.4,
      metalness: 0.0,
    }),

    // --- Lights and signage -----------------------------------------------------
    lampGlass: standard('lampGlass', {
      color: 0xfff0c8,
      roughness: 0.18,
      metalness: 0.0,
      emissive: 0xffc46b,
      emissiveIntensity: 1.4,
    }),
    taillight: standard('taillight', {
      color: 0xff3a22,
      roughness: 0.3,
      metalness: 0.0,
      emissive: 0xff2200,
      emissiveIntensity: 1.2,
    }),
    reflector: standard('reflector', {
      color: 0xff9a2e,
      roughness: 0.4,
      metalness: 0.0,
      emissive: 0xff7a18,
      emissiveIntensity: 0.35,
    }),
    plate: standard('plate', {
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.08,
      map: plateMap,
    }),
    contactShadow: new THREE.MeshBasicMaterial({
      map: contactMap,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  };
}

export function disposeRiderMaterials(materials: RiderMaterialSet): void {
  const seen = new Set<THREE.Material>();
  for (const material of Object.values(materials) as THREE.Material[]) {
    if (seen.has(material)) continue;
    seen.add(material);
    const map = (material as THREE.MeshStandardMaterial).map;
    map?.dispose();
    material.dispose();
  }
}
