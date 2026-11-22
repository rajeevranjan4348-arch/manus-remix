/**
 * Composite 3–12 Part Procedural 3D Model Assemblies (`THREE.Group`)
 *
 * Follows Three.js Studio PBR & Procedural Architecture Directives:
 * - Every subject is assembled as a `THREE.Group` of 6–9 distinct sub-assemblies across
 *   3 silhouette scales: Primary silhouette, Secondary read, and Accent detail.
 * - Uses `ExtrudeGeometry` (with bevels), `LatheGeometry`, `TubeGeometry`, and `InstancedMesh`
 *   (with `±15%` per-instance scale variation, `setColorAt` tint variation, and `computeBoundingSphere()`).
 * - Pivots models at bottom-center (`y = 0`) so they sit flush on the studio floor or terrain (`groundHeightAt(x, z)`).
 * - Pre-allocates module-scope reusable math helpers (`_dummy`, `_color`, `_vec3`) for zero GC in animation loops.
 */

import * as THREE from 'three';
import {
  PROCEDURAL_3D_PRESET_CATALOG,
  Procedural3DPresetId,
  ProceduralPartMetadata,
} from './threeSceneSpec';
import { StudioMaterialSuite } from './threeProceduralMaterials';

// Module-scope pre-allocated math objects for zero-GC transforms and animations
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _vec3 = new THREE.Vector3();

export interface ProceduralSubPartNode {
  meta: ProceduralPartMetadata;
  group: THREE.Group;
  basePosition: THREE.Vector3;
  explodeOffset: THREE.Vector3;
}

export interface BuiltProceduralAssembly {
  root: THREE.Group;
  parts: ProceduralSubPartNode[];
  geometries: THREE.BufferGeometry[];
  animate: (elapsedSec: number, deltaSec: number) => void;
  applyExplodedFactor: (currentFactor: number) => void;
  dispose: () => void;
}

/**
 * Deterministic terrain elevation helper for outdoor scenes so every tree, boulder, and pier
 * sits flush on the ground with zero floating props.
 */
export function groundHeightAt(x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z);
  if (r < 1.35) return 0.12;
  const ridge = Math.sin(x * 1.4) * Math.cos(z * 1.4) * 0.14;
  const bowl = Math.min(0.85, Math.max(0, (r - 1.35) * 0.18));
  return 0.12 + ridge + bowl;
}

/**
 * Helper to create an involute-style extruded gear wheel with bevels and tangents.
 */
function createExtrudedGearGeometry(
  outerRadius: number,
  innerRadius: number,
  teeth: number,
  depth: number
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / (teeth * 2);

  for (let i = 0; i < teeth * 2; i++) {
    const angle = i * step;
    const rad = i % 2 === 0 ? outerRadius : outerRadius * 0.86;
    const x = Math.cos(angle) * rad;
    const y = Math.sin(angle) * rad;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  if (innerRadius > 0.02) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }

  const geom = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.18,
    bevelSize: outerRadius * 0.03,
    bevelSegments: 2,
  });
  geom.center();
  geom.computeVertexNormals();
  return geom;
}

/**
 * Helper to create a beveled rounded rectangular plate via `ExtrudeGeometry`.
 */
function createBeveledBoxGeometry(
  width: number,
  height: number,
  depth: number,
  radius = 0.08
): THREE.ExtrudeGeometry {
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w * 0.4, h * 0.4);
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);

  const geom = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth,
    bevelEnabled: true,
    bevelThickness: Math.min(0.05, depth * 0.15),
    bevelSize: Math.min(0.05, r * 0.5),
    bevelSegments: 3,
  });
  geom.center();
  geom.computeVertexNormals();
  return geom;
}

/**
 * Configures shadow casting and layer assignment (`layer 1` enabled for raycast inspection).
 */
function registerPartMesh(
  mesh: THREE.Object3D,
  partMeta: ProceduralPartMetadata,
  castShadow = true,
  receiveShadow = true
) {
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.layers.enable(1);
  mesh.userData.partId = partMeta.id;
  mesh.userData.partName = partMeta.name;
  mesh.userData.partCategory = partMeta.category;
  mesh.userData.materialSummary = partMeta.materialSummary;
}

/**
 * Builds the requested composite 3–12 part procedural 3D model assembly.
 */
export function buildProcedural3DAssembly(
  preset: Procedural3DPresetId,
  materials: StudioMaterialSuite
): BuiltProceduralAssembly {
  const root = new THREE.Group();
  root.name = `procedural_assembly_${preset}`;

  const catalog = PROCEDURAL_3D_PRESET_CATALOG[preset] || PROCEDURAL_3D_PRESET_CATALOG.chronograph_watch;
  const geometries: THREE.BufferGeometry[] = [];
  const parts: ProceduralSubPartNode[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };

  const createPartGroup = (meta: ProceduralPartMetadata, basePos: [number, number, number]): THREE.Group => {
    const group = new THREE.Group();
    group.name = meta.id;
    group.position.set(basePos[0], basePos[1], basePos[2]);
    group.userData.partId = meta.id;
    group.userData.partName = meta.name;
    root.add(group);
    parts.push({
      meta,
      group,
      basePosition: new THREE.Vector3(basePos[0], basePos[1], basePos[2]),
      explodeOffset: new THREE.Vector3(
        meta.explodeVector[0],
        meta.explodeVector[1],
        meta.explodeVector[2]
      ),
    });
    return group;
  };

  let dynamicHook: (elapsedSec: number, deltaSec: number) => void = () => {};

  if (preset === 'chronograph_watch') {
    const [
      caseMeta,
      bezelMeta,
      dialMeta,
      gearMeta,
      tourbillonMeta,
      handsMeta,
      crownMeta,
      lugsMeta,
      crystalMeta,
    ] = catalog.parts;

    // 1. Primary Lathe Case Hull (grounded at y = 0.42)
    const caseGroup = createPartGroup(caseMeta, [0, 0.42, 0]);
    const lathePoints = [
      new THREE.Vector2(0, -0.24),
      new THREE.Vector2(1.45, -0.24),
      new THREE.Vector2(1.64, -0.1),
      new THREE.Vector2(1.66, 0.16),
      new THREE.Vector2(1.48, 0.24),
      new THREE.Vector2(1.38, 0.24),
      new THREE.Vector2(1.38, 0.02),
      new THREE.Vector2(0, 0.02),
    ];
    const caseGeom = trackGeo(new THREE.LatheGeometry(lathePoints, 64));
    const caseMesh = new THREE.Mesh(caseGeom, materials.primaryMetal);
    registerPartMesh(caseMesh, caseMeta);
    caseGroup.add(caseMesh);

    // 2. CNC Fluted Bezel with Instanced Flutes (> 20 repeated items)
    const bezelGroup = createPartGroup(bezelMeta, [0, 0.68, 0]);
    const bezelRingGeom = trackGeo(new THREE.TorusGeometry(1.48, 0.11, 24, 72));
    bezelRingGeom.rotateX(Math.PI / 2);
    const bezelMesh = new THREE.Mesh(bezelRingGeom, materials.secondaryMetal);
    registerPartMesh(bezelMesh, bezelMeta);
    bezelGroup.add(bezelMesh);

    const fluteGeom = trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 10));
    const fluteCount = 36;
    const fluteInstanced = new THREE.InstancedMesh(fluteGeom, materials.accentMetal, fluteCount);
    for (let i = 0; i < fluteCount; i++) {
      const a = (i / fluteCount) * Math.PI * 2;
      _dummy.position.set(Math.cos(a) * 1.54, 0, Math.sin(a) * 1.54);
      _dummy.rotation.set(0, -a, 0);
      _dummy.scale.setScalar(1 + (i % 2 === 0 ? 0.06 : -0.04));
      _dummy.updateMatrix();
      fluteInstanced.setMatrixAt(i, _dummy.matrix);
    }
    fluteInstanced.instanceMatrix.needsUpdate = true;
    fluteInstanced.computeBoundingSphere();
    registerPartMesh(fluteInstanced, bezelMeta);
    bezelGroup.add(fluteInstanced);

    // 3. Radial Guilloche Chapter Dial
    const dialGroup = createPartGroup(dialMeta, [0, 0.48, 0]);
    const dialGeom = trackGeo(new THREE.CylinderGeometry(1.38, 1.38, 0.04, 64));
    const dialMesh = new THREE.Mesh(dialGeom, materials.dialSurface);
    registerPartMesh(dialMesh, dialMeta, false, true);
    dialGroup.add(dialMesh);

    // 4. Involute Escapement Gear Train
    const gearGroup = createPartGroup(gearMeta, [0, 0.56, 0]);
    const mainGearGeom = trackGeo(createExtrudedGearGeometry(0.46, 0.14, 18, 0.05));
    mainGearGeom.rotateX(Math.PI / 2);
    const mainGearMesh = new THREE.Mesh(mainGearGeom, materials.primaryMetal);
    mainGearMesh.position.set(-0.48, 0, 0.12);
    registerPartMesh(mainGearMesh, gearMeta);
    gearGroup.add(mainGearMesh);

    const secGearGeom = trackGeo(createExtrudedGearGeometry(0.32, 0.09, 14, 0.05));
    secGearGeom.rotateX(Math.PI / 2);
    const secGearMesh = new THREE.Mesh(secGearGeom, materials.accentMetal);
    secGearMesh.position.set(0.18, 0.03, -0.36);
    registerPartMesh(secGearMesh, gearMeta);
    gearGroup.add(secGearMesh);

    // 5. Co-Axial Tourbillon Balance Cage
    const tourbillonGroup = createPartGroup(tourbillonMeta, [0.46, 0.58, 0.34]);
    const cageRingGeom = trackGeo(new THREE.TorusGeometry(0.34, 0.028, 16, 48));
    cageRingGeom.rotateX(Math.PI / 2);
    const cageMesh = new THREE.Mesh(cageRingGeom, materials.secondaryMetal);
    registerPartMesh(cageMesh, tourbillonMeta);
    tourbillonGroup.add(cageMesh);

    const bridgeGeom = trackGeo(createBeveledBoxGeometry(0.68, 0.045, 0.07, 0.02));
    const bridgeMesh = new THREE.Mesh(bridgeGeom, materials.accentMetal);
    registerPartMesh(bridgeMesh, tourbillonMeta);
    tourbillonGroup.add(bridgeMesh);

    // 6. Dauphine Hands
    const handsGroup = createPartGroup(handsMeta, [0, 0.66, 0]);
    const hourHandGeom = trackGeo(createBeveledBoxGeometry(0.08, 0.03, 0.78, 0.015));
    hourHandGeom.translate(0, 0, -0.28);
    const hourHandMesh = new THREE.Mesh(hourHandGeom, materials.accentMetal);
    registerPartMesh(hourHandMesh, handsMeta);
    handsGroup.add(hourHandMesh);

    const minHandGeom = trackGeo(createBeveledBoxGeometry(0.055, 0.025, 1.12, 0.012));
    minHandGeom.translate(0, 0.02, -0.42);
    const minHandMesh = new THREE.Mesh(minHandGeom, materials.primaryMetal);
    registerPartMesh(minHandMesh, handsMeta);
    handsGroup.add(minHandMesh);

    const sweepPivotGeom = trackGeo(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 20));
    const sweepPivotMesh = new THREE.Mesh(sweepPivotGeom, materials.emissiveAccent);
    registerPartMesh(sweepPivotMesh, handsMeta);
    handsGroup.add(sweepPivotMesh);

    // 7. Knurled Crown & Twin Pushers
    const crownGroup = createPartGroup(crownMeta, [1.74, 0.46, 0]);
    const crownGeom = trackGeo(createExtrudedGearGeometry(0.18, 0.0, 16, 0.22));
    crownGeom.rotateY(Math.PI / 2);
    const crownMesh = new THREE.Mesh(crownGeom, materials.accentMetal);
    registerPartMesh(crownMesh, crownMeta);
    crownGroup.add(crownMesh);

    const pusherGeom = trackGeo(new THREE.CylinderGeometry(0.09, 0.1, 0.24, 20));
    pusherGeom.rotateZ(Math.PI / 2);
    const pusherTop = new THREE.Mesh(pusherGeom, materials.secondaryMetal);
    pusherTop.position.set(-0.08, 0, -0.68);
    pusherTop.rotation.y = 0.36;
    const pusherBot = new THREE.Mesh(pusherGeom, materials.secondaryMetal);
    pusherBot.position.set(-0.08, 0, 0.68);
    pusherBot.rotation.y = -0.36;
    registerPartMesh(pusherTop, crownMeta);
    registerPartMesh(pusherBot, crownMeta);
    crownGroup.add(pusherTop, pusherBot);

    // 8. Sculpted Beveled Lugs (grounded at y = 0.18 so bottom touches y = 0)
    const lugsGroup = createPartGroup(lugsMeta, [0, 0.22, 0]);
    const lugGeom = trackGeo(createBeveledBoxGeometry(0.95, 0.36, 0.55, 0.08));
    const lugNorth = new THREE.Mesh(lugGeom, materials.satinChassis);
    lugNorth.position.set(0, 0, -1.66);
    const lugSouth = new THREE.Mesh(lugGeom, materials.satinChassis);
    lugSouth.position.set(0, 0, 1.66);
    registerPartMesh(lugNorth, lugsMeta);
    registerPartMesh(lugSouth, lugsMeta);
    lugsGroup.add(lugNorth, lugSouth);

    // 9. Double-Cambered Optical Sapphire Crystal Dome (renderOrder = 10, depthWrite = false)
    const crystalGroup = createPartGroup(crystalMeta, [0, 0.72, 0]);
    const crystalGeom = trackGeo(
      new THREE.SphereGeometry(1.42, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.26)
    );
    crystalGeom.scale(1, 0.45, 1);
    const crystalMesh = new THREE.Mesh(crystalGeom, materials.opticalGlass);
    crystalMesh.renderOrder = 10;
    registerPartMesh(crystalMesh, crystalMeta, false, false);
    crystalGroup.add(crystalMesh);

    dynamicHook = (elapsedSec) => {
      mainGearMesh.rotation.z = elapsedSec * 0.85;
      secGearMesh.rotation.z = -elapsedSec * 1.15;
      tourbillonGroup.rotation.y = elapsedSec * 1.8;
      minHandMesh.rotation.y = -elapsedSec * 0.15;
      hourHandMesh.rotation.y = -elapsedSec * 0.025;
    };
  } else if (preset === 'cyber_rover') {
    const [
      hullMeta,
      bogieMeta,
      wheelsMeta,
      canopyMeta,
      lidarMeta,
      wingsMeta,
      rtgMeta,
      lightsMeta,
    ] = catalog.parts;

    // 1. Armored Hull
    const hullGroup = createPartGroup(hullMeta, [0, 0.78, 0]);
    const hullGeom = trackGeo(createBeveledBoxGeometry(1.55, 0.56, 2.35, 0.12));
    const hullMesh = new THREE.Mesh(hullGeom, materials.primaryMetal);
    registerPartMesh(hullMesh, hullMeta);
    hullGroup.add(hullMesh);

    // 2. Rocker-Bogie Suspension Struts
    const bogieGroup = createPartGroup(bogieMeta, [0, 0.44, 0]);
    const strutCurveLeft = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.82, -0.1, -0.95),
      new THREE.Vector3(-0.82, 0.18, 0),
      new THREE.Vector3(-0.82, -0.1, 0.95),
    ]);
    const strutGeomLeft = trackGeo(new THREE.TubeGeometry(strutCurveLeft, 24, 0.055, 12, false));
    const strutLeft = new THREE.Mesh(strutGeomLeft, materials.matteComposite);
    const strutRight = strutLeft.clone();
    strutRight.position.x = 1.64;
    registerPartMesh(strutLeft, bogieMeta);
    registerPartMesh(strutRight, bogieMeta);
    bogieGroup.add(strutLeft, strutRight);

    // 3. 6x6 Cleated Wheels (grounded at y = 0.34 with radius 0.34 -> touches y = 0)
    const wheelsGroup = createPartGroup(wheelsMeta, [0, 0.34, 0]);
    const tyreGeom = trackGeo(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 28));
    tyreGeom.rotateZ(Math.PI / 2);
    const hubGeom = trackGeo(new THREE.CylinderGeometry(0.18, 0.18, 0.28, 16));
    hubGeom.rotateZ(Math.PI / 2);

    const wheelOffsets: [number, number, number][] = [
      [-0.95, 0, -0.92],
      [0.95, 0, -0.92],
      [-0.98, 0, 0],
      [0.98, 0, 0],
      [-0.95, 0, 0.92],
      [0.95, 0, 0.92],
    ];
    const wheelMeshes: THREE.Group[] = [];
    for (const [wx, wy, wz] of wheelOffsets) {
      const wg = new THREE.Group();
      wg.position.set(wx, wy, wz);
      const tMesh = new THREE.Mesh(tyreGeom, materials.matteComposite);
      const hMesh = new THREE.Mesh(hubGeom, materials.accentMetal);
      registerPartMesh(tMesh, wheelsMeta);
      registerPartMesh(hMesh, wheelsMeta);
      wg.add(tMesh, hMesh);
      wheelsGroup.add(wg);
      wheelMeshes.push(wg);
    }

    // 4. Pressurized Optical Canopy
    const canopyGroup = createPartGroup(canopyMeta, [0, 1.12, 0.48]);
    const canopyGeom = trackGeo(new THREE.SphereGeometry(0.56, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.52));
    canopyGeom.scale(1.15, 0.72, 1.35);
    const canopyMesh = new THREE.Mesh(canopyGeom, materials.opticalGlass);
    canopyMesh.renderOrder = 10;
    registerPartMesh(canopyMesh, canopyMeta, false, false);
    canopyGroup.add(canopyMesh);

    // 5. Gimbal LiDAR Mast
    const lidarGroup = createPartGroup(lidarMeta, [0, 1.38, -0.35]);
    const mastGeom = trackGeo(new THREE.CylinderGeometry(0.06, 0.08, 0.58, 16));
    const mastMesh = new THREE.Mesh(mastGeom, materials.secondaryMetal);
    const scannerHeadGeom = trackGeo(createBeveledBoxGeometry(0.42, 0.18, 0.24, 0.04));
    const scannerHead = new THREE.Mesh(scannerHeadGeom, materials.accentMetal);
    scannerHead.position.y = 0.32;
    registerPartMesh(mastMesh, lidarMeta);
    registerPartMesh(scannerHead, lidarMeta);
    lidarGroup.add(mastMesh, scannerHead);

    // 6. Deployable Photovoltaic Wings
    const wingsGroup = createPartGroup(wingsMeta, [0, 0.96, -0.45]);
    const wingGeom = trackGeo(createBeveledBoxGeometry(1.15, 0.04, 0.78, 0.03));
    const leftWing = new THREE.Mesh(wingGeom, materials.dialSurface);
    leftWing.position.set(-1.25, 0.05, 0);
    leftWing.rotation.z = 0.08;
    const rightWing = new THREE.Mesh(wingGeom, materials.dialSurface);
    rightWing.position.set(1.25, 0.05, 0);
    rightWing.rotation.z = -0.08;
    registerPartMesh(leftWing, wingsMeta);
    registerPartMesh(rightWing, wingsMeta);
    wingsGroup.add(leftWing, rightWing);

    // 7. Finned RTG Thermal Core
    const rtgGroup = createPartGroup(rtgMeta, [0, 0.84, -1.28]);
    const rtgCoreGeom = trackGeo(new THREE.CylinderGeometry(0.22, 0.24, 0.55, 20));
    rtgCoreGeom.rotateX(Math.PI / 2);
    const rtgMesh = new THREE.Mesh(rtgCoreGeom, materials.satinChassis);
    registerPartMesh(rtgMesh, rtgMeta);
    rtgGroup.add(rtgMesh);

    // 8. Twin LED Headlight Array
    const lightsGroup = createPartGroup(lightsMeta, [0, 0.76, 1.2]);
    const barGeom = trackGeo(createBeveledBoxGeometry(1.1, 0.12, 0.1, 0.03));
    const barMesh = new THREE.Mesh(barGeom, materials.emissiveAccent);
    registerPartMesh(barMesh, lightsMeta);
    lightsGroup.add(barMesh);

    dynamicHook = (elapsedSec) => {
      scannerHead.rotation.y = Math.sin(elapsedSec * 1.4) * 0.85;
      for (const wg of wheelMeshes) {
        wg.rotation.x = elapsedSec * 0.9;
      }
    };
  } else if (preset === 'robot_mech') {
    const [
      thoraxMeta,
      helmMeta,
      visorMeta,
      pauldronMeta,
      armsMeta,
      reactorMeta,
      pelvisMeta,
      legsMeta,
    ] = catalog.parts;

    // 1. Thorax Core
    const thoraxGroup = createPartGroup(thoraxMeta, [0, 1.52, 0]);
    const thoraxGeom = trackGeo(createBeveledBoxGeometry(1.18, 0.95, 0.74, 0.14));
    const thoraxMesh = new THREE.Mesh(thoraxGeom, materials.primaryMetal);
    registerPartMesh(thoraxMesh, thoraxMeta);
    thoraxGroup.add(thoraxMesh);

    // 2. Cranial Sensor Unit
    const helmGroup = createPartGroup(helmMeta, [0, 2.26, 0]);
    const helmGeom = trackGeo(createBeveledBoxGeometry(0.58, 0.48, 0.62, 0.14));
    const helmMesh = new THREE.Mesh(helmGeom, materials.secondaryMetal);
    registerPartMesh(helmMesh, helmMeta);
    helmGroup.add(helmMesh);

    // 3. Curved Optical Visor
    const visorGroup = createPartGroup(visorMeta, [0, 2.26, 0.28]);
    const visorGeom = trackGeo(createBeveledBoxGeometry(0.52, 0.2, 0.14, 0.05));
    const visorMesh = new THREE.Mesh(visorGeom, materials.opticalGlass);
    visorMesh.renderOrder = 10;
    const reticleGeom = trackGeo(createBeveledBoxGeometry(0.38, 0.05, 0.06, 0.01));
    const reticleMesh = new THREE.Mesh(reticleGeom, materials.emissiveAccent);
    registerPartMesh(visorMesh, visorMeta, false, false);
    registerPartMesh(reticleMesh, visorMeta);
    visorGroup.add(visorMesh, reticleMesh);

    // 4. Shoulder Pauldrons
    const pauldronGroup = createPartGroup(pauldronMeta, [0, 1.88, 0]);
    const pGeom = trackGeo(createBeveledBoxGeometry(0.46, 0.38, 0.66, 0.1));
    const pLeft = new THREE.Mesh(pGeom, materials.accentMetal);
    pLeft.position.set(-0.84, 0, 0);
    pLeft.rotation.z = 0.2;
    const pRight = new THREE.Mesh(pGeom, materials.accentMetal);
    pRight.position.set(0.84, 0, 0);
    pRight.rotation.z = -0.2;
    registerPartMesh(pLeft, pauldronMeta);
    registerPartMesh(pRight, pauldronMeta);
    pauldronGroup.add(pLeft, pRight);

    // 5. Articulated Forearms
    const armsGroup = createPartGroup(armsMeta, [0, 1.32, 0.1]);
    const armGeom = trackGeo(new THREE.CylinderGeometry(0.14, 0.12, 0.86, 20));
    const armLeft = new THREE.Mesh(armGeom, materials.matteComposite);
    armLeft.position.set(-0.88, 0, 0);
    const armRight = new THREE.Mesh(armGeom, materials.matteComposite);
    armRight.position.set(0.88, 0, 0);
    registerPartMesh(armLeft, armsMeta);
    registerPartMesh(armRight, armsMeta);
    armsGroup.add(armLeft, armRight);

    // 6. Toroidal Chest Reactor Core
    const reactorGroup = createPartGroup(reactorMeta, [0, 1.56, 0.39]);
    const reactorRingGeom = trackGeo(new THREE.TorusGeometry(0.22, 0.045, 16, 36));
    const reactorRing = new THREE.Mesh(reactorRingGeom, materials.accentMetal);
    const coreGemGeom = trackGeo(new THREE.OctahedronGeometry(0.14, 1));
    const coreGem = new THREE.Mesh(coreGemGeom, materials.emissiveAccent);
    registerPartMesh(reactorRing, reactorMeta);
    registerPartMesh(coreGem, reactorMeta);
    reactorGroup.add(reactorRing, coreGem);

    // 7. Pelvic Gyroscope
    const pelvisGroup = createPartGroup(pelvisMeta, [0, 0.92, 0]);
    const pelvisGeom = trackGeo(createBeveledBoxGeometry(0.86, 0.28, 0.56, 0.08));
    const pelvisMesh = new THREE.Mesh(pelvisGeom, materials.satinChassis);
    registerPartMesh(pelvisMesh, pelvisMeta);
    pelvisGroup.add(pelvisMesh);

    // 8. Bipedal Hydraulic Legs & Grounded Footpads (foot bottom at y = 0)
    const legsGroup = createPartGroup(legsMeta, [0, 0.42, 0]);
    const legStrutGeom = trackGeo(new THREE.CylinderGeometry(0.16, 0.13, 0.74, 20));
    const footGeom = trackGeo(createBeveledBoxGeometry(0.36, 0.12, 0.58, 0.04));

    const leftLeg = new THREE.Mesh(legStrutGeom, materials.secondaryMetal);
    leftLeg.position.set(-0.34, 0.04, 0);
    const rightLeg = new THREE.Mesh(legStrutGeom, materials.secondaryMetal);
    rightLeg.position.set(0.34, 0.04, 0);

    const leftFoot = new THREE.Mesh(footGeom, materials.primaryMetal);
    leftFoot.position.set(-0.34, -0.36, 0.08);
    const rightFoot = new THREE.Mesh(footGeom, materials.primaryMetal);
    rightFoot.position.set(0.34, -0.36, 0.08);

    registerPartMesh(leftLeg, legsMeta);
    registerPartMesh(rightLeg, legsMeta);
    registerPartMesh(leftFoot, legsMeta);
    registerPartMesh(rightFoot, legsMeta);
    legsGroup.add(leftLeg, rightLeg, leftFoot, rightFoot);

    dynamicHook = (elapsedSec) => {
      coreGem.rotation.z = elapsedSec * 1.6;
      helmGroup.rotation.y = Math.sin(elapsedSec * 0.9) * 0.18;
      visorGroup.rotation.y = helmGroup.rotation.y;
    };
  } else if (preset === 'architectural_pavilion') {
    const [
      plinthMeta,
      columnsMeta,
      glazingMeta,
      roofMeta,
      poolMeta,
      monolithMeta,
      lanternsMeta,
    ] = catalog.parts;

    // 1. Stepped Travertine Cantilever Plinth (bottom at y = 0)
    const plinthGroup = createPartGroup(plinthMeta, [0, 0.14, 0]);
    const lowerPlinthGeom = trackGeo(createBeveledBoxGeometry(4.2, 0.16, 3.2, 0.06));
    const upperPlinthGeom = trackGeo(createBeveledBoxGeometry(3.4, 0.14, 2.5, 0.05));
    const lowerPlinth = new THREE.Mesh(lowerPlinthGeom, materials.satinChassis);
    lowerPlinth.position.y = -0.06;
    const upperPlinth = new THREE.Mesh(upperPlinthGeom, materials.primaryMetal);
    upperPlinth.position.set(-0.28, 0.08, 0);
    registerPartMesh(lowerPlinth, plinthMeta);
    registerPartMesh(upperPlinth, plinthMeta);
    plinthGroup.add(lowerPlinth, upperPlinth);

    // 2. Cruciform Brushed Steel Columns
    const colGroup = createPartGroup(columnsMeta, [0, 0.92, 0]);
    const colGeom = trackGeo(new THREE.CylinderGeometry(0.065, 0.065, 1.35, 16));
    const colPositions: [number, number][] = [
      [-1.55, -0.92],
      [-0.15, -0.92],
      [1.15, -0.92],
      [-1.55, 0.92],
      [-0.15, 0.92],
      [1.15, 0.92],
    ];
    for (const [cx, cz] of colPositions) {
      const col = new THREE.Mesh(colGeom, materials.secondaryMetal);
      col.position.set(cx, 0, cz);
      registerPartMesh(col, columnsMeta);
      colGroup.add(col);
    }

    // 3. Double-Height Architectural Glass Walls
    const glazingGroup = createPartGroup(glazingMeta, [-0.25, 0.92, 0]);
    const glassWallLongGeom = trackGeo(new THREE.BoxGeometry(2.4, 1.3, 0.05));
    const glassWallShortGeom = trackGeo(new THREE.BoxGeometry(0.05, 1.3, 1.65));
    const wallNorth = new THREE.Mesh(glassWallLongGeom, materials.opticalGlass);
    wallNorth.position.set(0, 0, -0.82);
    wallNorth.renderOrder = 9;
    const wallSouth = new THREE.Mesh(glassWallLongGeom, materials.opticalGlass);
    wallSouth.position.set(0, 0, 0.82);
    wallSouth.renderOrder = 9;
    const wallWest = new THREE.Mesh(glassWallShortGeom, materials.opticalGlass);
    wallWest.position.set(-1.2, 0, 0);
    wallWest.renderOrder = 9;
    registerPartMesh(wallNorth, glazingMeta, false, false);
    registerPartMesh(wallSouth, glazingMeta, false, false);
    registerPartMesh(wallWest, glazingMeta, false, false);
    glazingGroup.add(wallNorth, wallSouth, wallWest);

    // 4. Parametric Louvered Cantilever Roof
    const roofGroup = createPartGroup(roofMeta, [-0.1, 1.66, 0]);
    const roofSlabGeom = trackGeo(createBeveledBoxGeometry(3.85, 0.14, 2.65, 0.05));
    const roofSlab = new THREE.Mesh(roofSlabGeom, materials.primaryMetal);
    registerPartMesh(roofSlab, roofMeta);
    roofGroup.add(roofSlab);

    // 5. Reflecting Pool (offset by >= 0.02 on Y to prevent coplanar Z-fighting)
    const poolGroup = createPartGroup(poolMeta, [1.22, 0.25, 0.35]);
    const poolGeom = trackGeo(new THREE.PlaneGeometry(1.35, 1.65, 24, 24));
    poolGeom.rotateX(-Math.PI / 2);
    const poolMesh = new THREE.Mesh(poolGeom, materials.rippleWater);
    registerPartMesh(poolMesh, poolMeta, false, true);
    poolGroup.add(poolMesh);

    // 6. Courtyard Bronze Sculpture
    const monolithGroup = createPartGroup(monolithMeta, [1.22, 0.72, -0.35]);
    const knotGeom = trackGeo(new THREE.TorusKnotGeometry(0.24, 0.065, 64, 16));
    const knotMesh = new THREE.Mesh(knotGeom, materials.accentMetal);
    registerPartMesh(knotMesh, monolithMeta);
    monolithGroup.add(knotMesh);

    // 7. Architectural Bollard Luminaires
    const lanternGroup = createPartGroup(lanternsMeta, [0, 0.36, 0]);
    const bollardGeom = trackGeo(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 12));
    const bollardCoords: [number, number][] = [
      [-1.85, 1.25],
      [0.2, 1.25],
      [1.85, 1.25],
      [1.85, -1.25],
    ];
    for (const [bx, bz] of bollardCoords) {
      const bMesh = new THREE.Mesh(bollardGeom, materials.emissiveAccent);
      bMesh.position.set(bx, 0, bz);
      registerPartMesh(bMesh, lanternsMeta);
      lanternGroup.add(bMesh);
    }

    dynamicHook = (elapsedSec) => {
      knotMesh.rotation.y = elapsedSec * 0.45;
    };
  } else if (preset === 'quantum_gyroscope') {
    const [
      pedestalMeta,
      outerMeta,
      middleMeta,
      innerMeta,
      coreMeta,
      coilsMeta,
    ] = catalog.parts;

    // 1. Turned Lathe Meridian Pedestal (grounded at y = 0)
    const pedestalGroup = createPartGroup(pedestalMeta, [0, 0.24, 0]);
    const pedPoints = [
      new THREE.Vector2(0, -0.24),
      new THREE.Vector2(1.15, -0.24),
      new THREE.Vector2(0.95, -0.1),
      new THREE.Vector2(0.42, 0.05),
      new THREE.Vector2(0.32, 0.24),
      new THREE.Vector2(0, 0.24),
    ];
    const pedGeom = trackGeo(new THREE.LatheGeometry(pedPoints, 48));
    const pedMesh = new THREE.Mesh(pedGeom, materials.satinChassis);
    registerPartMesh(pedMesh, pedestalMeta);
    pedestalGroup.add(pedMesh);

    // 2. Outer Meridian Ring
    const outerGroup = createPartGroup(outerMeta, [0, 1.58, 0]);
    const outerGeom = trackGeo(new THREE.TorusGeometry(1.32, 0.075, 24, 72));
    const outerMesh = new THREE.Mesh(outerGeom, materials.primaryMetal);
    registerPartMesh(outerMesh, outerMeta);
    outerGroup.add(outerMesh);

    // 3. Equatorial Gimbal Ring
    const middleGroup = createPartGroup(middleMeta, [0, 1.58, 0]);
    const middleGeom = trackGeo(new THREE.TorusGeometry(1.04, 0.065, 24, 64));
    const middleMesh = new THREE.Mesh(middleGeom, materials.secondaryMetal);
    registerPartMesh(middleMesh, middleMeta);
    middleGroup.add(middleMesh);

    // 4. High-Velocity Inner Azimuth Ring
    const innerGroup = createPartGroup(innerMeta, [0, 1.58, 0]);
    const innerGeom = trackGeo(new THREE.TorusGeometry(0.76, 0.055, 20, 56));
    const innerMesh = new THREE.Mesh(innerGeom, materials.accentMetal);
    registerPartMesh(innerMesh, innerMeta);
    innerGroup.add(innerMesh);

    // 5. Refractive Diamond Singularity Core
    const coreGroup = createPartGroup(coreMeta, [0, 1.58, 0]);
    const crystalCoreGeom = trackGeo(new THREE.IcosahedronGeometry(0.38, 0));
    const crystalCoreMesh = new THREE.Mesh(crystalCoreGeom, materials.opticalGlass);
    crystalCoreMesh.renderOrder = 10;
    const innerSparkGeom = trackGeo(new THREE.OctahedronGeometry(0.18, 0));
    const innerSparkMesh = new THREE.Mesh(innerSparkGeom, materials.emissiveAccent);
    registerPartMesh(crystalCoreMesh, coreMeta, false, false);
    registerPartMesh(innerSparkMesh, coreMeta);
    coreGroup.add(crystalCoreMesh, innerSparkMesh);

    // 6. Toroidal Copper Field Stabilizer Coils
    const coilsGroup = createPartGroup(coilsMeta, [0, 1.58, 0]);
    const coilGeom = trackGeo(new THREE.CylinderGeometry(0.12, 0.12, 0.24, 20));
    coilGeom.rotateZ(Math.PI / 2);
    const coilLeft = new THREE.Mesh(coilGeom, materials.accentMetal);
    coilLeft.position.set(-1.34, 0, 0);
    const coilRight = new THREE.Mesh(coilGeom, materials.accentMetal);
    coilRight.position.set(1.34, 0, 0);
    registerPartMesh(coilLeft, coilsMeta);
    registerPartMesh(coilRight, coilsMeta);
    coilsGroup.add(coilLeft, coilRight);

    dynamicHook = (elapsedSec) => {
      outerMesh.rotation.y = elapsedSec * 0.45;
      middleMesh.rotation.x = elapsedSec * 0.75;
      middleMesh.rotation.y = elapsedSec * 0.35;
      innerMesh.rotation.z = elapsedSec * 1.15;
      innerMesh.rotation.x = -elapsedSec * 0.55;
      crystalCoreMesh.rotation.y = -elapsedSec * 0.9;
      innerSparkMesh.rotation.x = elapsedSec * 1.8;
    };
  } else {
    // alpine_sanctuary (Natural outdoor perimeter with InstancedMesh pine forest & rock outcrops)
    const [
      terrainMeta,
      foundationMeta,
      rotundaMeta,
      domeMeta,
      apertureMeta,
      forestMeta,
    ] = catalog.parts;

    // 1. Layered Relief Terrain (natural outdoor perimeter without artificial indoor walls)
    const terrainGroup = createPartGroup(terrainMeta, [0, 0, 0]);
    const terrainGeom = trackGeo(new THREE.CylinderGeometry(3.4, 3.7, 0.24, 48, 4));
    const posAttr = terrainGeom.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      if (vy > 0) {
        posAttr.setY(i, groundHeightAt(vx, vz));
      } else {
        posAttr.setY(i, 0);
      }
    }
    terrainGeom.computeVertexNormals();
    const terrainMesh = new THREE.Mesh(terrainGeom, materials.matteComposite);
    registerPartMesh(terrainMesh, terrainMeta, false, true);
    terrainGroup.add(terrainMesh);

    // 2. Octagonal Granite Observatory Pier
    const foundationGroup = createPartGroup(foundationMeta, [0, 0.28, 0]);
    const pierGeom = trackGeo(new THREE.CylinderGeometry(0.92, 1.04, 0.34, 8));
    const pierMesh = new THREE.Mesh(pierGeom, materials.satinChassis);
    registerPartMesh(pierMesh, foundationMeta);
    foundationGroup.add(pierMesh);

    // 3. Brushed Alloy Telescope Rotunda
    const rotundaGroup = createPartGroup(rotundaMeta, [0, 0.72, 0]);
    const rotundaGeom = trackGeo(new THREE.CylinderGeometry(0.84, 0.88, 0.56, 32));
    const rotundaMesh = new THREE.Mesh(rotundaGeom, materials.primaryMetal);
    registerPartMesh(rotundaMesh, rotundaMeta);
    rotundaGroup.add(rotundaMesh);

    // 4. Faceted Geodesic Glass Canopy Dome
    const domeGroup = createPartGroup(domeMeta, [0, 1.0, 0]);
    const domeGeom = trackGeo(
      new THREE.IcosahedronGeometry(0.84, 1)
    );
    const domeMesh = new THREE.Mesh(domeGeom, materials.opticalGlass);
    domeMesh.renderOrder = 10;
    registerPartMesh(domeMesh, domeMeta, false, false);
    domeGroup.add(domeMesh);

    // 5. Cassegrain Telescope Aperture Tube
    const apertureGroup = createPartGroup(apertureMeta, [0, 1.05, 0]);
    const tubeGeom = trackGeo(new THREE.CylinderGeometry(0.18, 0.22, 0.95, 24));
    tubeGeom.rotateX(Math.PI / 3.4);
    const tubeMesh = new THREE.Mesh(tubeGeom, materials.accentMetal);
    tubeMesh.position.set(0, 0.15, 0.25);
    registerPartMesh(tubeMesh, apertureMeta);
    apertureGroup.add(tubeMesh);

    // 6. Instanced Alpine Pine Forest & Perimeter Boulders (> 20 instances with ±15% scale & tint variation)
    const forestGroup = createPartGroup(forestMeta, [0, 0, 0]);
    const treeCount = 28;
    const canopyConeGeom = trackGeo(new THREE.ConeGeometry(0.22, 0.62, 7));
    canopyConeGeom.translate(0, 0.42, 0);
    const trunkCylGeom = trackGeo(new THREE.CylinderGeometry(0.045, 0.065, 0.24, 7));
    trunkCylGeom.translate(0, 0.12, 0);

    const foliageMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#2d5a42'),
      roughness: 0.76,
      metalness: 0.05,
    });
    const trunkMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#4a3525'),
      roughness: 0.85,
      metalness: 0.04,
    });

    const foliageInstanced = new THREE.InstancedMesh(canopyConeGeom, foliageMat, treeCount);
    const trunkInstanced = new THREE.InstancedMesh(trunkCylGeom, trunkMat, treeCount);

    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2 + (i % 3) * 0.14;
      const radius = 1.65 + (i % 4) * 0.36;
      const tx = Math.cos(angle) * radius;
      const tz = Math.sin(angle) * radius;
      const ty = groundHeightAt(tx, tz);

      // Deterministic ±15% scale variation
      const scaleFactor = 0.85 + ((i * 37) % 31) / 100;
      _dummy.position.set(tx, ty, tz);
      _dummy.rotation.set(0, angle * 1.7, 0);
      _dummy.scale.setScalar(scaleFactor);
      _dummy.updateMatrix();

      foliageInstanced.setMatrixAt(i, _dummy.matrix);
      trunkInstanced.setMatrixAt(i, _dummy.matrix);

      // Per-instance tint variation via setColorAt
      _color.setHSL(0.38 + ((i % 5) - 2) * 0.015, 0.42, 0.26 + (i % 3) * 0.04);
      foliageInstanced.setColorAt(i, _color);
    }

    foliageInstanced.instanceMatrix.needsUpdate = true;
    if (foliageInstanced.instanceColor) foliageInstanced.instanceColor.needsUpdate = true;
    foliageInstanced.computeBoundingSphere();

    trunkInstanced.instanceMatrix.needsUpdate = true;
    trunkInstanced.computeBoundingSphere();

    registerPartMesh(foliageInstanced, forestMeta);
    registerPartMesh(trunkInstanced, forestMeta);
    forestGroup.add(foliageInstanced, trunkInstanced);

    dynamicHook = (elapsedSec) => {
      apertureGroup.rotation.y = Math.sin(elapsedSec * 0.4) * 0.65;
    };
  }

  const applyExplodedFactor = (currentFactor: number) => {
    for (const part of parts) {
      _vec3
        .copy(part.basePosition)
        .addScaledVector(part.explodeOffset, currentFactor);
      part.group.position.copy(_vec3);
    }
  };

  return {
    root,
    parts,
    geometries,
    animate: (elapsedSec: number, deltaSec: number) => {
      dynamicHook(elapsedSec, deltaSec);
    },
    applyExplodedFactor,
    dispose: () => {
      for (const geom of geometries) {
        geom.dispose();
      }
    },
  };
}
