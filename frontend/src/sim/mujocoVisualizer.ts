import * as THREE from "three";
import type { MujocoState } from "./mujocoLoader";
import type { RendererState } from "./threeRenderer";

export interface VisualizerState {
  geomMeshes: THREE.Object3D[];
}

// MuJoCo geom type constants
const mjGEOM_PLANE = 0;
const mjGEOM_HFIELD = 1;
const mjGEOM_SPHERE = 2;
const mjGEOM_CAPSULE = 3;
const mjGEOM_ELLIPSOID = 4;
const mjGEOM_CYLINDER = 5;
const mjGEOM_BOX = 6;
const mjGEOM_MESH = 7;

export function buildVisuals(
  mujocoState: MujocoState,
  rendererState: RendererState,
): VisualizerState {
  const { model } = mujocoState;
  const meshes: THREE.Object3D[] = [];

  for (let geomId = 0; geomId < model.ngeom; geomId++) {
    const geomType = model.geom_type[geomId];

    // Skip floor plane (we render our own) and fully transparent geoms
    if (geomType === mjGEOM_PLANE || model.geom_rgba[geomId * 4 + 3] === 0) {
      meshes.push(new THREE.Object3D());
      continue;
    }

    const s0 = model.geom_size[geomId * 3 + 0];
    const s1 = model.geom_size[geomId * 3 + 1];
    const s2 = model.geom_size[geomId * 3 + 2];

    let geometry: THREE.BufferGeometry | null = null;

    switch (geomType) {
      case mjGEOM_SPHERE:
        geometry = new THREE.SphereGeometry(s0, 24, 24);
        break;
      case mjGEOM_BOX:
        geometry = new THREE.BoxGeometry(s0 * 2, s1 * 2, s2 * 2);
        break;
      case mjGEOM_CYLINDER:
        geometry = new THREE.CylinderGeometry(s0, s0, s1 * 2, 24);
        break;
      case mjGEOM_CAPSULE:
        geometry = new THREE.CapsuleGeometry(s0, s1 * 2, 8, 24);
        break;
      case mjGEOM_PLANE:
        geometry = null; // handled separately in threeRenderer
        break;
      case mjGEOM_MESH:
        geometry = buildMeshGeometry(model, model.geom_dataid[geomId]);
        break;
      case mjGEOM_ELLIPSOID:
        geometry = new THREE.SphereGeometry(1, 24, 24);
        geometry.scale(s0, s1, s2);
        break;
      default:
        geometry = new THREE.SphereGeometry(0.01, 8, 8);
    }

    if (!geometry) {
      meshes.push(new THREE.Object3D());
      continue;
    }

    // Cylinders and capsules need rotation: Three.js Y-axis aligned, MuJoCo Z-axis aligned
    if (geomType === mjGEOM_CYLINDER || geomType === mjGEOM_CAPSULE) {
      geometry.rotateX(Math.PI / 2);
    }

    // Skip invisible geoms (collision-only)
    const group = model.geom_group[geomId];
    if (group === 3) {
      meshes.push(new THREE.Object3D());
      continue;
    }

    // Use material color if assigned, otherwise geom rgba
    const matId = model.geom_matid[geomId];
    let r: number, g: number, b: number, a: number;
    let specular = 0.3;
    let shininess = 0.3;

    if (matId >= 0) {
      r = model.mat_rgba[matId * 4 + 0];
      g = model.mat_rgba[matId * 4 + 1];
      b = model.mat_rgba[matId * 4 + 2];
      a = model.mat_rgba[matId * 4 + 3];
      specular = model.mat_specular[matId];
      shininess = model.mat_shininess[matId];
    } else {
      r = model.geom_rgba[geomId * 4 + 0];
      g = model.geom_rgba[geomId * 4 + 1];
      b = model.geom_rgba[geomId * 4 + 2];
      a = model.geom_rgba[geomId * 4 + 3];
    }

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(r, g, b),
      metalness: specular * 0.5,
      roughness: 1.0 - shininess,
      transparent: a < 1,
      opacity: a,
      side: geomType === mjGEOM_PLANE ? THREE.DoubleSide : THREE.FrontSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = geomType !== mjGEOM_PLANE;
    mesh.receiveShadow = true;
    rendererState.scene.add(mesh);
    meshes.push(mesh);
  }

  return { geomMeshes: meshes };
}

export function syncVisuals(
  mujocoState: MujocoState,
  vizState: VisualizerState,
): void {
  const { data } = mujocoState;

  for (let geomId = 0; geomId < vizState.geomMeshes.length; geomId++) {
    const mesh = vizState.geomMeshes[geomId];
    if (!mesh.visible && !(mesh instanceof THREE.Mesh)) continue;

    // Position: geom_xpos (3 per geom)
    const px = data.geom_xpos[geomId * 3 + 0];
    const py = data.geom_xpos[geomId * 3 + 1];
    const pz = data.geom_xpos[geomId * 3 + 2];
    mesh.position.set(px, py, pz);

    // Rotation: geom_xmat (9 per geom, 3x3 row-major)
    // Three.js Matrix4.set() takes row-major args, same as MuJoCo
    const m = data.geom_xmat;
    const i = geomId * 9;
    const mat4 = new THREE.Matrix4();
    mat4.set(
      m[i + 0], m[i + 1], m[i + 2], px,
      m[i + 3], m[i + 4], m[i + 5], py,
      m[i + 6], m[i + 7], m[i + 8], pz,
      0, 0, 0, 1,
    );
    mesh.matrix.copy(mat4);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldNeedsUpdate = true;
  }
}

function buildMeshGeometry(
  model: any,
  meshId: number,
): THREE.BufferGeometry | null {
  if (meshId < 0) return null;

  const vertStart = model.mesh_vertadr[meshId];
  const vertCount = model.mesh_vertnum[meshId];
  const faceStart = model.mesh_faceadr[meshId];
  const faceCount = model.mesh_facenum[meshId];

  if (vertCount === 0 || faceCount === 0) return null;

  const positions = new Float32Array(vertCount * 3);
  for (let v = 0; v < vertCount; v++) {
    positions[v * 3 + 0] = model.mesh_vert[(vertStart + v) * 3 + 0];
    positions[v * 3 + 1] = model.mesh_vert[(vertStart + v) * 3 + 1];
    positions[v * 3 + 2] = model.mesh_vert[(vertStart + v) * 3 + 2];
  }

  const indices = new Uint32Array(faceCount * 3);
  for (let f = 0; f < faceCount; f++) {
    indices[f * 3 + 0] = model.mesh_face[(faceStart + f) * 3 + 0];
    indices[f * 3 + 1] = model.mesh_face[(faceStart + f) * 3 + 1];
    indices[f * 3 + 2] = model.mesh_face[(faceStart + f) * 3 + 2];
  }

  // Normals
  const normals = new Float32Array(vertCount * 3);
  const hasNormals = model.mesh_normal && model.mesh_normal.length > 0;
  if (hasNormals) {
    for (let v = 0; v < vertCount; v++) {
      normals[v * 3 + 0] = model.mesh_normal[(vertStart + v) * 3 + 0];
      normals[v * 3 + 1] = model.mesh_normal[(vertStart + v) * 3 + 1];
      normals[v * 3 + 2] = model.mesh_normal[(vertStart + v) * 3 + 2];
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  if (hasNormals) {
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  return geometry;
}
