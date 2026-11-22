import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildProcedural3DSceneSpecFromPrompt,
  detectThreeDSceneIntent,
  parseProcedural3DSceneCodeFence,
  formatProcedural3DSceneMarkdown,
  PROCEDURAL_3D_PRESET_CATALOG,
  Procedural3DPresetId,
} from '../src/lib/threeSceneSpec';
import { createStudioMaterialSuite } from '../src/lib/threeProceduralMaterials';
import {
  buildProcedural3DAssembly,
  groundHeightAt,
} from '../src/lib/threeProceduralModels';
import { toolRegistry } from '../src/lib/toolFramework';

describe('Three.js Studio PBR & Procedural 3D Scene Engine', () => {
  it('detects 3D scene rendering intent from user prompts and maps presets accurately', () => {
    const watchMatch = detectThreeDSceneIntent(
      'Render an interactive 3D model of a luxury gold mechanical tourbillon watch'
    );
    expect(watchMatch.is3DRequest).toBe(true);
    expect(watchMatch.spec.preset).toBe('chronograph_watch');
    expect(watchMatch.spec.finish).toBe('brushed_gold');

    const roverMatch = detectThreeDSceneIntent(
      'Create a Three.js 3D scene of a titanium Mars rover with exploded view'
    );
    expect(roverMatch.is3DRequest).toBe(true);
    expect(roverMatch.spec.preset).toBe('cyber_rover');
    expect(roverMatch.spec.finish).toBe('anodized_titanium');
    expect(roverMatch.spec.explodedFactor).toBeGreaterThan(0);

    const normalChat = detectThreeDSceneIntent('What is the capital of France?');
    expect(normalChat.is3DRequest).toBe(false);
  });

  it('parses JSON and natural language threejs-scene code fences safely', () => {
    const jsonFence = JSON.stringify({
      preset: 'robot_mech',
      finish: 'obsidian_chrome',
      environment: 'cyber_twilight',
      explodedFactor: 0.4,
    });
    const spec = parseProcedural3DSceneCodeFence(jsonFence);
    expect(spec.preset).toBe('robot_mech');
    expect(spec.finish).toBe('obsidian_chrome');
    expect(spec.environment).toBe('cyber_twilight');
    expect(spec.explodedFactor).toBeCloseTo(0.4);

    const fallbackSpec = parseProcedural3DSceneCodeFence('alpine observatory in pine forest');
    expect(fallbackSpec.preset).toBe('alpine_sanctuary');
  });

  it('enforces studio PBR material standards, SRGBColorSpace on color maps, NoColorSpace on normal maps, and software-WebGL transmission guard', () => {
    const gpuSuite = createStudioMaterialSuite({
      finish: 'brushed_gold',
      isSoftwareGl: false,
      maxAnisotropy: 8,
    });

    // Roughness contrast >= 0.25 between primary and secondary adjacent metals
    expect(
      Math.abs(gpuSuite.secondaryMetal.roughness - gpuSuite.primaryMetal.roughness)
    ).toBeGreaterThanOrEqual(0.25);

    // Anisotropy on brushed metals
    expect(gpuSuite.primaryMetal.anisotropy).toBeGreaterThanOrEqual(0.75);

    // Optical glass uses transmission on hardware GPU and depthWrite: false
    expect(gpuSuite.opticalGlass.transmission).toBeGreaterThan(0.8);
    expect(gpuSuite.opticalGlass.depthWrite).toBe(false);

    // Color textures use SRGBColorSpace while normal maps remain in linear NoColorSpace
    expect(gpuSuite.dialSurface.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(gpuSuite.dialSurface.map?.anisotropy).toBe(8);
    expect(gpuSuite.primaryMetal.normalMap?.colorSpace).toBe(THREE.NoColorSpace);

    // Coplanar Z-fighting polygonOffset on floorGrid and dialSurface
    expect(gpuSuite.floorGrid.polygonOffset).toBe(true);
    expect(gpuSuite.dialSurface.polygonOffset).toBe(true);

    // Software WebGL fallback disables transmission multi-pass bottleneck
    const swSuite = createStudioMaterialSuite({
      finish: 'brushed_gold',
      isSoftwareGl: true,
      maxAnisotropy: 1,
    });
    expect(swSuite.opticalGlass.transmission).toBe(0);
    expect(swSuite.opticalGlass.transparent).toBe(true);
    expect(swSuite.opticalGlass.opacity).toBeCloseTo(0.34);

    gpuSuite.dispose();
    swSuite.dispose();
  });

  it('builds composite 6-to-9 part THREE.Group procedural models across all 6 presets and applies exploded-view offsets', () => {
    const materials = createStudioMaterialSuite({
      finish: 'anodized_titanium',
      isSoftwareGl: true,
      maxAnisotropy: 4,
    });

    const presets = Object.keys(
      PROCEDURAL_3D_PRESET_CATALOG
    ) as Procedural3DPresetId[];

    for (const presetId of presets) {
      const assembly = buildProcedural3DAssembly(presetId, materials);
      expect(assembly.root).toBeInstanceOf(THREE.Group);
      // Must be composite 3-12 part procedural models (never a single primitive)
      expect(assembly.parts.length).toBeGreaterThanOrEqual(6);
      expect(assembly.parts.length).toBeLessThanOrEqual(12);

      // Verify exploded-view kinematics move sub-parts along their explode vectors
      const samplePart = assembly.parts[0];
      const basePos = samplePart.basePosition.clone();
      assembly.applyExplodedFactor(1.0);
      expect(samplePart.group.position.distanceTo(basePos)).toBeGreaterThan(0.1);

      assembly.applyExplodedFactor(0);
      expect(samplePart.group.position.distanceTo(basePos)).toBeLessThan(0.001);

      // Run procedural kinematic step without throwing
      assembly.animate(1.25, 0.016);
      assembly.dispose();
    }

    expect(groundHeightAt(0, 0)).toBeCloseTo(0.12);
    materials.dispose();
  });

  it('executes the render_3d_scene tool in toolRegistry and produces a threejs-scene fence', async () => {
    const output = await toolRegistry.executeTool(
      'render_3d_scene',
      {
        prompt: 'Render a horological tourbillon chronograph in brushed gold',
        preset: 'chronograph_watch',
        finish: 'brushed_gold',
        environment: 'studio_warm',
        explodedFactor: 0.25,
      },
      { userId: 'test_user' }
    );

    expect(output.success).toBe(true);
    expect(output.data?.spec?.preset).toBe('chronograph_watch');
    expect(output.data?.markdown).toContain('```threejs-scene');
    const formatted = formatProcedural3DSceneMarkdown(
      buildProcedural3DSceneSpecFromPrompt('quantum gyroscope')
    );
    expect(formatted).toContain('quantum_gyroscope');
  });
});
