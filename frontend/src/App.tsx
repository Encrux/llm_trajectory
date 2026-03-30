import { useEffect, useRef, useState } from "react";
import { loadMujoco, type MujocoState } from "./sim/mujocoLoader";
import { initRenderer, render as renderThree, handleResize, type RendererState } from "./sim/threeRenderer";
import { buildVisuals, syncVisuals, type VisualizerState } from "./sim/mujocoVisualizer";
import { extractScene } from "./sim/sceneExtractor";
import type { Scene } from "./core/scene";

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);

  const mujocoRef = useRef<MujocoState | null>(null);
  const rendererRef = useRef<RendererState | null>(null);
  const vizRef = useRef<VisualizerState | null>(null);

  useEffect(() => {
    let mounted = true;
    let frameId: number;

    async function init() {
      try {
        console.log("[init] Loading MuJoCo WASM...");
        const mState = await loadMujoco();
        if (!mounted) return;
        mujocoRef.current = mState;
        console.log("[init] MuJoCo loaded. nbody:", mState.model.nbody, "ngeom:", mState.model.ngeom);

        const rState = initRenderer(canvasRef.current!);
        rendererRef.current = rState;
        console.log("[init] Three.js renderer initialized");

        const vState = buildVisuals(mState, rState);
        vizRef.current = vState;
        console.log("[init] Built", vState.geomMeshes.length, "visual meshes");

        const extractedScene = extractScene(mState);
        setScene(extractedScene);
        console.log("[init] Scene extracted:", extractedScene.objectNames());
        setLoading(false);

        function animate() {
          if (!mounted) return;
          syncVisuals(mujocoRef.current!, vizRef.current!);
          renderThree(rendererRef.current!);
          frameId = requestAnimationFrame(animate);
        }
        animate();
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    }

    init();
    return () => {
      mounted = false;
      cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    function onResize() {
      if (!canvasRef.current || !rendererRef.current) return;
      const parent = canvasRef.current.parentElement;
      if (!parent) return;
      handleResize(rendererRef.current, parent.clientWidth, parent.clientHeight);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
      {loading && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", color: "#333", fontSize: "1.2rem" }}>
          Loading MuJoCo...
        </div>
      )}
      {error && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", color: "red", fontSize: "1rem", maxWidth: "80%" }}>
          Error: {error}
        </div>
      )}
      {scene && !loading && (
        <div style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,0.9)", padding: "12px 16px", borderRadius: 8, fontSize: "0.85rem" }}>
          <strong>Scene Objects</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>
            {scene.objects.map((o) => (
              <li key={o.name}>
                {o.name} ({o.position.x.toFixed(2)}, {o.position.y.toFixed(2)}, {o.position.z.toFixed(2)})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;
