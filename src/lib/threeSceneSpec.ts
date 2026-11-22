/**
 * Procedural 3D Scene Specification, Intent Detection, and Parser for Three.js Studio PBR Engine
 *
 * Zero external asset dependencies (zero 404s): all models, textures, materials,
 * and lighting setups are procedurally synthesized in code.
 */

export type Procedural3DPresetId =
  | 'chronograph_watch'
  | 'cyber_rover'
  | 'robot_mech'
  | 'architectural_pavilion'
  | 'quantum_gyroscope'
  | 'alpine_sanctuary';

export type StudioFinishId =
  | 'brushed_gold'
  | 'anodized_titanium'
  | 'blued_steel'
  | 'obsidian_chrome'
  | 'ceramic_ivory';

export type StudioEnvironmentPresetId =
  | 'studio_warm'
  | 'cyber_twilight'
  | 'alpine_daylight'
  | 'obsidian_void';

export type CameraViewPresetId = 'isometric' | 'front' | 'top' | 'macro';

export interface ProceduralPartMetadata {
  id: string;
  name: string;
  category: 'primary' | 'secondary' | 'accent';
  materialSummary: string;
  explodeVector: [number, number, number];
}

export interface Procedural3DSceneSpec {
  version: '1.0';
  preset: Procedural3DPresetId;
  title: string;
  subtitle: string;
  finish: StudioFinishId;
  environment: StudioEnvironmentPresetId;
  cameraPreset: CameraViewPresetId;
  explodedFactor: number; // 0 to 1
  turntableSpeed: number; // 0 to 2
  wireframe: boolean;
  customAccentHex?: string;
  notes?: string;
}

export const PROCEDURAL_3D_FINISHES: Record<
  StudioFinishId,
  {
    id: StudioFinishId;
    label: string;
    primaryHex: string;
    secondaryHex: string;
    accentHex: string;
    glassTintHex: string;
    metalness: number;
    roughness: number;
    anisotropy: number;
  }
> = {
  brushed_gold: {
    id: 'brushed_gold',
    label: 'Brushed 18k Gold',
    primaryHex: '#d4af37',
    secondaryHex: '#23272e',
    accentHex: '#f5d77f',
    glassTintHex: '#e8f4ff',
    metalness: 0.95,
    roughness: 0.16,
    anisotropy: 0.85,
  },
  anodized_titanium: {
    id: 'anodized_titanium',
    label: 'Grade-5 Titanium',
    primaryHex: '#9aa3ad',
    secondaryHex: '#2c323b',
    accentHex: '#ff6b2b',
    glassTintHex: '#dff2ff',
    metalness: 0.92,
    roughness: 0.2,
    anisotropy: 0.8,
  },
  blued_steel: {
    id: 'blued_steel',
    label: 'Horological Blued Steel',
    primaryHex: '#2b547e',
    secondaryHex: '#c8cdd4',
    accentHex: '#e5b84b',
    glassTintHex: '#e3f4ff',
    metalness: 0.94,
    roughness: 0.15,
    anisotropy: 0.82,
  },
  obsidian_chrome: {
    id: 'obsidian_chrome',
    label: 'Obsidian & Mirror Chrome',
    primaryHex: '#1c1f24',
    secondaryHex: '#d8dee6',
    accentHex: '#00e5ff',
    glassTintHex: '#d8f8ff',
    metalness: 0.96,
    roughness: 0.12,
    anisotropy: 0.78,
  },
  ceramic_ivory: {
    id: 'ceramic_ivory',
    label: 'Sintered Ceramic & Rose Gold',
    primaryHex: '#ece8df',
    secondaryHex: '#b76e79',
    accentHex: '#2a2e35',
    glassTintHex: '#fff5ee',
    metalness: 0.35,
    roughness: 0.18,
    anisotropy: 0.4,
  },
};

export const PROCEDURAL_3D_ENVIRONMENTS: Record<
  StudioEnvironmentPresetId,
  {
    id: StudioEnvironmentPresetId;
    label: string;
    backgroundHex: string;
    fogHex: string;
    keyLightHex: string;
    keyLightIntensity: number;
    fillSkyHex: string;
    fillGroundHex: string;
    fillIntensity: number;
    rimLightHex: string;
    rimLightIntensity: number;
    exposure: number;
  }
> = {
  studio_warm: {
    id: 'studio_warm',
    label: 'Warm Atelier Studio',
    backgroundHex: '#0d0f14',
    fogHex: '#0d0f14',
    keyLightHex: '#fff1d6',
    keyLightIntensity: 3.2,
    fillSkyHex: '#8ab4f8',
    fillGroundHex: '#2a211b',
    fillIntensity: 1.1,
    rimLightHex: '#ffbe76',
    rimLightIntensity: 2.2,
    exposure: 1.12,
  },
  cyber_twilight: {
    id: 'cyber_twilight',
    label: 'Cyber Twilight Rig',
    backgroundHex: '#080b12',
    fogHex: '#080b12',
    keyLightHex: '#ff9e64',
    keyLightIntensity: 3.4,
    fillSkyHex: '#5eead4',
    fillGroundHex: '#1e1b4b',
    fillIntensity: 1.25,
    rimLightHex: '#38bdf8',
    rimLightIntensity: 2.6,
    exposure: 1.15,
  },
  alpine_daylight: {
    id: 'alpine_daylight',
    label: 'Alpine Clear Daylight',
    backgroundHex: '#131922',
    fogHex: '#131922',
    keyLightHex: '#fff8e7',
    keyLightIntensity: 3.6,
    fillSkyHex: '#bae6fd',
    fillGroundHex: '#334155',
    fillIntensity: 1.35,
    rimLightHex: '#fde68a',
    rimLightIntensity: 1.9,
    exposure: 1.18,
  },
  obsidian_void: {
    id: 'obsidian_void',
    label: 'High-Contrast Obsidian',
    backgroundHex: '#050608',
    fogHex: '#050608',
    keyLightHex: '#ffffff',
    keyLightIntensity: 3.5,
    fillSkyHex: '#64748b',
    fillGroundHex: '#0f172a',
    fillIntensity: 0.85,
    rimLightHex: '#f59e0b',
    rimLightIntensity: 2.5,
    exposure: 1.08,
  },
};

export const CAMERA_VIEW_PRESETS: Record<
  CameraViewPresetId,
  {
    id: CameraViewPresetId;
    label: string;
    position: [number, number, number];
    target: [number, number, number];
  }
> = {
  isometric: {
    id: 'isometric',
    label: '3/4 Studio',
    position: [4.2, 3.1, 4.6],
    target: [0, 0.9, 0],
  },
  front: {
    id: 'front',
    label: 'Elevation',
    position: [0, 1.5, 5.6],
    target: [0, 0.95, 0],
  },
  top: {
    id: 'top',
    label: 'Plan / Dial',
    position: [0, 6.2, 0.45],
    target: [0, 0.6, 0],
  },
  macro: {
    id: 'macro',
    label: 'Macro Detail',
    position: [2.1, 1.85, 2.3],
    target: [0, 1.05, 0],
  },
};

export const PROCEDURAL_3D_PRESET_CATALOG: Record<
  Procedural3DPresetId,
  {
    id: Procedural3DPresetId;
    title: string;
    subtitle: string;
    defaultFinish: StudioFinishId;
    defaultEnvironment: StudioEnvironmentPresetId;
    parts: ProceduralPartMetadata[];
  }
> = {
  chronograph_watch: {
    id: 'chronograph_watch',
    title: 'Tourbillon Mechanical Chronograph',
    subtitle: '9-Part Horological Assembly with Anisotropic Brushed Bezel & Sapphire Dome',
    defaultFinish: 'brushed_gold',
    defaultEnvironment: 'studio_warm',
    parts: [
      { id: 'case_hull', name: 'Oyster Lathe Case Hull', category: 'primary', materialSummary: 'Anisotropic Brushed Metal (roughness 0.16, metalness 0.95)', explodeVector: [0, -0.35, 0] },
      { id: 'fluted_bezel', name: 'CNC Fluted Tachymeter Bezel', category: 'secondary', materialSummary: 'Polished Alloy (roughness 0.08, metalness 0.98)', explodeVector: [0, 0.55, 0] },
      { id: 'guilloche_dial', name: 'Radial Guilloché Chapter Dial', category: 'primary', materialSummary: 'Procedural SRGB Dial Map (roughness 0.48, metalness 0.25)', explodeVector: [0, 0.15, 0] },
      { id: 'main_gear_train', name: 'Involute Escapement Gear Train', category: 'secondary', materialSummary: 'Brushed Brass (roughness 0.22, metalness 0.92)', explodeVector: [-0.45, 0.35, 0.2] },
      { id: 'tourbillon_cage', name: 'Co-Axial Tourbillon Balance Cage', category: 'secondary', materialSummary: 'Grade-5 Titanium (roughness 0.18, metalness 0.94)', explodeVector: [0.45, 0.42, -0.2] },
      { id: 'chronograph_hands', name: 'Dauphine Hour, Minute & Sweep Hands', category: 'accent', materialSummary: 'Horological Blued Steel (roughness 0.12, metalness 0.96)', explodeVector: [0, 0.8, 0] },
      { id: 'crown_pushers', name: 'Knurled Winding Crown & Twin Pushers', category: 'accent', materialSummary: 'High-Polish Metal (roughness 0.14, metalness 0.95)', explodeVector: [0.85, 0, 0] },
      { id: 'lugs_chassis', name: 'Beveled Sculpted Case Lugs', category: 'secondary', materialSummary: 'Satin Brushed Metal (roughness 0.38, metalness 0.88)', explodeVector: [0, -0.55, 0] },
      { id: 'sapphire_crystal', name: 'Double-Cambered Optical Sapphire Crystal', category: 'accent', materialSummary: 'Optical Transmission Glass (IOR 1.77, clearcoat 1.0)', explodeVector: [0, 1.25, 0] },
    ],
  },
  cyber_rover: {
    id: 'cyber_rover',
    title: 'Autonomous Planetary Exploration Rover',
    subtitle: '9-Part Composite Chassis with Rocker-Bogie Suspension, LiDAR Mast & Solar Wings',
    defaultFinish: 'anodized_titanium',
    defaultEnvironment: 'cyber_twilight',
    parts: [
      { id: 'armored_hull', name: 'Beveled Monocoque Armored Hull', category: 'primary', materialSummary: 'Anodized Titanium Alloy (roughness 0.22, metalness 0.90)', explodeVector: [0, 0.25, 0] },
      { id: 'suspension_bogie', name: 'Articulated Rocker-Bogie Suspension', category: 'secondary', materialSummary: 'Matte Carbon Composite (roughness 0.58, metalness 0.35)', explodeVector: [0, -0.45, 0] },
      { id: 'treaded_wheels', name: '6x6 Titanium Cleated Mobility Wheels', category: 'secondary', materialSummary: 'Vulcanized Tread & Alloy Hubs (roughness 0.65, metalness 0.45)', explodeVector: [0.85, -0.35, 0] },
      { id: 'cockpit_canopy', name: 'Pressurized Sensor Canopy Dome', category: 'secondary', materialSummary: 'Optical Polycarbonate Glass (IOR 1.58, clearcoat 1.0)', explodeVector: [0, 0.85, 0.45] },
      { id: 'lidar_turret', name: '360° Gimbal LiDAR & Optical Mast', category: 'accent', materialSummary: 'Specular Chrome & Optics (roughness 0.12, metalness 0.96)', explodeVector: [0, 1.15, -0.35] },
      { id: 'solar_wings', name: 'Deployable Photovoltaic Wing Array', category: 'secondary', materialSummary: 'Micro-Grid Silicon Cell Texture (roughness 0.28, metalness 0.75)', explodeVector: [0, 0.65, -0.75] },
      { id: 'rtg_core', name: 'Finned Radioisotope Thermal Generator', category: 'accent', materialSummary: 'High-Emissive Copper Radiator (roughness 0.32, metalness 0.88)', explodeVector: [0, 0.35, -1.1] },
      { id: 'headlight_array', name: 'Twin High-Lumen LED Bar & Visor', category: 'accent', materialSummary: 'Emissive Optics (roughness 0.1, metalness 0.5)', explodeVector: [0, 0.2, 1.1] },
    ],
  },
  robot_mech: {
    id: 'robot_mech',
    title: 'Bipedal Tactile Robotics Unit',
    subtitle: '8-Part Articulated Cybernetic Android with Optical Visor & Harmonic Actuators',
    defaultFinish: 'obsidian_chrome',
    defaultEnvironment: 'cyber_twilight',
    parts: [
      { id: 'thorax_chassis', name: 'Beveled Carbon-Titanium Thorax Core', category: 'primary', materialSummary: 'Anisotropic Alloy (roughness 0.18, metalness 0.94)', explodeVector: [0, 0.2, 0] },
      { id: 'cranial_helm', name: 'Aerodynamic Cranial Sensor Unit', category: 'secondary', materialSummary: 'Satin Shell (roughness 0.26, metalness 0.88)', explodeVector: [0, 0.95, 0] },
      { id: 'optical_visor', name: 'Curved Transmissive HUD Optical Visor', category: 'accent', materialSummary: 'Optical Glass & Emissive Reticle (IOR 1.65, clearcoat 1.0)', explodeVector: [0, 0.95, 0.65] },
      { id: 'pauldrons_armor', name: 'Twin Harmonic Shoulder Pauldrons', category: 'secondary', materialSummary: 'Brushed Metal (roughness 0.15, metalness 0.95)', explodeVector: [0.85, 0.5, 0] },
      { id: 'articulated_arms', name: '6-DOF Manipulator Forearms & Servos', category: 'secondary', materialSummary: 'Matte Structural Polymer (roughness 0.55, metalness 0.4)', explodeVector: [0.95, 0.05, 0.25] },
      { id: 'arc_reactor', name: 'Toroidal Tokamak Chest Core', category: 'accent', materialSummary: 'Crystal Lens & Cyan Glow (IOR 1.9, clearcoat 1.0)', explodeVector: [0, 0.3, 0.85] },
      { id: 'pelvic_gyro', name: 'Tri-Axial Pelvic Balance Gyroscope', category: 'secondary', materialSummary: 'Dark Gunmetal (roughness 0.42, metalness 0.82)', explodeVector: [0, -0.35, 0] },
      { id: 'bipedal_legs', name: 'Hydraulic Strut Legs & Grounded Footpads', category: 'primary', materialSummary: 'Reinforced Alloy (roughness 0.3, metalness 0.89)', explodeVector: [0, -0.75, 0] },
    ],
  },
  architectural_pavilion: {
    id: 'architectural_pavilion',
    title: 'Parametric Glass & Cantilever Pavilion',
    subtitle: '7-Part Modernist Architectural Sanctuary with Ribbed Timber Canopy & Reflecting Pool',
    defaultFinish: 'ceramic_ivory',
    defaultEnvironment: 'alpine_daylight',
    parts: [
      { id: 'travertine_plinth', name: 'Stepped Travertine Cantilever Plinth', category: 'primary', materialSummary: 'Honed Stone Texture (roughness 0.62, metalness 0.08)', explodeVector: [0, -0.45, 0] },
      { id: 'structural_columns', name: 'Cruciform Brushed Steel Columns', category: 'secondary', materialSummary: 'Anisotropic Steel (roughness 0.2, metalness 0.94)', explodeVector: [-0.65, 0.2, 0] },
      { id: 'curtain_glazing', name: 'Double-Height Architectural Glass Walls', category: 'secondary', materialSummary: 'Low-Iron Optical Glass (IOR 1.52, clearcoat 1.0)', explodeVector: [0, 0.35, 0.75] },
      { id: 'parametric_roof', name: 'Cantilevered Louvered Timber & Alloy Roof', category: 'primary', materialSummary: 'Warm Satin Composite (roughness 0.36, metalness 0.55)', explodeVector: [0, 1.05, 0] },
      { id: 'reflecting_pool', name: 'Specular Courtyard Reflecting Basin', category: 'secondary', materialSummary: 'Animated Ripple PBR Surface (roughness 0.06, metalness 0.15)', explodeVector: [0.55, -0.15, 0.45] },
      { id: 'sculptural_monolith', name: 'Central Courtyard Bronze Sculpture', category: 'accent', materialSummary: 'Polished Bronze (roughness 0.14, metalness 0.96)', explodeVector: [0, 0.55, -0.35] },
      { id: 'perimeter_lanterns', name: 'Warm Architectural Bollard Luminaires', category: 'accent', materialSummary: 'Warm Emissive Brass (roughness 0.25, metalness 0.88)', explodeVector: [0.75, 0.15, -0.55] },
    ],
  },
  quantum_gyroscope: {
    id: 'quantum_gyroscope',
    title: 'Astrolabe Quantum Gimbal Resonator',
    subtitle: '8-Part Concentric Precision Gimbal Rings with Engraved Degree Markings & Crystal Core',
    defaultFinish: 'brushed_gold',
    defaultEnvironment: 'obsidian_void',
    parts: [
      { id: 'pedestal_base', name: 'Turned Lathe Meridian Pedestal', category: 'primary', materialSummary: 'Satin Obsidian & Brass (roughness 0.35, metalness 0.85)', explodeVector: [0, -0.65, 0] },
      { id: 'outer_meridian', name: 'Graduated Outer Meridian Ring', category: 'primary', materialSummary: 'Anisotropic Brushed Gold (roughness 0.16, metalness 0.96)', explodeVector: [0.75, 0.15, 0] },
      { id: 'middle_gimbal', name: 'Equatorial Astrolabe Gimbal Ring', category: 'secondary', materialSummary: 'Polished Titanium (roughness 0.14, metalness 0.94)', explodeVector: [-0.75, 0.35, 0] },
      { id: 'inner_gimbal', name: 'High-Velocity Azimuth Inner Ring', category: 'secondary', materialSummary: 'Horological Blued Steel (roughness 0.12, metalness 0.95)', explodeVector: [0, 0.55, 0.75] },
      { id: 'quantum_core', name: 'Faceted Refractive Diamond Singularity Core', category: 'accent', materialSummary: 'High-Dispersion Crystal (IOR 2.4, clearcoat 1.0)', explodeVector: [0, 0.85, 0] },
      { id: 'magnetic_coils', name: 'Toroidal Copper Field Stabilizer Coils', category: 'accent', materialSummary: 'Wound Copper (roughness 0.24, metalness 0.92)', explodeVector: [0, 0.25, -0.8] },
    ],
  },
  alpine_sanctuary: {
    id: 'alpine_sanctuary',
    title: 'Alpine Geodesic Observatory & Pine Grove',
    subtitle: 'Natural Outdoor Perimeter with Instanced Pine Forest, Rock Outcrops & Geodesic Dome',
    defaultFinish: 'anodized_titanium',
    defaultEnvironment: 'alpine_daylight',
    parts: [
      { id: 'mountain_terrain', name: 'Layered Relief Terrain & Natural Rock Perimeter', category: 'primary', materialSummary: 'Matte Alpine Stone & Moss (roughness 0.78, metalness 0.05)', explodeVector: [0, -0.45, 0] },
      { id: 'stone_foundation', name: 'Octagonal Granite Observatory Pier', category: 'primary', materialSummary: 'Chiseled Granite (roughness 0.55, metalness 0.15)', explodeVector: [0, -0.15, 0] },
      { id: 'observatory_rotunda', name: 'Brushed Alloy Telescope Rotunda', category: 'secondary', materialSummary: 'Anisotropic Titanium (roughness 0.2, metalness 0.92)', explodeVector: [0, 0.45, 0] },
      { id: 'geodesic_dome', name: 'Faceted Optical Glass Geodesic Canopy', category: 'secondary', materialSummary: 'Optical Glass (IOR 1.55, clearcoat 1.0)', explodeVector: [0, 1.05, 0] },
      { id: 'telescope_aperture', name: 'Primary Cassegrain Mirror & Brass Tube', category: 'accent', materialSummary: 'Mirror Chrome & Brass (roughness 0.08, metalness 0.98)', explodeVector: [0.35, 0.75, 0.45] },
      { id: 'pine_forest', name: 'Instanced Multi-Tier Alpine Pine Grove & Boulders', category: 'secondary', materialSummary: 'Instanced Foliage with ±15% Scale & Tint Variation', explodeVector: [0.65, 0.3, -0.55] },
    ],
  },
};

export interface ThreeSceneIntentMatch {
  is3DRequest: boolean;
  spec: Procedural3DSceneSpec;
}

/**
 * Resolves the best procedural 3D preset, material finish, and studio lighting environment
 * from natural-language user prompts.
 */
export function buildProcedural3DSceneSpecFromPrompt(
  prompt: string,
  overrides?: Partial<Procedural3DSceneSpec>
): Procedural3DSceneSpec {
  const lower = String(prompt || '').toLowerCase();

  let preset: Procedural3DPresetId = 'chronograph_watch';
  if (/\b(rover|vehicle|car|buggy|truck|mars|spacecraft|wheels|tank)\b/i.test(lower)) {
    preset = 'cyber_rover';
  } else if (/\b(robot|mech|android|cyborg|bot|humanoid|drone)\b/i.test(lower)) {
    preset = 'robot_mech';
  } else if (/\b(architecture|pavilion|building|house|villa|temple|structure|tower|bridge|interior)\b/i.test(lower)) {
    preset = 'architectural_pavilion';
  } else if (/\b(forest|landscape|nature|tree|mountain|island|terrain|outdoor|valley|observatory|alpine)\b/i.test(lower)) {
    preset = 'alpine_sanctuary';
  } else if (/\b(gyro|gyroscope|astrolabe|orb|sphere|quantum|core|atom|reactor|crystal|ring)\b/i.test(lower)) {
    preset = 'quantum_gyroscope';
  } else if (/\b(watch|clock|chronograph|tourbillon|gear|mechanical|horology|timepiece)\b/i.test(lower)) {
    preset = 'chronograph_watch';
  }

  const catalogEntry = PROCEDURAL_3D_PRESET_CATALOG[preset];

  let finish: StudioFinishId = catalogEntry.defaultFinish;
  if (/\b(gold|brass|bronze|luxury)\b/i.test(lower)) {
    finish = 'brushed_gold';
  } else if (/\b(titanium|silver|aluminum|steel|grey|gray)\b/i.test(lower)) {
    finish = 'anodized_titanium';
  } else if (/\b(blue|sapphire|cobalt|navy)\b/i.test(lower)) {
    finish = 'blued_steel';
  } else if (/\b(obsidian|black|dark|chrome|cyber|neon)\b/i.test(lower)) {
    finish = 'obsidian_chrome';
  } else if (/\b(ceramic|white|ivory|marble|rose)\b/i.test(lower)) {
    finish = 'ceramic_ivory';
  }

  let environment: StudioEnvironmentPresetId = catalogEntry.defaultEnvironment;
  if (/\b(warm|sunset|gold|atelier)\b/i.test(lower)) {
    environment = 'studio_warm';
  } else if (/\b(cyber|neon|night|twilight|sci-fi|scifi)\b/i.test(lower)) {
    environment = 'cyber_twilight';
  } else if (/\b(day|daylight|outdoor|sun|alpine|bright)\b/i.test(lower)) {
    environment = 'alpine_daylight';
  } else if (/\b(void|black|dark|contrast|obsidian)\b/i.test(lower)) {
    environment = 'obsidian_void';
  }

  const explodedFactor = /\b(explode|exploded|disassemble|cutaway|internal|parts)\b/i.test(lower)
    ? 0.65
    : 0;

  return {
    version: '1.0',
    preset: overrides?.preset || preset,
    title: overrides?.title || catalogEntry.title,
    subtitle: overrides?.subtitle || catalogEntry.subtitle,
    finish: overrides?.finish || finish,
    environment: overrides?.environment || environment,
    cameraPreset: overrides?.cameraPreset || 'isometric',
    explodedFactor:
      typeof overrides?.explodedFactor === 'number'
        ? Math.max(0, Math.min(1, overrides.explodedFactor))
        : explodedFactor,
    turntableSpeed:
      typeof overrides?.turntableSpeed === 'number'
        ? Math.max(0, Math.min(2, overrides.turntableSpeed))
        : 0.35,
    wireframe: Boolean(overrides?.wireframe),
    customAccentHex: overrides?.customAccentHex,
    notes: overrides?.notes || prompt.trim().slice(0, 240),
  };
}

/**
 * Detects when a user prompt is asking to render or view an interactive 3D model or Three.js scene.
 */
export function detectThreeDSceneIntent(prompt: string): ThreeSceneIntentMatch {
  const clean = String(prompt || '')
    .replace(/\[IMAGE_DATA_URL:[^\]]+\]\s*/gi, '')
    .replace(/\[Attached[^\]]*\]\s*/gi, '')
    .replace(/^\[MODE:[^\]]*\]\s*/i, '')
    .replace(/^\[Think Harder[^\]]*\]\s*/i, '')
    .trim();

  const isExplicit3DCommand =
    /\b(render|create|generate|show|build|display|open|launch|visualize|preview)\b[\s\S]{0,60}\b(3d\s*(?:model|scene|object|view|viewer|render|simulation|asset|environment|watch|rover|robot|mech|pavilion|gyroscope)|three\.?js|webgl\s*scene|pbr\s*(?:scene|model|render))\b/i.test(
      clean
    ) ||
    /\b(interactive\s+3d|three\.?js\s+(?:scene|model|viewer|studio|pbr)|studio\s+pbr\s+render)\b/i.test(
      clean
    );

  return {
    is3DRequest: isExplicit3DCommand,
    spec: buildProcedural3DSceneSpecFromPrompt(clean),
  };
}

/**
 * Parses a JSON code fence string (`threejs-scene` or `3d-scene`) into a validated `Procedural3DSceneSpec`.
 */
export function parseProcedural3DSceneCodeFence(rawCode: string): Procedural3DSceneSpec {
  const trimmed = String(rawCode || '').trim();
  if (!trimmed) {
    return buildProcedural3DSceneSpecFromPrompt('chronograph_watch');
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const candidatePreset = String(parsed.preset || '').trim() as Procedural3DPresetId;
      const validPreset: Procedural3DPresetId =
        candidatePreset in PROCEDURAL_3D_PRESET_CATALOG ? candidatePreset : 'chronograph_watch';
      const candidateFinish = String(parsed.finish || '').trim() as StudioFinishId;
      const validFinish: StudioFinishId =
        candidateFinish in PROCEDURAL_3D_FINISHES
          ? candidateFinish
          : PROCEDURAL_3D_PRESET_CATALOG[validPreset].defaultFinish;
      const candidateEnv = String(parsed.environment || '').trim() as StudioEnvironmentPresetId;
      const validEnv: StudioEnvironmentPresetId =
        candidateEnv in PROCEDURAL_3D_ENVIRONMENTS
          ? candidateEnv
          : PROCEDURAL_3D_PRESET_CATALOG[validPreset].defaultEnvironment;
      const candidateCamera = String(parsed.cameraPreset || '').trim() as CameraViewPresetId;
      const validCamera: CameraViewPresetId =
        candidateCamera in CAMERA_VIEW_PRESETS ? candidateCamera : 'isometric';

      return buildProcedural3DSceneSpecFromPrompt(
        String(parsed.prompt || parsed.title || parsed.notes || validPreset),
        {
          preset: validPreset,
          title:
            typeof parsed.title === 'string' && parsed.title.trim()
              ? parsed.title.trim()
              : PROCEDURAL_3D_PRESET_CATALOG[validPreset].title,
          subtitle:
            typeof parsed.subtitle === 'string' && parsed.subtitle.trim()
              ? parsed.subtitle.trim()
              : PROCEDURAL_3D_PRESET_CATALOG[validPreset].subtitle,
          finish: validFinish,
          environment: validEnv,
          cameraPreset: validCamera,
          explodedFactor:
            typeof parsed.explodedFactor === 'number' ? parsed.explodedFactor : undefined,
          turntableSpeed:
            typeof parsed.turntableSpeed === 'number' ? parsed.turntableSpeed : undefined,
          wireframe: typeof parsed.wireframe === 'boolean' ? parsed.wireframe : false,
          customAccentHex:
            typeof parsed.customAccentHex === 'string' ? parsed.customAccentHex : undefined,
          notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
        }
      );
    }
  } catch {
    // Fallback: treat rawCode as natural language prompt description
  }

  return buildProcedural3DSceneSpecFromPrompt(trimmed);
}

/**
 * Formats a complete markdown response containing the interactive ```threejs-scene fence
 * and architectural summary of the procedural PBR assembly.
 */
export function formatProcedural3DSceneMarkdown(spec: Procedural3DSceneSpec): string {
  const catalog = PROCEDURAL_3D_PRESET_CATALOG[spec.preset];
  const finishInfo = PROCEDURAL_3D_FINISHES[spec.finish];
  const envInfo = PROCEDURAL_3D_ENVIRONMENTS[spec.environment];

  const fencePayload = JSON.stringify(spec, null, 2);
  const partBullets = catalog.parts
    .map((p) => `- **${p.name}** (\`${p.category}\`): ${p.materialSummary}`)
    .join('\n');

  return (
    `### ${spec.title}\n` +
    `${spec.subtitle}\n\n` +
    `\`\`\`threejs-scene\n${fencePayload}\n\`\`\`\n\n` +
    `#### Studio PBR & Procedural Architecture\n` +
    `- **Surface Finish**: ${finishInfo.label} (\`metalness: ${finishInfo.metalness}\`, \`roughness: ${finishInfo.roughness}\`, \`anisotropy: ${finishInfo.anisotropy}\`)\n` +
    `- **Studio Lighting Rig**: ${envInfo.label} (\`RoomEnvironment\` PMREM reflections + 3-point warm/cool studio rig + \`RectAreaLight\` softboxes + radial contact shadow grounding)\n` +
    `- **Composite Multi-Part Hierarchy (${catalog.parts.length} Procedural Components)**:\n` +
    `${partBullets}`
  );
}
