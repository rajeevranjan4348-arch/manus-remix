/**
 * Zero-404 Procedural Textures, Normal Maps, and Studio PBR Materials for Three.js
 *
 * Enforces:
 * - Explicit SRGBColorSpace on color/albedo maps, linear NoColorSpace on data maps
 * - Max hardware anisotropy on procedural dials, grids, and fine markings
 * - Anisotropic brushed metals, optical glass transmission (with software-WebGL fallback),
 *   and custom PBR shader extension via `material.onBeforeCompile`
 */

import * as THREE from 'three';
import {
  PROCEDURAL_3D_FINISHES,
  StudioFinishId,
} from './threeSceneSpec';

export interface StudioMaterialSuite {
  primaryMetal: THREE.MeshPhysicalMaterial;
  secondaryMetal: THREE.MeshPhysicalMaterial;
  accentMetal: THREE.MeshPhysicalMaterial;
  satinChassis: THREE.MeshStandardMaterial;
  matteComposite: THREE.MeshStandardMaterial;
  dialSurface: THREE.MeshStandardMaterial;
  opticalGlass: THREE.MeshPhysicalMaterial;
  emissiveAccent: THREE.MeshStandardMaterial;
  rippleWater: THREE.MeshPhysicalMaterial;
  contactShadow: THREE.MeshBasicMaterial;
  floorGrid: THREE.MeshStandardMaterial;
  textures: THREE.Texture[];
  dispose: () => void;
}

/**
 * Generates a high-resolution procedural horological / astrolabe dial texture (`SRGBColorSpace`).
 */
export function createProceduralDialTexture(
  maxAnisotropy: number,
  primaryHex: string,
  accentHex: string
): THREE.Texture {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const cx = 256;
      const cy = 256;

      // Radial guilloche dark slate base
      const grad = ctx.createRadialGradient(cx, cy, 12, cx, cy, 250);
      grad.addColorStop(0, '#1e2430');
      grad.addColorStop(0.65, '#12161f');
      grad.addColorStop(1, '#090b10');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 512);

      // Concentric guilloche rings
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let r = 36; r <= 236; r += 14) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 60 minute / degree tick marks
      for (let i = 0; i < 60; i++) {
        const angle = (i / 60) * Math.PI * 2;
        const isMajor = i % 5 === 0;
        const innerR = isMajor ? 202 : 216;
        const outerR = 232;
        ctx.strokeStyle = isMajor ? primaryHex : 'rgba(255,255,255,0.45)';
        ctx.lineWidth = isMajor ? 3 : 1.25;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
        ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
        ctx.stroke();
      }

      // Sub-dial rings
      const subDials = [
        { x: cx - 78, y: cy, r: 44 },
        { x: cx + 78, y: cy, r: 44 },
        { x: cx, y: cy + 82, r: 40 },
      ];
      for (const sd of subDials) {
        ctx.strokeStyle = accentHex;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(sd.x, sd.y, sd.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.max(1, maxAnisotropy);
      tex.needsUpdate = true;
      return tex;
    }
  }

  // Headless / Node fallback DataTexture
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const stride = i * 4;
    data[stride] = 24;
    data[stride + 1] = 28;
    data[stride + 2] = 36;
    data[stride + 3] = 255;
  }
  const fallback = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  fallback.colorSpace = THREE.SRGBColorSpace;
  fallback.anisotropy = Math.max(1, maxAnisotropy);
  fallback.needsUpdate = true;
  return fallback;
}

/**
 * Generates a linear-space brushed metal normal map (`NoColorSpace`) for anisotropic highlights.
 */
export function createProceduralBrushedNormalMap(maxAnisotropy: number): THREE.DataTexture {
  const width = 128;
  const height = 128;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const microGroove = Math.sin(y * 1.7 + Math.cos(x * 0.35) * 2.0) * 14;
      data[idx] = 128; // X normal
      data[idx + 1] = Math.max(0, Math.min(255, Math.round(128 + microGroove))); // Y normal
      data[idx + 2] = 245; // Z normal
      data[idx + 3] = 255;
    }
  }

  const normalTex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  normalTex.colorSpace = THREE.NoColorSpace;
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(4, 4);
  normalTex.anisotropy = Math.max(1, maxAnisotropy);
  normalTex.needsUpdate = true;
  return normalTex;
}

/**
 * Generates a radial soft contact shadow texture (`SRGBColorSpace`) to ground hero models.
 */
export function createProceduralContactShadowTexture(): THREE.Texture {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(128, 128, 16, 128, 128, 124);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
      grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.28)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    }
  }

  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - 15.5) / 15.5;
      const dy = (y - 15.5) / 15.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const alpha = Math.round((1 - d) * (1 - d) * 180);
      const idx = (y * size + x) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = alpha;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a precision studio calibration floor grid texture (`SRGBColorSpace`) with high anisotropy.
 */
export function createProceduralStudioGridTexture(maxAnisotropy: number): THREE.Texture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isBorder = x === 0 || y === 0;
      const isSub = x === 64 || y === 64;
      const idx = (y * size + x) * 4;
      const v = isBorder ? 78 : isSub ? 42 : 20;
      data[idx] = v;
      data[idx + 1] = v + 2;
      data[idx + 2] = v + 6;
      data[idx + 3] = 255;
    }
  }
  const gridTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  gridTex.colorSpace = THREE.SRGBColorSpace;
  gridTex.wrapS = THREE.RepeatWrapping;
  gridTex.wrapT = THREE.RepeatWrapping;
  gridTex.repeat.set(18, 18);
  gridTex.anisotropy = Math.max(1, maxAnisotropy);
  gridTex.needsUpdate = true;
  return gridTex;
}

/**
 * Creates a complete, zero-dependency PBR material library tailored to the selected finish and GPU profile.
 * Ensures adjacent parts vary roughness by >= 0.25 and properly handles software WebGL fallbacks.
 */
export function createStudioMaterialSuite(options: {
  finish: StudioFinishId;
  customAccentHex?: string;
  isSoftwareGl: boolean;
  maxAnisotropy: number;
  wireframe?: boolean;
}): StudioMaterialSuite {
  const finishCfg = PROCEDURAL_3D_FINISHES[options.finish] || PROCEDURAL_3D_FINISHES.brushed_gold;
  const accentHex = options.customAccentHex || finishCfg.accentHex;
  const wf = Boolean(options.wireframe);

  const dialTexture = createProceduralDialTexture(
    options.maxAnisotropy,
    finishCfg.primaryHex,
    accentHex
  );
  const brushedNormal = createProceduralBrushedNormalMap(options.maxAnisotropy);
  const contactShadowTex = createProceduralContactShadowTexture();
  const studioGridTex = createProceduralStudioGridTexture(options.maxAnisotropy);

  // 1. Primary Anisotropic Brushed Metal (low roughness ~0.16)
  const primaryMetal = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(finishCfg.primaryHex),
    metalness: finishCfg.metalness,
    roughness: finishCfg.roughness,
    anisotropy: finishCfg.anisotropy,
    anisotropyRotation: Math.PI / 4,
    clearcoat: 0.25,
    clearcoatRoughness: 0.15,
    normalMap: brushedNormal,
    normalScale: new THREE.Vector2(0.18, 0.18),
    wireframe: wf,
  });

  // 2. Secondary Contrasting Alloy (roughness delta >= 0.25 compared to primary)
  const secondaryRoughness = Math.min(0.85, finishCfg.roughness + 0.28);
  const secondaryMetal = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(finishCfg.secondaryHex),
    metalness: 0.85,
    roughness: secondaryRoughness,
    anisotropy: 0.55,
    normalMap: brushedNormal,
    normalScale: new THREE.Vector2(0.12, 0.12),
    wireframe: wf,
  });

  // 3. High-Polish Accent Detail (mirror specular ~0.08)
  const accentMetal = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(accentHex),
    metalness: 0.96,
    roughness: 0.08,
    anisotropy: 0.85,
    clearcoat: 0.6,
    clearcoatRoughness: 0.08,
    wireframe: wf,
  });

  // 4. Satin Structural Chassis (roughness 0.44)
  const satinChassis = new THREE.MeshStandardMaterial({
    color: new THREE.Color(finishCfg.primaryHex).multiplyScalar(0.75),
    metalness: 0.72,
    roughness: 0.44,
    normalMap: brushedNormal,
    normalScale: new THREE.Vector2(0.22, 0.22),
    wireframe: wf,
  });

  // 5. Matte Structural Composite / Terrain / Tyre (roughness 0.74 - high roughness contrast)
  const matteComposite = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1c2026'),
    metalness: 0.15,
    roughness: 0.74,
    wireframe: wf,
  });

  // 6. Procedural Guilloche / Technical Dial Surface
  const dialSurface = new THREE.MeshStandardMaterial({
    map: dialTexture,
    metalness: 0.32,
    roughness: 0.46,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    wireframe: wf,
  });

  // 7. Optical Sapphire / Polycarbonate Glass (uses transmission on hardware GPU, transparent fallback on software WebGL)
  const opticalGlass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(finishCfg.glassTintHex),
    metalness: 0.0,
    roughness: 0.05,
    transmission: options.isSoftwareGl ? 0 : 0.94,
    transparent: true,
    opacity: options.isSoftwareGl ? 0.34 : 1.0,
    ior: 1.72,
    thickness: 1.4,
    attenuationColor: new THREE.Color(finishCfg.glassTintHex),
    attenuationDistance: 3.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    depthWrite: false,
    wireframe: wf,
  });

  // 8. Emissive Optical / Energy Accent
  const emissiveAccent = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    emissive: new THREE.Color(accentHex),
    emissiveIntensity: 1.45,
    metalness: 0.4,
    roughness: 0.2,
    wireframe: wf,
  });

  // 9. PBR Ripple Surface extended via `onBeforeCompile` (retains full PBR lighting & reflections)
  const rippleWater = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#0e2a38'),
    metalness: 0.15,
    roughness: 0.08,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    wireframe: wf,
  });
  rippleWater.onBeforeCompile = (shader) => {
    shader.uniforms.uRippleScale = { value: 0.025 };
    shader.vertexShader =
      `uniform float uRippleScale;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float wave = sin(position.x * 8.0) * cos(position.z * 8.0) * uRippleScale;
        transformed.y += wave;`
      );
  };

  // 10. Ground Contact Shadow Plane (depthWrite: false, opacity: 0.48)
  const contactShadow = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });

  // 11. Coplanar-Safe Studio Floor Grid (polygonOffset enabled)
  const floorGrid = new THREE.MeshStandardMaterial({
    map: studioGridTex,
    metalness: 0.2,
    roughness: 0.78,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const textures: THREE.Texture[] = [
    dialTexture,
    brushedNormal,
    contactShadowTex,
    studioGridTex,
  ];

  const allMaterials: THREE.Material[] = [
    primaryMetal,
    secondaryMetal,
    accentMetal,
    satinChassis,
    matteComposite,
    dialSurface,
    opticalGlass,
    emissiveAccent,
    rippleWater,
    contactShadow,
    floorGrid,
  ];

  return {
    primaryMetal,
    secondaryMetal,
    accentMetal,
    satinChassis,
    matteComposite,
    dialSurface,
    opticalGlass,
    emissiveAccent,
    rippleWater,
    contactShadow,
    floorGrid,
    textures,
    dispose: () => {
      for (const mat of allMaterials) {
        mat.dispose();
      }
      for (const tex of textures) {
        tex.dispose();
      }
    },
  };
}
