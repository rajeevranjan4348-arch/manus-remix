import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Sparkles, Bot, Hexagon, Radio, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';

export type GrokAvatarStyle = 'geometric' | 'bot' | 'hologram';
export type GrokColorTheme = 'electric-blue' | 'cyber-cyan' | 'neon-purple' | 'obsidian-gold';

interface Grok3DAvatarProps {
  callStatus: 'listening' | 'speaking' | 'thinking' | 'paused';
  liveTranscript?: string;
  className?: string;
  initialStyle?: GrokAvatarStyle;
  initialColor?: GrokColorTheme;
}

const COLOR_CONFIGS: Record<GrokColorTheme, {
  primary: number;
  secondary: number;
  core: number;
  wireframe: number;
  glowHex: string;
  name: string;
}> = {
  'electric-blue': {
    primary: 0x2563eb,
    secondary: 0x60a5fa,
    core: 0x93c5fd,
    wireframe: 0x38bdf8,
    glowHex: 'rgba(37, 99, 235, 0.45)',
    name: 'Electric Blue'
  },
  'cyber-cyan': {
    primary: 0x06b6d4,
    secondary: 0x22d3ee,
    core: 0xa5f3fc,
    wireframe: 0x67e8f9,
    glowHex: 'rgba(6, 182, 212, 0.45)',
    name: 'Cyber Cyan'
  },
  'neon-purple': {
    primary: 0x8b5cf6,
    secondary: 0xc084fc,
    core: 0xe9d5ff,
    wireframe: 0xd8b4fe,
    glowHex: 'rgba(139, 92, 246, 0.45)',
    name: 'Neon Violet'
  },
  'obsidian-gold': {
    primary: 0x1e293b,
    secondary: 0xf59e0b,
    core: 0xfef08a,
    wireframe: 0xfbbf24,
    glowHex: 'rgba(245, 158, 11, 0.45)',
    name: 'Grok Obsidian'
  }
};

export function Grok3DAvatar({
  callStatus,
  liveTranscript = '',
  className,
  initialStyle = 'geometric',
  initialColor = 'electric-blue'
}: Grok3DAvatarProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [avatarStyle, setAvatarStyle] = useState<GrokAvatarStyle>(initialStyle);
  const [colorTheme, setColorTheme] = useState<GrokColorTheme>(initialColor);
  const [showStyleMenu, setShowStyleMenu] = useState(false);

  // References for Three.js state
  const stateRef = useRef({
    callStatus,
    avatarStyle,
    colorTheme,
    isDragging: false,
    prevMousePos: { x: 0, y: 0 },
    rotationVelocity: { x: 0, y: 0.005 },
    targetTilt: { x: 0, y: 0 },
    currentTilt: { x: 0, y: 0 },
    pulseScale: 1,
    shockwave: 0,
    time: 0,
    blinkTimer: 0,
    isBlinking: false
  });

  // Keep stateRef in sync with props
  useEffect(() => {
    stateRef.current.callStatus = callStatus;
  }, [callStatus]);

  useEffect(() => {
    stateRef.current.avatarStyle = avatarStyle;
  }, [avatarStyle]);

  useEffect(() => {
    stateRef.current.colorTheme = colorTheme;
  }, [colorTheme]);

  // Main Three.js Scene Setup & Animation Loop
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Dimensions
    let width = container.clientWidth || 320;
    let height = container.clientHeight || 320;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 4.8;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 2. Lighting Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 2.5, 50);
    pointLight.position.set(3, 4, 5);
    scene.add(pointLight);

    const backLight = new THREE.PointLight(0x38bdf8, 3.0, 50);
    backLight.position.set(-3, -3, -4);
    scene.add(backLight);

    const coreLight = new THREE.PointLight(0x60a5fa, 4.0, 10);
    coreLight.position.set(0, 0, 0);
    scene.add(coreLight);

    // 3. Avatar Master Group (Rotates and scales)
    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    // Dynamic objects container
    const geometricGroup = new THREE.Group();
    const botGroup = new THREE.Group();
    const hologramGroup = new THREE.Group();
    masterGroup.add(geometricGroup);
    masterGroup.add(botGroup);
    masterGroup.add(hologramGroup);

    // --- SETUP: 1. GEOMETRIC / GROK POLYHEDRON ---
    // Outer Faceted Polyhedron (Icosahedron with flat shading)
    const icosaGeometry = new THREE.IcosahedronGeometry(1.4, 2);
    // Keep a copy of original positions for vertex wave deformation
    const origPositions = icosaGeometry.attributes.position.clone();

    const icosaMaterial = new THREE.MeshPhysicalMaterial({
      color: COLOR_CONFIGS[colorTheme].primary,
      emissive: COLOR_CONFIGS[colorTheme].primary,
      emissiveIntensity: 0.15,
      metalness: 0.65,
      roughness: 0.15,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
      transparent: true,
      opacity: 0.88,
      flatShading: true,
    });
    const icosaMesh = new THREE.Mesh(icosaGeometry, icosaMaterial);
    geometricGroup.add(icosaMesh);

    // Wireframe edges overlay
    const wireframeGeometry = new THREE.WireframeGeometry(icosaGeometry);
    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: COLOR_CONFIGS[colorTheme].wireframe,
      transparent: true,
      opacity: 0.55,
      linewidth: 1.5
    });
    const wireframeLines = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    geometricGroup.add(wireframeLines);

    // Internal Pulsing Energy Core
    const coreSphereGeo = new THREE.SphereGeometry(0.72, 32, 32);
    const coreSphereMat = new THREE.MeshBasicMaterial({
      color: COLOR_CONFIGS[colorTheme].core,
      transparent: true,
      opacity: 0.95
    });
    const coreSphere = new THREE.Mesh(coreSphereGeo, coreSphereMat);
    geometricGroup.add(coreSphere);

    // Outer Inner Glow Shell
    const innerGlowGeo = new THREE.SphereGeometry(0.95, 32, 32);
    const innerGlowMat = new THREE.MeshLambertMaterial({
      color: COLOR_CONFIGS[colorTheme].secondary,
      transparent: true,
      opacity: 0.35,
      side: THREE.BackSide
    });
    const innerGlow = new THREE.Mesh(innerGlowGeo, innerGlowMat);
    geometricGroup.add(innerGlow);

    // Gyroscopic Orbital Rings (Grok Armillary Rings)
    const ringGeo1 = new THREE.TorusGeometry(1.85, 0.02, 16, 100);
    const ringMat1 = new THREE.MeshStandardMaterial({
      color: COLOR_CONFIGS[colorTheme].wireframe,
      emissive: COLOR_CONFIGS[colorTheme].secondary,
      emissiveIntensity: 0.6,
      metalness: 0.9,
      roughness: 0.1
    });
    const ring1 = new THREE.Mesh(ringGeo1, ringMat1);
    ring1.rotation.x = Math.PI / 3;
    geometricGroup.add(ring1);

    const ringGeo2 = new THREE.TorusGeometry(2.05, 0.015, 16, 100);
    const ringMat2 = new THREE.MeshStandardMaterial({
      color: COLOR_CONFIGS[colorTheme].core,
      emissive: COLOR_CONFIGS[colorTheme].primary,
      emissiveIntensity: 0.5,
      metalness: 0.9,
      roughness: 0.1
    });
    const ring2 = new THREE.Mesh(ringGeo2, ringMat2);
    ring2.rotation.y = Math.PI / 4;
    ring2.rotation.z = Math.PI / 6;
    geometricGroup.add(ring2);

    // Swirling Particle Starfield
    const particleCount = 180;
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleSpeeds = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      const radius = 1.7 + Math.random() * 0.9;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      particlePositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      particlePositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      particlePositions[i * 3 + 2] = radius * Math.cos(phi);
      particleSpeeds[i] = 0.5 + Math.random() * 1.5;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

    const particleMaterial = new THREE.PointsMaterial({
      color: COLOR_CONFIGS[colorTheme].secondary,
      size: 0.045,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });
    const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
    geometricGroup.add(particleSystem);


    // --- SETUP: 2. GROK 3D BOT (Cute & Futuristic Cybernetic Head) ---
    // Bot Head Chassis
    const botHeadGeo = new THREE.SphereGeometry(1.3, 32, 32);
    botHeadGeo.scale(1.0, 0.92, 0.95);
    const botHeadMat = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      emissive: 0x020617,
      metalness: 0.85,
      roughness: 0.2,
      clearcoat: 0.9
    });
    const botHead = new THREE.Mesh(botHeadGeo, botHeadMat);
    botGroup.add(botHead);

    // Floating Ear Nodes / Cyber Headphone Nodes
    const earGeo = new THREE.CylinderGeometry(0.3, 0.35, 0.25, 32);
    const earMat = new THREE.MeshStandardMaterial({
      color: COLOR_CONFIGS[colorTheme].primary,
      metalness: 0.9,
      roughness: 0.2
    });
    const leftEar = new THREE.Mesh(earGeo, earMat);
    leftEar.rotation.z = Math.PI / 2;
    leftEar.position.set(-1.38, 0.05, 0);
    botGroup.add(leftEar);

    const rightEar = leftEar.clone();
    rightEar.position.set(1.38, 0.05, 0);
    botGroup.add(rightEar);

    // Glowing Visor Face (Curved screen)
    const visorGeo = new THREE.SphereGeometry(1.22, 32, 24, 0, Math.PI, 0, Math.PI * 0.55);
    // Dynamic canvas texture for expressive cyber eyes & mouth
    const visorCanvas = document.createElement('canvas');
    visorCanvas.width = 512;
    visorCanvas.height = 256;
    const visorCtx = visorCanvas.getContext('2d');
    const visorTexture = new THREE.CanvasTexture(visorCanvas);
    visorTexture.generateMipmaps = false;
    visorTexture.minFilter = THREE.LinearFilter;

    const visorMat = new THREE.MeshBasicMaterial({
      map: visorTexture,
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide
    });
    const visorMesh = new THREE.Mesh(visorGeo, visorMat);
    visorMesh.position.set(0, 0.08, 0.12);
    visorMesh.rotation.x = -0.15;
    botGroup.add(visorMesh);

    // Halo Antenna Ring
    const haloGeo = new THREE.TorusGeometry(0.7, 0.02, 16, 64);
    const haloMat = new THREE.MeshBasicMaterial({
      color: COLOR_CONFIGS[colorTheme].wireframe,
      transparent: true,
      opacity: 0.8
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(0, 1.5, -0.2);
    halo.rotation.x = Math.PI / 3;
    botGroup.add(halo);


    // --- SETUP: 3. HOLOGRAPHIC MATRIX (Neural Lattice) ---
    const holoSphereGeo = new THREE.IcosahedronGeometry(1.4, 4);
    const holoWireGeo = new THREE.WireframeGeometry(holoSphereGeo);
    const holoWireMat = new THREE.LineBasicMaterial({
      color: COLOR_CONFIGS[colorTheme].core,
      transparent: true,
      opacity: 0.85
    });
    const holoWire = new THREE.LineSegments(holoWireGeo, holoWireMat);
    hologramGroup.add(holoWire);

    const holoCoreGeo = new THREE.OctahedronGeometry(0.85, 2);
    const holoCoreMat = new THREE.MeshStandardMaterial({
      color: COLOR_CONFIGS[colorTheme].primary,
      wireframe: true,
      emissive: COLOR_CONFIGS[colorTheme].secondary,
      emissiveIntensity: 0.8
    });
    const holoCore = new THREE.Mesh(holoCoreGeo, holoCoreMat);
    hologramGroup.add(holoCore);


    // --- Helper to update colors dynamically ---
    const updateActiveColors = (themeKey: GrokColorTheme) => {
      const cfg = COLOR_CONFIGS[themeKey];
      
      // Geometric materials
      icosaMaterial.color.setHex(cfg.primary);
      icosaMaterial.emissive.setHex(cfg.primary);
      wireframeMaterial.color.setHex(cfg.wireframe);
      coreSphereMat.color.setHex(cfg.core);
      innerGlowMat.color.setHex(cfg.secondary);
      ringMat1.color.setHex(cfg.wireframe);
      ringMat1.emissive.setHex(cfg.secondary);
      ringMat2.color.setHex(cfg.core);
      ringMat2.emissive.setHex(cfg.primary);
      particleMaterial.color.setHex(cfg.secondary);
      
      // Lights
      pointLight.color.setHex(cfg.secondary);
      coreLight.color.setHex(cfg.core);
      backLight.color.setHex(cfg.primary);

      // Bot materials
      earMat.color.setHex(cfg.primary);
      haloMat.color.setHex(cfg.wireframe);

      // Hologram
      holoWireMat.color.setHex(cfg.core);
      holoCoreMat.color.setHex(cfg.primary);
      holoCoreMat.emissive.setHex(cfg.secondary);
    };

    updateActiveColors(colorTheme);

    // --- Interactive Mouse / Touch Dragging ---
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      stateRef.current.isDragging = true;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      stateRef.current.prevMousePos = { x: clientX, y: clientY };
    };

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      if (stateRef.current.isDragging) {
        const deltaX = clientX - stateRef.current.prevMousePos.x;
        const deltaY = clientY - stateRef.current.prevMousePos.y;

        stateRef.current.rotationVelocity = {
          x: deltaY * 0.005,
          y: deltaX * 0.005
        };

        masterGroup.rotation.y += deltaX * 0.008;
        masterGroup.rotation.x += deltaY * 0.008;

        stateRef.current.prevMousePos = { x: clientX, y: clientY };
      } else {
        // Subtle tilt parallax on hover
        const rect = container.getBoundingClientRect();
        const normX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const normY = -(((clientY - rect.top) / rect.height) * 2 - 1);
        stateRef.current.targetTilt = { x: normY * 0.35, y: normX * 0.45 };
      }
    };

    const handlePointerUp = () => {
      stateRef.current.isDragging = false;
    };

    // Click triggers shockwave ripple
    const handleClick = () => {
      stateRef.current.shockwave = 1.0;
    };

    container.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);

    container.addEventListener('touchstart', handlePointerDown, { passive: true });
    window.addEventListener('touchmove', handlePointerMove, { passive: true });
    window.addEventListener('touchend', handlePointerUp);
    container.addEventListener('click', handleClick);

    // --- Draw Visor Face for Bot Avatar ---
    const drawVisorFace = (time: number, isSpeaking: boolean, isThinking: boolean, isBlinking: boolean) => {
      if (!visorCtx) return;
      visorCtx.clearRect(0, 0, visorCanvas.width, visorCanvas.height);

      const theme = COLOR_CONFIGS[stateRef.current.colorTheme];
      const cyanHex = '#' + theme.wireframe.toString(16).padStart(6, '0');
      const coreHex = '#' + theme.core.toString(16).padStart(6, '0');

      visorCtx.fillStyle = '#050814';
      visorCtx.fillRect(0, 0, visorCanvas.width, visorCanvas.height);

      // Eye parameters
      const eyeY = 110;
      const leftEyeX = 175;
      const rightEyeX = 335;
      const eyeRadius = isBlinking ? 2 : 28;

      visorCtx.shadowColor = cyanHex;
      visorCtx.shadowBlur = 18;
      visorCtx.fillStyle = coreHex;

      if (isThinking) {
        // Thinking eyes: rotating radar rings / loading arcs
        const angle = time * 5;
        [leftEyeX, rightEyeX].forEach(x => {
          visorCtx.beginPath();
          visorCtx.arc(x, eyeY, 24, angle, angle + Math.PI * 1.4);
          visorCtx.lineWidth = 6;
          visorCtx.strokeStyle = coreHex;
          visorCtx.stroke();
        });
      } else {
        // Normal / Happy Grok Eyes
        if (isBlinking) {
          visorCtx.fillRect(leftEyeX - 25, eyeY - 2, 50, 4);
          visorCtx.fillRect(rightEyeX - 25, eyeY - 2, 50, 4);
        } else {
          // Rounded rectangular expressive eye screens
          const drawEye = (x: number) => {
            visorCtx.beginPath();
            visorCtx.roundRect(x - 28, eyeY - 24, 56, 48, 14);
            visorCtx.fill();

            // Pupil gleam
            visorCtx.fillStyle = '#ffffff';
            visorCtx.beginPath();
            visorCtx.arc(x + 10, eyeY - 8, 6, 0, Math.PI * 2);
            visorCtx.fill();
            visorCtx.fillStyle = coreHex;
          };
          drawEye(leftEyeX);
          drawEye(rightEyeX);
        }
      }

      // Mouth / Waveform
      const mouthY = 195;
      if (isSpeaking) {
        // Dynamic sine waveform mouth
        visorCtx.strokeStyle = cyanHex;
        visorCtx.lineWidth = 5;
        visorCtx.beginPath();
        for (let i = 0; i < 160; i += 4) {
          const x = 176 + i;
          const amp = Math.sin((i / 20) + time * 12) * Math.sin(i / 160 * Math.PI) * 22;
          if (i === 0) visorCtx.moveTo(x, mouthY + amp);
          else visorCtx.lineTo(x, mouthY + amp);
        }
        visorCtx.stroke();
      } else {
        // Subtle friendly curved mouth smile
        visorCtx.strokeStyle = cyanHex;
        visorCtx.lineWidth = 4;
        visorCtx.beginPath();
        visorCtx.arc(256, mouthY - 10, 24, 0.2 * Math.PI, 0.8 * Math.PI);
        visorCtx.stroke();
      }

      visorTexture.needsUpdate = true;
    };

    // --- Animation Loop ---
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const delta = clock.getDelta();
      const time = clock.getElapsedTime();
      stateRef.current.time = time;

      const { callStatus, avatarStyle, colorTheme, shockwave } = stateRef.current;
      updateActiveColors(colorTheme);

      // Toggle group visibilities based on chosen style
      geometricGroup.visible = avatarStyle === 'geometric';
      botGroup.visible = avatarStyle === 'bot';
      hologramGroup.visible = avatarStyle === 'hologram';

      // Parallax damping
      stateRef.current.currentTilt.x += (stateRef.current.targetTilt.x - stateRef.current.currentTilt.x) * 0.05;
      stateRef.current.currentTilt.y += (stateRef.current.targetTilt.y - stateRef.current.currentTilt.y) * 0.05;

      // Handle shockwave decay
      if (stateRef.current.shockwave > 0) {
        stateRef.current.shockwave = Math.max(0, stateRef.current.shockwave - delta * 2.2);
      }

      // Physics / Audio reactivity scaling
      let baseScale = 1.0;
      let rotationSpeedY = 0.35;
      let rotationSpeedX = 0.15;
      let audioWarp = 0;

      if (callStatus === 'speaking') {
        const audioFreq = Math.sin(time * 16) * 0.08 + Math.sin(time * 24) * 0.05;
        baseScale = 1.08 + audioFreq + (shockwave * 0.25);
        rotationSpeedY = 0.85;
        rotationSpeedX = 0.3;
        audioWarp = 0.15 + Math.abs(audioFreq);
        coreLight.intensity = 5.5 + Math.sin(time * 20) * 2.0;
      } else if (callStatus === 'thinking') {
        baseScale = 0.96 + Math.sin(time * 8) * 0.04 + (shockwave * 0.2);
        rotationSpeedY = 2.4; // Rapid quantum rotation
        rotationSpeedX = 0.8;
        audioWarp = 0.08;
        coreLight.intensity = 4.0 + Math.sin(time * 12) * 1.5;
      } else if (callStatus === 'listening') {
        // Breathing pulse
        const breath = Math.sin(time * 2.2) * 0.04;
        baseScale = 1.0 + breath + (shockwave * 0.2);
        rotationSpeedY = 0.3;
        rotationSpeedX = 0.1;
        coreLight.intensity = 3.5 + breath * 4;
      } else {
        // Paused
        baseScale = 0.92;
        rotationSpeedY = 0.08;
        rotationSpeedX = 0.02;
        coreLight.intensity = 1.5;
      }

      // Smooth master scale
      const targetScale = baseScale;
      masterGroup.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);

      // Inertia rotation when not dragging
      if (!stateRef.current.isDragging) {
        masterGroup.rotation.y += rotationSpeedY * delta;
        masterGroup.rotation.x += rotationSpeedX * delta;

        // Apply tilt
        masterGroup.position.x = stateRef.current.currentTilt.y * 0.25;
        masterGroup.position.y = stateRef.current.currentTilt.x * 0.25;
      }

      // 1. ANIME: GEOMETRIC / GROK POLYHEDRON
      if (avatarStyle === 'geometric') {
        // Gyro rings counter-rotation
        ring1.rotation.z += 0.8 * delta;
        ring1.rotation.x += 0.5 * delta;
        ring2.rotation.y -= 0.9 * delta;
        ring2.rotation.z -= 0.4 * delta;

        // Core pulsating glow
        const coreScale = 0.72 + (callStatus === 'speaking' ? Math.sin(time * 14) * 0.12 : Math.sin(time * 3) * 0.04);
        coreSphere.scale.set(coreScale, coreScale, coreScale);

        // Vertex displacement (rippling polygon wave)
        const posAttr = icosaGeometry.attributes.position;
        const origAttr = origPositions;

        for (let i = 0; i < posAttr.count; i++) {
          const ox = origAttr.getX(i);
          const oy = origAttr.getY(i);
          const oz = origAttr.getZ(i);

          const distance = Math.sqrt(ox * ox + oy * oy + oz * oz);
          const wave = Math.sin(distance * 3 + time * 6) * audioWarp + (shockwave * Math.sin(distance * 10 - time * 12) * 0.15);

          const factor = 1 + wave;
          posAttr.setXYZ(i, ox * factor, oy * factor, oz * factor);
        }
        posAttr.needsUpdate = true;
        icosaGeometry.computeVertexNormals();

        // Particles swirling
        const pPos = particleGeometry.attributes.position.array as Float32Array;
        for (let i = 0; i < particleCount; i++) {
          const speed = particleSpeeds[i] * (callStatus === 'speaking' ? 2.5 : callStatus === 'thinking' ? 4.0 : 1.0);
          const x = pPos[i * 3];
          const z = pPos[i * 3 + 2];
          const angle = speed * delta * 0.8;

          pPos[i * 3] = x * Math.cos(angle) - z * Math.sin(angle);
          pPos[i * 3 + 2] = x * Math.sin(angle) + z * Math.cos(angle);
        }
        particleGeometry.attributes.position.needsUpdate = true;
      }

      // 2. ANIME: BOT VISOR
      if (avatarStyle === 'bot') {
        halo.rotation.z += 1.2 * delta;
        halo.position.y = 1.4 + Math.sin(time * 3) * 0.06;

        // Blinking logic
        stateRef.current.blinkTimer += delta;
        if (stateRef.current.blinkTimer > 3.2) {
          stateRef.current.isBlinking = true;
          if (stateRef.current.blinkTimer > 3.36) {
            stateRef.current.isBlinking = false;
            stateRef.current.blinkTimer = 0;
          }
        }

        drawVisorFace(
          time,
          callStatus === 'speaking',
          callStatus === 'thinking',
          stateRef.current.isBlinking
        );
      }

      // 3. ANIME: HOLOGRAM
      if (avatarStyle === 'hologram') {
        holoCore.rotation.x += 1.5 * delta;
        holoCore.rotation.y += 1.2 * delta;
        holoWire.rotation.y -= 0.5 * delta;
      }

      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 320;
      const h = container.clientHeight || 320;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      container.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      container.removeEventListener('click', handleClick);

      renderer.dispose();
      icosaGeometry.dispose();
      wireframeGeometry.dispose();
      icosaMaterial.dispose();
      wireframeMaterial.dispose();
      coreSphereGeo.dispose();
      coreSphereMat.dispose();
      ringGeo1.dispose();
      ringGeo2.dispose();
      ringMat1.dispose();
      ringMat2.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      botHeadGeo.dispose();
      botHeadMat.dispose();
      visorTexture.dispose();
      holoSphereGeo.dispose();
      holoWireGeo.dispose();
      holoWireMat.dispose();
      holoCoreGeo.dispose();
      holoCoreMat.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className={cn("relative flex flex-col items-center justify-center select-none", className)}>
      {/* 3D Canvas Mount Point */}
      <div 
        ref={mountRef} 
        className="w-72 h-72 sm:w-80 sm:h-80 md:w-96 md:h-96 cursor-grab active:cursor-grabbing relative z-10 flex items-center justify-center"
        title="Click or drag to rotate 3D avatar"
      />

      {/* Cybernetic Radial Backlight / Aura */}
      <div 
        className={cn(
          "absolute inset-0 rounded-full filter blur-[85px] pointer-events-none transition-all duration-700 -z-10",
          callStatus === 'speaking' 
            ? "scale-125 opacity-70 animate-pulse" 
            : callStatus === 'thinking'
              ? "scale-110 opacity-50 animate-spin"
              : callStatus === 'paused'
                ? "scale-75 opacity-20"
                : "scale-100 opacity-45"
        )}
        style={{
          background: `radial-gradient(circle, ${COLOR_CONFIGS[colorTheme].glowHex} 0%, rgba(15, 23, 42, 0) 70%)`
        }}
      />

      {/* Interactive Controls Overlay for 3D Avatar (Style Switcher & Themes) */}
      <div className="absolute -bottom-4 z-20 flex items-center gap-1.5 p-1 rounded-full bg-slate-900/80 backdrop-blur-md border border-white/10 shadow-xl">
        {/* Style Buttons */}
        <button
          onClick={() => setAvatarStyle('geometric')}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer",
            avatarStyle === 'geometric' 
              ? "bg-blue-600 text-white shadow-xs" 
              : "text-white/60 hover:text-white hover:bg-white/10"
          )}
          title="Grok Quantum Polyhedron"
        >
          <Hexagon size={13} />
          <span>Grok Core</span>
        </button>

        <button
          onClick={() => setAvatarStyle('bot')}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer",
            avatarStyle === 'bot' 
              ? "bg-blue-600 text-white shadow-xs" 
              : "text-white/60 hover:text-white hover:bg-white/10"
          )}
          title="Grok 3D Cyber Bot"
        >
          <Bot size={13} />
          <span>Cyber Bot</span>
        </button>

        <button
          onClick={() => setAvatarStyle('hologram')}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer",
            avatarStyle === 'hologram' 
              ? "bg-blue-600 text-white shadow-xs" 
              : "text-white/60 hover:text-white hover:bg-white/10"
          )}
          title="Holographic Neural Matrix"
        >
          <Radio size={13} />
          <span>Holo Matrix</span>
        </button>

        {/* Color Palette Toggle */}
        <div className="relative">
          <button
            onClick={() => setShowStyleMenu(!showStyleMenu)}
            className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors cursor-pointer"
            title="Theme Palette"
          >
            <Palette size={14} />
          </button>

          {showStyleMenu && (
            <div className="absolute bottom-full mb-2 right-0 bg-slate-950/95 border border-white/15 rounded-2xl p-2 shadow-2xl backdrop-blur-xl flex flex-col gap-1.5 w-36 z-50">
              <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider px-2 pt-1">
                Aura Color
              </span>
              {(Object.keys(COLOR_CONFIGS) as GrokColorTheme[]).map((thm) => (
                <button
                  key={thm}
                  onClick={() => {
                    setColorTheme(thm);
                    setShowStyleMenu(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-xl text-xs text-left transition-all cursor-pointer",
                    colorTheme === thm ? "bg-white/15 text-white font-medium" : "text-white/70 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <span 
                    className="w-2.5 h-2.5 rounded-full shrink-0" 
                    style={{ backgroundColor: '#' + COLOR_CONFIGS[thm].primary.toString(16).padStart(6, '0') }} 
                  />
                  <span className="truncate">{COLOR_CONFIGS[thm].name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
