import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface RendererState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
}

function createCheckerboardTexture(): THREE.CanvasTexture {
  const size = 512;
  const squares = 8;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const sqSize = size / squares;
  for (let i = 0; i < squares; i++) {
    for (let j = 0; j < squares; j++) {
      const dark = (i + j) % 2 === 0;
      ctx.fillStyle = dark ? "#2a3040" : "#323848";
      ctx.fillRect(i * sqSize, j * sqSize, sqSize, sqSize);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

export function initRenderer(canvas: HTMLCanvasElement): RendererState {
  const scene = new THREE.Scene();

  // Dark gradient background
  scene.background = new THREE.Color(0x1a1a2e);

  // Distance fog — fades objects into the background
  scene.fog = new THREE.Fog(0x1a1a2e, 2.5, 6.0);

  const camera = new THREE.PerspectiveCamera(
    45,
    canvas.clientWidth / canvas.clientHeight,
    0.01,
    100,
  );
  camera.position.set(1.2, -1.2, 1.2);
  camera.up.set(0, 0, 1);
  camera.lookAt(0.4, 0, 0.3);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  // Warm key light (main)
  const keyLight = new THREE.DirectionalLight(0xfff0e0, 1.0);
  keyLight.position.set(2, -1.5, 3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far = 10;
  keyLight.shadow.camera.left = -2;
  keyLight.shadow.camera.right = 2;
  keyLight.shadow.camera.top = 2;
  keyLight.shadow.camera.bottom = -2;
  keyLight.shadow.bias = 0;
  keyLight.shadow.normalBias = 0.04;
  scene.add(keyLight);

  // Cool fill light (opposite side, softer)
  const fillLight = new THREE.DirectionalLight(0xc0d0ff, 0.4);
  fillLight.position.set(-1.5, 2, 2);
  scene.add(fillLight);

  // Ambient — subtle, not flat
  const ambient = new THREE.AmbientLight(0x404060, 0.5);
  scene.add(ambient);

  // Hemisphere light — sky/ground gradient
  const hemi = new THREE.HemisphereLight(0x606080, 0x303040, 0.3);
  scene.add(hemi);

  // Checkerboard ground plane (replaces the MuJoCo floor geom visually)
  const groundGeo = new THREE.PlaneGeometry(10, 10);
  const groundMat = new THREE.MeshStandardMaterial({
    map: createCheckerboardTexture(),
    roughness: 0.85,
    metalness: 0.05,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.position.z = -0.001; // just below z=0 to avoid z-fighting with MuJoCo floor
  scene.add(ground);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0.4, 0, 0.3);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.update();

  return { scene, camera, renderer, controls };
}

export function handleResize(
  state: RendererState,
  width: number,
  height: number,
): void {
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(width, height);
}

export function render(state: RendererState): void {
  state.controls.update();
  state.renderer.render(state.scene, state.camera);
}
