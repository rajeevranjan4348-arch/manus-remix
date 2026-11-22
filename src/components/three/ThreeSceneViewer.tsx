/**
 * Interactive Three.js Studio PBR & Procedural 3D Scene Viewer
 *
 * Strictly adheres to Three.js Architecture, Performance, Visual Realism & UX Directives:
 * 1. Software-WebGL Guard (`isSoftwareGl` detected from WEBGL_debug_renderer_info)
 * 2. ACESFilmicToneMapping + SRGBColorSpace + RoomEnvironment PMREMGenerator studio reflections
 * 3. 3-Point Warm/Cool Studio Rig + RectAreaLightUniformsLib softboxes + radial contact shadow grounding
 * 4. Coalesced `requestRender()` and `afterDraw(cb)` fenceSync pacing for software WebGL
 * 5. Silky-smooth `THREE.MathUtils.damp(..., delta)` for exploded-view separation and camera presets
 * 6. Pre-allocated module-scope math vectors (`_targetCamPos`, `_targetLookAt`) for zero GC in tick
 * 7. Isolated WebGL `<div ref={canvasMountRef} />` container + Unified Collapsible Bottom Control Dock
 *    (no `backdrop-filter` over WebGL, no pulsating `@keyframes pulse` dots, zero side-panel clutter)
 */

import React, { useState, useEffect, useRef, memo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import {
  Box,
  Camera,
  ChevronDown,
  ChevronUp,
  Download,
  Layers,
  Maximize2,
  Minimize2,
  RotateCcw,
  Sliders,
  Sun,
} from 'lucide-react';
import {
  CAMERA_VIEW_PRESETS,
  CameraViewPresetId,
  PROCEDURAL_3D_ENVIRONMENTS,
  PROCEDURAL_3D_FINISHES,
  PROCEDURAL_3D_PRESET_CATALOG,
  Procedural3DPresetId,
  Procedural3DSceneSpec,
  StudioEnvironmentPresetId,
  StudioFinishId,
} from '@/lib/threeSceneSpec';
import { createStudioMaterialSuite, StudioMaterialSuite } from '@/lib/threeProceduralMaterials';
import { buildProcedural3DAssembly, BuiltProceduralAssembly } from '@/lib/threeProceduralModels';

// Module-scope pre-allocated math objects for zero-GC camera damping and raycasting
const _desiredCamPos = new THREE.Vector3();
const _desiredLookAt = new THREE.Vector3();
const _pointerNdc = new THREE.Vector2();

/**
 * Detects software WebGL (SwiftShader, llvmpipe, softpipe, Basic Render) from the GPU renderer string.
 */
export function detectSoftwareWebGL(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export interface ThreeSceneViewerProps {
  initialSpec: Procedural3DSceneSpec;
}

export const ThreeSceneViewer = memo(function ThreeSceneViewer({
  initialSpec,
}: ThreeSceneViewerProps) {
  const [preset, setPreset] = useState<Procedural3DPresetId>(initialSpec.preset);
  const [finish, setFinish] = useState<StudioFinishId>(initialSpec.finish);
  const [environment, setEnvironment] = useState<StudioEnvironmentPresetId>(
    initialSpec.environment
  );
  const [cameraPreset, setCameraPreset] = useState<CameraViewPresetId>(
    initialSpec.cameraPreset || 'isometric'
  );
  const [explodedTarget, setExplodedTarget] = useState<number>(
    initialSpec.explodedFactor || 0
  );
  const [turntableSpeed, setTurntableSpeed] = useState<number>(
    typeof initialSpec.turntableSpeed === 'number' ? initialSpec.turntableSpeed : 0.35
  );
  const [wireframe, setWireframe] = useState<boolean>(Boolean(initialSpec.wireframe));
  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(false);
  const [isExpandedViewport, setIsExpandedViewport] = useState<boolean>(false);
  const [inspectedPart, setInspectedPart] = useState<{
    name: string;
    category: string;
    materialSummary: string;
  } | null>(null);

  // Isolated empty ref container for the WebGL <canvas>
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  // Mutable state refs consumed inside the WebGL loop without tearing down the canvas
  const stateRef = useRef({
    preset: initialSpec.preset,
    finish: initialSpec.finish,
    environment: initialSpec.environment,
    cameraPreset: initialSpec.cameraPreset || ('isometric' as CameraViewPresetId),
    explodedTarget: initialSpec.explodedFactor || 0,
    explodedCurrent: initialSpec.explodedFactor || 0,
    turntableSpeed:
      typeof initialSpec.turntableSpeed === 'number' ? initialSpec.turntableSpeed : 0.35,
    wireframe: Boolean(initialSpec.wireframe),
    cameraTransitionActive: false,
  });

  const sceneTriggerRef = useRef<{
    rebuildModel?: () => void;
    updateLighting?: () => void;
    triggerCameraPreset?: (presetId: CameraViewPresetId) => void;
    exportSnapshot?: () => void;
    requestRender?: () => void;
  }>({});

  // Sync React controls to mutable refs and trigger on-demand updates
  useEffect(() => {
    const prev = stateRef.current;
    const needsRebuild =
      prev.preset !== preset || prev.finish !== finish || prev.wireframe !== wireframe;
    const needsLighting = prev.environment !== environment;

    prev.preset = preset;
    prev.finish = finish;
    prev.environment = environment;
    prev.explodedTarget = explodedTarget;
    prev.turntableSpeed = turntableSpeed;
    prev.wireframe = wireframe;

    if (needsRebuild) {
      sceneTriggerRef.current.rebuildModel?.();
    }
    if (needsLighting) {
      sceneTriggerRef.current.updateLighting?.();
    }
    sceneTriggerRef.current.requestRender?.();
  }, [preset, finish, environment, explodedTarget, turntableSpeed, wireframe]);

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
    } catch {
      // Headless / non-WebGL test environment guard
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initialWidth = Math.max(320, mountEl.clientWidth || 640);
    const initialHeight = Math.max(260, mountEl.clientHeight || 440);
    renderer.setSize(initialWidth, initialHeight);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    mountEl.innerHTML = '';
    mountEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    // Mandatory Studio Environment Reflection (`RoomEnvironment` + `PMREMGenerator`)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      42,
      initialWidth / initialHeight,
      0.1,
      100
    );
    const startCam = CAMERA_VIEW_PRESETS[stateRef.current.cameraPreset] || CAMERA_VIEW_PRESETS.isometric;
    camera.position.set(startCam.position[0], startCam.position[1], startCam.position[2]);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(startCam.target[0], startCam.target[1], startCam.target[2]);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 1.6;
    controls.maxDistance = 14;
    controls.update();

    // Cancel scripted camera transition when user manually interacts with OrbitControls
    const onControlsStart = () => {
      stateRef.current.cameraTransitionActive = false;
    };
    controls.addEventListener('start', onControlsStart);

    // 3-Point Warm/Cool Studio Lighting Rig (<= 3 shadow casters)
    const hemiFill = new THREE.HemisphereLight(0x8ab4f8, 0x2a211b, 1.1);
    hemiFill.position.set(0, 12, 0);
    scene.add(hemiFill);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 3.2);
    keyLight.position.set(4.5, 7.2, 4.8);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 20;
    const d = 3.8;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xffbe76, 2.2);
    rimLight.position.set(-4.5, 3.8, -4.2);
    scene.add(rimLight);

    // Studio Area Softboxes (`RectAreaLight`, skipped when `isSoftwareGl`)
    const softboxes: THREE.RectAreaLight[] = [];
    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const softboxLeft = new THREE.RectAreaLight(0xffffff, 2.6, 3.5, 2.2);
      softboxLeft.position.set(-3.8, 3.2, 2.6);
      softboxLeft.lookAt(0, 0.8, 0);
      scene.add(softboxLeft);

      const softboxRight = new THREE.RectAreaLight(0xffe4b5, 2.1, 3.5, 2.2);
      softboxRight.position.set(3.8, 3.4, -2.2);
      softboxRight.lookAt(0, 0.8, 0);
      scene.add(softboxRight);

      softboxes.push(softboxLeft, softboxRight);
    }

    // Contact Shadow Grounding & Coplanar-Safe Floor Grid (offset by >= 0.02 on Y)
    const groundGroup = new THREE.Group();
    scene.add(groundGroup);

    let activeMaterials: StudioMaterialSuite | null = null;
    let activeAssembly: BuiltProceduralAssembly | null = null;
    let contactShadowMesh: THREE.Mesh | null = null;
    let floorGridMesh: THREE.Mesh | null = null;

    const contactGeom = new THREE.PlaneGeometry(4.6, 4.6);
    contactGeom.rotateX(-Math.PI / 2);

    const gridGeom = new THREE.CircleGeometry(9.5, 64);
    gridGeom.rotateX(-Math.PI / 2);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;

    const applyEnvironmentPreset = () => {
      const envCfg =
        PROCEDURAL_3D_ENVIRONMENTS[stateRef.current.environment] ||
        PROCEDURAL_3D_ENVIRONMENTS.studio_warm;

      scene.background = new THREE.Color(envCfg.backgroundHex);
      scene.fog = new THREE.FogExp2(envCfg.fogHex, 0.045);

      keyLight.color.set(envCfg.keyLightHex);
      keyLight.intensity = envCfg.keyLightIntensity;

      hemiFill.color.set(envCfg.fillSkyHex);
      hemiFill.groundColor.set(envCfg.fillGroundHex);
      hemiFill.intensity = envCfg.fillIntensity;

      rimLight.color.set(envCfg.rimLightHex);
      rimLight.intensity = envCfg.rimLightIntensity;

      if (renderer) {
        renderer.toneMappingExposure = envCfg.exposure;
      }
    };

    const rebuildProceduralModel = () => {
      if (activeAssembly) {
        scene.remove(activeAssembly.root);
        activeAssembly.dispose();
        activeAssembly = null;
      }
      if (activeMaterials) {
        activeMaterials.dispose();
        activeMaterials = null;
      }
      if (contactShadowMesh) {
        groundGroup.remove(contactShadowMesh);
        contactShadowMesh = null;
      }
      if (floorGridMesh) {
        groundGroup.remove(floorGridMesh);
        floorGridMesh = null;
      }

      activeMaterials = createStudioMaterialSuite({
        finish: stateRef.current.finish,
        customAccentHex: initialSpec.customAccentHex,
        isSoftwareGl,
        maxAnisotropy,
        wireframe: stateRef.current.wireframe,
      });

      // Floor grid at y = 0.0, Contact shadow offset at y = 0.022 (preventing coplanar Z-fighting)
      floorGridMesh = new THREE.Mesh(gridGeom, activeMaterials.floorGrid);
      floorGridMesh.position.y = 0.0;
      floorGridMesh.receiveShadow = !isSoftwareGl;
      groundGroup.add(floorGridMesh);

      contactShadowMesh = new THREE.Mesh(contactGeom, activeMaterials.contactShadow);
      contactShadowMesh.position.y = 0.022;
      contactShadowMesh.renderOrder = 1;
      groundGroup.add(contactShadowMesh);

      activeAssembly = buildProcedural3DAssembly(
        stateRef.current.preset,
        activeMaterials
      );
      activeAssembly.applyExplodedFactor(stateRef.current.explodedCurrent);
      scene.add(activeAssembly.root);

      if (!isSoftwareGl && renderer) {
        renderer.compile(scene, camera);
      }
    };

    applyEnvironmentPreset();
    rebuildProceduralModel();

    // High-Performance Layer-1 Raycasting for part inspection on click
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    let pointerDownPos = { x: 0, y: 0 };

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!renderer || !activeAssembly) return;
      const dist = Math.hypot(
        e.clientX - pointerDownPos.x,
        e.clientY - pointerDownPos.y
      );
      if (dist > 6) return; // Ignore orbit drags

      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      _pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(_pointerNdc, camera);
      const hits = raycaster.intersectObjects(activeAssembly.root.children, true);
      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && !obj.userData?.partName) {
          obj = obj.parent;
        }
        if (obj?.userData?.partName) {
          setInspectedPart({
            name: String(obj.userData.partName),
            category: String(obj.userData.partCategory || 'component'),
            materialSummary: String(obj.userData.materialSummary || 'Studio PBR'),
          });
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    // Software-WebGL fenceSync Pacing & Coalesced On-Demand / Animated Render Loop
    let frameId = 0;
    let isDisposed = false;
    let renderBusy = false;
    let renderDirty = false;
    const clock = new THREE.Clock();
    let elapsedTotal = 0;

    function afterDraw(cb: () => void) {
      if (isDisposed || !renderer) return;
      const gl = renderer.getContext() as WebGL2RenderingContext | null;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (isDisposed) return;
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    function stepScene(deltaSec: number) {
      const clampedDelta = Math.min(0.1, Math.max(0.001, deltaSec));
      elapsedTotal += clampedDelta;

      // 1. Exponential damping for Exploded-View Layer Separation
      const currentExplode = stateRef.current.explodedCurrent;
      const targetExplode = stateRef.current.explodedTarget;
      let hasActiveMotion = false;

      if (Math.abs(targetExplode - currentExplode) > 0.001) {
        stateRef.current.explodedCurrent = THREE.MathUtils.damp(
          currentExplode,
          targetExplode,
          8.5,
          clampedDelta
        );
        activeAssembly?.applyExplodedFactor(stateRef.current.explodedCurrent);
        hasActiveMotion = true;
      } else if (currentExplode !== targetExplode) {
        stateRef.current.explodedCurrent = targetExplode;
        activeAssembly?.applyExplodedFactor(targetExplode);
      }

      // 2. Exponential damping for Camera Preset Transitions
      if (stateRef.current.cameraTransitionActive) {
        const camPreset =
          CAMERA_VIEW_PRESETS[stateRef.current.cameraPreset] ||
          CAMERA_VIEW_PRESETS.isometric;
        _desiredCamPos.set(
          camPreset.position[0],
          camPreset.position[1],
          camPreset.position[2]
        );
        _desiredLookAt.set(
          camPreset.target[0],
          camPreset.target[1],
          camPreset.target[2]
        );

        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          _desiredCamPos.x,
          7.5,
          clampedDelta
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          _desiredCamPos.y,
          7.5,
          clampedDelta
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          _desiredCamPos.z,
          7.5,
          clampedDelta
        );

        controls.target.x = THREE.MathUtils.damp(
          controls.target.x,
          _desiredLookAt.x,
          7.5,
          clampedDelta
        );
        controls.target.y = THREE.MathUtils.damp(
          controls.target.y,
          _desiredLookAt.y,
          7.5,
          clampedDelta
        );
        controls.target.z = THREE.MathUtils.damp(
          controls.target.z,
          _desiredLookAt.z,
          7.5,
          clampedDelta
        );

        if (
          camera.position.distanceToSquared(_desiredCamPos) < 0.0008 &&
          controls.target.distanceToSquared(_desiredLookAt) < 0.0008
        ) {
          camera.position.copy(_desiredCamPos);
          controls.target.copy(_desiredLookAt);
          stateRef.current.cameraTransitionActive = false;
        } else {
          hasActiveMotion = true;
        }
      }

      // 3. Turntable rotation & articulated sub-part kinematics
      if (activeAssembly) {
        if (!isSoftwareGl && stateRef.current.turntableSpeed > 0.01) {
          activeAssembly.root.rotation.y +=
            clampedDelta * stateRef.current.turntableSpeed * 0.65;
          activeAssembly.animate(elapsedTotal, clampedDelta);
          hasActiveMotion = true;
        } else if (stateRef.current.turntableSpeed > 0.01) {
          activeAssembly.animate(elapsedTotal, clampedDelta);
        }
      }

      controls.update();
      return hasActiveMotion;
    }

    function requestRender() {
      if (isDisposed || !renderer) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (isDisposed || !renderer) return;
        renderDirty = false;
        const delta = clock.getDelta();
        const stillMoving = stepScene(delta);
        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (isDisposed) return;
          if (
            renderDirty ||
            stillMoving ||
            (!isSoftwareGl && stateRef.current.turntableSpeed > 0.01)
          ) {
            requestRender();
          }
        };

        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    }

    controls.addEventListener('change', () => {
      requestRender();
    });

    const handleResize = () => {
      if (!mountEl || !renderer) return;
      const w = Math.max(280, mountEl.clientWidth);
      const h = Math.max(240, mountEl.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => handleResize())
        : null;
    resizeObserver?.observe(mountEl);
    window.addEventListener('resize', handleResize);

    // Expose imperative hooks to React controls
    sceneTriggerRef.current = {
      rebuildModel: () => {
        rebuildProceduralModel();
        requestRender();
      },
      updateLighting: () => {
        applyEnvironmentPreset();
        requestRender();
      },
      triggerCameraPreset: (presetId: CameraViewPresetId) => {
        stateRef.current.cameraPreset = presetId;
        stateRef.current.cameraTransitionActive = true;
        requestRender();
      },
      exportSnapshot: () => {
        if (!renderer) return;
        // Render immediately before reading canvas data URL
        renderer.render(scene, camera);
        try {
          const dataUrl = renderer.domElement.toDataURL('image/png');
          const link = document.createElement('a');
          link.download = `${stateRef.current.preset}-studio-pbr.png`;
          link.href = dataUrl;
          link.click();
        } catch {
          // Ignore snapshot errors in restricted contexts
        }
      },
      requestRender,
    };

    // Initial render
    requestRender();

    return () => {
      isDisposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      controls.removeEventListener('start', onControlsStart);
      controls.dispose();

      if (renderer) {
        renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
        renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      }

      if (activeAssembly) {
        scene.remove(activeAssembly.root);
        activeAssembly.dispose();
      }
      if (activeMaterials) {
        activeMaterials.dispose();
      }
      contactGeom.dispose();
      gridGeom.dispose();
      envTarget.dispose();

      for (const sb of softboxes) {
        sb.dispose();
      }

      renderer?.dispose();
    };
  }, [initialSpec.customAccentHex]);

  const activeCatalog =
    PROCEDURAL_3D_PRESET_CATALOG[preset] ||
    PROCEDURAL_3D_PRESET_CATALOG.chronograph_watch;
  const activeFinishInfo =
    PROCEDURAL_3D_FINISHES[finish] || PROCEDURAL_3D_FINISHES.brushed_gold;

  return (
    <div
      data-testid="threejs-studio-pbr-viewer"
      data-preset={preset}
      data-finish={finish}
      data-environment={environment}
      className={`relative w-full rounded-2xl border border-[#262626] bg-[#080a0f] text-[#f5f5f7] overflow-hidden shadow-2xl select-none my-4 ${
        isExpandedViewport ? 'h-[78dvh] min-h-[520px]' : 'h-[480px] sm:h-[540px]'
      }`}
    >
      {/* Isolated WebGL Canvas Container (100% Unobstructed Center Viewport) */}
      <div
        ref={canvasMountRef}
        data-testid="threejs-webgl-canvas-mount"
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Minimal Top-Left Specification Badge (Static Indicators Only — Zero Pulsating Dots, No backdrop-filter) */}
      <div className="pointer-events-none absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
        <div className="pointer-events-auto inline-flex flex-col gap-0.5 rounded-xl border border-[#2a2f3a] bg-[#0d1017]/95 px-3 py-2 shadow-lg max-w-[78%]">
          <div className="flex items-center gap-2">
            <Box size={13} className="text-[#d4af37] shrink-0" />
            <span className="text-xs font-semibold tracking-tight text-white truncate">
              {activeCatalog.title}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1a1f2b] text-[#cbd5e1] border border-[#2e3646] shrink-0">
              {activeCatalog.parts.length} Parts · Studio PBR
            </span>
          </div>
          <span className="text-[11px] text-[#94a3b8] truncate">
            {inspectedPart
              ? `${inspectedPart.name} — ${inspectedPart.materialSummary}`
              : `${activeFinishInfo.label} · Click any 3D sub-part to inspect`}
          </span>
        </div>

        {/* Top-Right Quick Actions (Snapshot & Viewport Height Toggle) */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => sceneTriggerRef.current.exportSnapshot?.()}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-xl border border-[#2a2f3a] bg-[#0d1017]/95 text-[11px] font-medium text-[#e2e8f0] hover:bg-[#171c28] transition-colors cursor-pointer"
            title="Capture Studio PBR PNG Snapshot"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Snapshot</span>
          </button>
          <button
            type="button"
            onClick={() => setIsExpandedViewport((v) => !v)}
            className="inline-flex items-center justify-center w-8 h-8 rounded-xl border border-[#2a2f3a] bg-[#0d1017]/95 text-[#e2e8f0] hover:bg-[#171c28] transition-colors cursor-pointer"
            title={isExpandedViewport ? 'Compact Viewport' : 'Expand Viewport'}
            aria-label={isExpandedViewport ? 'Compact Viewport' : 'Expand Viewport'}
          >
            {isExpandedViewport ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Unified Collapsible Bottom Control Dock (Zero Side-Panel Clutter, Zero backdrop-filter over WebGL) */}
      <div
        data-testid="threejs-bottom-control-dock"
        className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[95%] max-w-[900px] flex flex-col items-center pointer-events-none"
      >
        {/* Collapse / Expand Cinema Zen Mode Toggle Button */}
        <button
          type="button"
          data-testid="threejs-toggle-hud-btn"
          onClick={() => setIsDockCollapsed((c) => !c)}
          className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-t-xl border border-b-0 border-[#2a2f3a] bg-[#0d1017]/95 text-[11px] font-medium text-[#cbd5e1] hover:text-white transition-colors cursor-pointer"
        >
          {isDockCollapsed ? (
            <>
              <ChevronUp size={13} />
              <span>Show Studio Controls</span>
            </>
          ) : (
            <>
              <ChevronDown size={13} />
              <span>Hide Controls (Zen Mode)</span>
            </>
          )}
        </button>

        {!isDockCollapsed && (
          <div className="pointer-events-auto w-full rounded-2xl border border-[#2a2f3a] bg-[#0d1017]/95 p-3 shadow-2xl space-y-2.5">
            {/* Row 1: Procedural Asset Selector & Exploded View Slider */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Procedural Model Preset Selector */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] mr-1 shrink-0">
                  <Layers size={11} />
                  <span>Asset</span>
                </span>
                {(
                  Object.keys(PROCEDURAL_3D_PRESET_CATALOG) as Procedural3DPresetId[]
                ).map((presetKey) => {
                  const item = PROCEDURAL_3D_PRESET_CATALOG[presetKey];
                  const active = preset === presetKey;
                  const shortLabel =
                    presetKey === 'chronograph_watch'
                      ? 'Chronograph'
                      : presetKey === 'cyber_rover'
                        ? 'Rover'
                        : presetKey === 'robot_mech'
                          ? 'Mech Unit'
                          : presetKey === 'architectural_pavilion'
                            ? 'Pavilion'
                            : presetKey === 'quantum_gyroscope'
                              ? 'Gyroscope'
                              : 'Alpine Dome';
                  return (
                    <button
                      key={presetKey}
                      type="button"
                      data-testid={`threejs-preset-${presetKey}`}
                      onClick={() => {
                        setPreset(presetKey);
                        setInspectedPart(null);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer shrink-0 ${
                        active
                          ? 'bg-[#f5f5f7] text-[#090b10] font-semibold'
                          : 'bg-[#161b26] text-[#cbd5e1] hover:bg-[#222938]'
                      }`}
                      title={item.title}
                    >
                      {shortLabel}
                    </button>
                  );
                })}
              </div>

              {/* Exploded View Slider & Turntable Toggle */}
              <div className="flex items-center gap-3 shrink-0">
                <label className="flex items-center gap-2 text-[11px] text-[#cbd5e1]">
                  <Sliders size={12} className="text-[#94a3b8]" />
                  <span>Explode</span>
                  <input
                    type="range"
                    data-testid="threejs-explode-slider"
                    min={0}
                    max={1}
                    step={0.02}
                    value={explodedTarget}
                    onChange={(e) => setExplodedTarget(parseFloat(e.target.value))}
                    className="w-20 sm:w-24 accent-[#d4af37] cursor-pointer"
                  />
                  <span className="font-mono text-[10px] text-[#94a3b8] w-8 text-right">
                    {Math.round(explodedTarget * 100)}%
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() =>
                    setTurntableSpeed((s) => (s > 0.05 ? 0 : 0.35))
                  }
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                    turntableSpeed > 0.05
                      ? 'bg-[#1e2636] border-[#475569] text-white'
                      : 'bg-[#121620] border-[#262d3d] text-[#94a3b8]'
                  }`}
                  title="Toggle Turntable Rotation"
                >
                  {turntableSpeed > 0.05 ? 'Turntable: On' : 'Turntable: Off'}
                </button>
              </div>
            </div>

            {/* Row 2: PBR Finish Swatches, Studio Lighting Presets & Camera Views */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#1e2430]">
              {/* PBR Material Finishes */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] mr-1">
                  PBR Finish
                </span>
                {(Object.keys(PROCEDURAL_3D_FINISHES) as StudioFinishId[]).map(
                  (fKey) => {
                    const fItem = PROCEDURAL_3D_FINISHES[fKey];
                    const active = finish === fKey;
                    return (
                      <button
                        key={fKey}
                        type="button"
                        data-testid={`threejs-finish-${fKey}`}
                        onClick={() => setFinish(fKey)}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#1f2737] border-[#e2e8f0] text-white font-medium'
                            : 'bg-[#141822] border-[#262d3d] text-[#94a3b8] hover:text-white'
                        }`}
                        title={fItem.label}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-white/30 shrink-0"
                          style={{ backgroundColor: fItem.primaryHex }}
                        />
                        <span className="hidden md:inline">
                          {fKey === 'brushed_gold'
                            ? '18k Gold'
                            : fKey === 'anodized_titanium'
                              ? 'Titanium'
                              : fKey === 'blued_steel'
                                ? 'Blued Steel'
                                : fKey === 'obsidian_chrome'
                                  ? 'Obsidian'
                                  : 'Ceramic'}
                        </span>
                      </button>
                    );
                  }
                )}
              </div>

              {/* Studio Lighting Rig Presets */}
              <div className="flex items-center gap-1">
                <Sun size={12} className="text-[#94a3b8] mr-0.5" />
                {(
                  Object.keys(
                    PROCEDURAL_3D_ENVIRONMENTS
                  ) as StudioEnvironmentPresetId[]
                ).map((envKey) => {
                  const envItem = PROCEDURAL_3D_ENVIRONMENTS[envKey];
                  const active = environment === envKey;
                  const shortEnv =
                    envKey === 'studio_warm'
                      ? 'Atelier'
                      : envKey === 'cyber_twilight'
                        ? 'Twilight'
                        : envKey === 'alpine_daylight'
                          ? 'Daylight'
                          : 'Obsidian';
                  return (
                    <button
                      key={envKey}
                      type="button"
                      onClick={() => setEnvironment(envKey)}
                      className={`px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#252e42] text-white font-medium'
                          : 'bg-[#141822] text-[#94a3b8] hover:text-white'
                      }`}
                      title={envItem.label}
                    >
                      {shortEnv}
                    </button>
                  );
                })}
              </div>

              {/* Smooth Damped Camera Presets & Wireframe */}
              <div className="flex items-center gap-1">
                <Camera size={12} className="text-[#94a3b8] mr-0.5" />
                {(Object.keys(CAMERA_VIEW_PRESETS) as CameraViewPresetId[]).map(
                  (camKey) => {
                    const camItem = CAMERA_VIEW_PRESETS[camKey];
                    const active = cameraPreset === camKey;
                    return (
                      <button
                        key={camKey}
                        type="button"
                        onClick={() => {
                          setCameraPreset(camKey);
                          sceneTriggerRef.current.triggerCameraPreset?.(camKey);
                        }}
                        className={`px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#252e42] text-white font-medium'
                            : 'bg-[#141822] text-[#94a3b8] hover:text-white'
                        }`}
                      >
                        {camItem.label}
                      </button>
                    );
                  }
                )}
                <button
                  type="button"
                  onClick={() => setWireframe((w) => !w)}
                  className={`px-2 py-1 rounded-lg text-[11px] border transition-colors cursor-pointer ${
                    wireframe
                      ? 'bg-[#1f2737] border-[#e2e8f0] text-white'
                      : 'bg-[#141822] border-[#262d3d] text-[#94a3b8]'
                  }`}
                  title="Toggle PBR Wireframe Inspection"
                >
                  Wire
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExplodedTarget(0);
                    setCameraPreset('isometric');
                    setInspectedPart(null);
                    sceneTriggerRef.current.triggerCameraPreset?.('isometric');
                  }}
                  className="p-1.5 rounded-lg bg-[#141822] text-[#94a3b8] hover:text-white transition-colors cursor-pointer"
                  title="Reset View & Assembly"
                  aria-label="Reset View & Assembly"
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
