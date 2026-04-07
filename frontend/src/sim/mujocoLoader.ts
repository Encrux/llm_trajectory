// Load MuJoCo WASM and scene model with all mesh dependencies

export interface MujocoState {
  mj: any;
  model: any;
  data: any;
}

const MUJOCO_BASE_PATH = "/mujoco/";

// Singleton: only load once
let loadPromise: Promise<MujocoState> | null = null;

export function loadMujoco(): Promise<MujocoState> {
  if (!loadPromise) {
    loadPromise = doLoad();
  }
  return loadPromise;
}

async function doLoad(): Promise<MujocoState> {
  // Phase 1: Start WASM init + both XML fetches in parallel
  const [mj, pandaXml, sceneXml] = await Promise.all([
    initWasm(),
    fetchText(`${MUJOCO_BASE_PATH}franka_emika_panda/panda.xml`),
    fetchText(`${MUJOCO_BASE_PATH}scene.xml`),
  ]);

  // Phase 2: Fetch all 67 mesh files in parallel (needs mj for VFS, pandaXml for file list)
  await loadMeshes(mj, pandaXml);

  // Phase 3: Merge XMLs, load model
  const mergedXml = buildMergedScene(pandaXml, sceneXml);
  mkdirRecursive(mj, "/working/franka_emika_panda");
  mj.FS.writeFile("/working/scene.xml", mergedXml);
  mj.FS.writeFile("/working/franka_emika_panda/panda.xml", pandaXml);

  const model = mj.MjModel.loadFromXML("/working/scene.xml");
  const data = new mj.MjData(model);

  // Apply home keyframe to arm joints only (first 9 qpos: 7 arm + 2 finger)
  if (model.nkey > 0) {
    const ARM_NQ = 9;
    for (let i = 0; i < ARM_NQ; i++) data.qpos[i] = model.key_qpos[i];
    for (let i = 0; i < model.nu; i++) data.ctrl[i] = model.key_ctrl[i];
  }

  mj.mj_forward(model, data);

  // Init mocap to hand position
  const handId = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, "hand");
  if (handId >= 0 && data.mocap_pos.length >= 3) {
    data.mocap_pos[0] = data.xpos[handId * 3 + 0];
    data.mocap_pos[1] = data.xpos[handId * 3 + 1];
    data.mocap_pos[2] = data.xpos[handId * 3 + 2];
    if (data.mocap_quat.length >= 4) {
      data.mocap_quat[0] = data.xquat[handId * 4 + 0];
      data.mocap_quat[1] = data.xquat[handId * 4 + 1];
      data.mocap_quat[2] = data.xquat[handId * 4 + 2];
      data.mocap_quat[3] = data.xquat[handId * 4 + 3];
    }
  }

  return { mj, model, data };
}

async function initWasm(): Promise<any> {
  const loadModule = (await import(/* @vite-ignore */ "/vendor/mujoco/mujoco_wasm.js")).default;
  return await loadModule();
}

async function loadMeshes(mj: any, pandaXml: string): Promise<void> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(pandaXml, "text/xml");
  const meshdir = doc.querySelector("compiler")?.getAttribute("meshdir") || "assets";

  const meshFiles = new Set<string>();
  for (const mesh of doc.querySelectorAll("mesh[file]")) {
    const file = mesh.getAttribute("file");
    if (file) meshFiles.add(file);
  }

  const meshBasePath = `${MUJOCO_BASE_PATH}franka_emika_panda/${meshdir}/`;
  const vfsMeshDir = `/working/franka_emika_panda/${meshdir}`;
  mkdirRecursive(mj, "/working/franka_emika_panda");
  mkdirRecursive(mj, vfsMeshDir);

  await Promise.all([...meshFiles].map(async (meshFile) => {
    try {
      const response = await fetch(meshBasePath + meshFile);
      if (!response.ok) return;
      const buffer = await response.arrayBuffer();
      mj.FS.writeFile(`${vfsMeshDir}/${meshFile}`, new Uint8Array(buffer));
    } catch {
      // skip failed meshes
    }
  }));
}

function buildMergedScene(pandaXml: string, sceneXml: string): string {
  const pandaInner = pandaXml
    .replace(/<mujoco[^>]*>/, "")
    .replace(/<\/mujoco>/, "")
    .replace('meshdir="assets"', 'meshdir="franka_emika_panda/assets"')
    // Boost gripper 4x
    .replace('forcerange="-100 100" ctrlrange="0 255"', 'forcerange="-400 400" ctrlrange="0 255"')
    .replace('gainprm="0.01568627451 0 0" biasprm="0 -100 -10"', 'gainprm="0.06274509804 0 0" biasprm="0 -400 -40"')
    .trim();

  return sceneXml.replace(
    /<include\s+file="franka_emika_panda\/panda.xml"\s*\/>/,
    pandaInner,
  );
}

function mkdirRecursive(mj: any, path: string): void {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try { mj.FS.mkdir(current); } catch { /* exists */ }
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}
