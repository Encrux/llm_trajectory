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
  console.log("[mujoco] Importing WASM module...");
  const loadModule = (await import(/* @vite-ignore */ "/vendor/mujoco/mujoco_wasm.js")).default;
  console.log("[mujoco] Initializing WASM...");
  const mj = await loadModule();
  console.log("[mujoco] WASM ready");

  // Load panda.xml and its meshes into the VFS
  await loadPandaModel(mj);

  // Merge scene XML with panda XML (avoid broken <include> in WASM)
  const mergedXml = await buildMergedScene();
  mkdirRecursive(mj, "/working");
  mj.FS.writeFile("/working/scene.xml", mergedXml);
  console.log("[mujoco] Merged scene XML written");

  // Load model
  const model = mj.MjModel.loadFromXML("/working/scene.xml");
  const data = new mj.MjData(model);

  // Apply home keyframe to arm joints only (first 9 qpos: 7 arm + 2 finger)
  // Don't overwrite free-joint qpos (object positions) which come after
  if (model.nkey > 0) {
    const ARM_NQ = 9; // 7 arm joints + 2 finger slide joints
    const keyQpos = model.key_qpos;
    for (let i = 0; i < ARM_NQ; i++) {
      data.qpos[i] = keyQpos[i];
    }
    const nu = model.nu;
    const keyCtrl = model.key_ctrl;
    for (let i = 0; i < nu; i++) {
      data.ctrl[i] = keyCtrl[i];
    }
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

  console.log("[mujoco] Ready");

  return { mj, model, data };
}

async function loadPandaModel(mj: any): Promise<void> {
  // Fetch panda.xml
  const pandaUrl = `${MUJOCO_BASE_PATH}franka_emika_panda/panda.xml`;
  const pandaXml = await fetchText(pandaUrl);

  mkdirRecursive(mj, "/working/franka_emika_panda");
  mj.FS.writeFile("/working/franka_emika_panda/panda.xml", pandaXml);

  // Parse for mesh references
  const parser = new DOMParser();
  const doc = parser.parseFromString(pandaXml, "text/xml");
  const compiler = doc.querySelector("compiler");
  const meshdir = compiler?.getAttribute("meshdir") || "assets";

  const meshes = doc.querySelectorAll("mesh[file]");
  const meshFiles = new Set<string>();
  for (const mesh of meshes) {
    const file = mesh.getAttribute("file");
    if (file) meshFiles.add(file);
  }

  // Fetch all mesh files in parallel
  const meshBasePath = `${MUJOCO_BASE_PATH}franka_emika_panda/${meshdir}/`;
  const vfsMeshDir = `/working/franka_emika_panda/${meshdir}`;
  mkdirRecursive(mj, vfsMeshDir);

  console.log(`[mujoco] Fetching ${meshFiles.size} mesh files...`);

  const promises = [...meshFiles].map(async (meshFile) => {
    try {
      const response = await fetch(meshBasePath + meshFile);
      if (!response.ok) {
        console.warn(`[mujoco] Failed to fetch mesh: ${meshFile} (${response.status})`);
        return;
      }
      const buffer = await response.arrayBuffer();
      mj.FS.writeFile(`${vfsMeshDir}/${meshFile}`, new Uint8Array(buffer));
    } catch (e) {
      console.warn(`[mujoco] Error loading mesh ${meshFile}:`, e);
    }
  });

  await Promise.all(promises);
  console.log("[mujoco] Mesh files loaded");
}

async function buildMergedScene(): Promise<string> {
  // Fetch both XMLs
  const pandaXml = await fetchText(`${MUJOCO_BASE_PATH}franka_emika_panda/panda.xml`);
  const sceneXml = await fetchText(`${MUJOCO_BASE_PATH}scene.xml`);

  // Remove the <include> line and the <mujoco> wrapper from panda.xml,
  // then inject panda's content into scene.xml
  const pandaInner = pandaXml
    .replace(/<mujoco[^>]*>/, "")
    .replace(/<\/mujoco>/, "")
    // Fix meshdir: scene.xml is at /working/, meshes are at /working/franka_emika_panda/assets/
    .replace('meshdir="assets"', 'meshdir="franka_emika_panda/assets"')
    .trim();

  // Replace the <include> tag in scene.xml with the panda content
  const merged = sceneXml.replace(
    /<include\s+file="franka_emika_panda\/panda.xml"\s*\/>/,
    pandaInner,
  );

  return merged;
}

function mkdirRecursive(mj: any, path: string): void {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      mj.FS.mkdir(current);
    } catch {
      // already exists
    }
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}
