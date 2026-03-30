import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface RendererState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
}

export function initRenderer(canvas: HTMLCanvasElement): RendererState {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  const camera = new THREE.PerspectiveCamera(
    45,
    canvas.clientWidth / canvas.clientHeight,
    0.01,
    100,
  );
  camera.position.set(1.2, -1.2, 1.2);
  camera.up.set(0, 0, 1); // MuJoCo is Z-up
  camera.lookAt(0.4, 0, 0.3);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.shadowMap.enabled = true;

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(2, -2, 3);
  directional.castShadow = true;
  scene.add(directional);

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
