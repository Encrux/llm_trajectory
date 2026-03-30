import { useCallback, useEffect, useRef, useState } from "react";
import { loadMujoco, type MujocoState } from "./sim/mujocoLoader";
import { initRenderer, render as renderThree, handleResize, type RendererState } from "./sim/threeRenderer";
import { buildVisuals, syncVisuals, type VisualizerState } from "./sim/mujocoVisualizer";
import { extractScene } from "./sim/sceneExtractor";
import { Animator, type AnimatorStatus } from "./sim/animator";
import { Scene } from "./core/scene";
import type { ApiConfig, ToolCall, Trajectory } from "./core/types";
import { buildPrompt } from "./core/prompt";
import { toOpenAITools } from "./core/primitives";
import { callLLM } from "./core/llmClient";
import { transpile } from "./core/transpiler";
import { loadConfig, saveConfig } from "./config";
import { ScenePanel } from "./components/ScenePanel";
import { TaskInput } from "./components/TaskInput";
import { PlanView } from "./components/PlanView";
import { ExecutionControls } from "./components/ExecutionControls";
import { ConfigDialog } from "./components/ConfigDialog";
import { StatusBar } from "./components/StatusBar";
import "./styles/index.css";

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Sim state (refs to avoid re-renders)
  const mujocoRef = useRef<MujocoState | null>(null);
  const rendererRef = useRef<RendererState | null>(null);
  const vizRef = useRef<VisualizerState | null>(null);
  const animatorRef = useRef<Animator | null>(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [plan, setPlan] = useState<ToolCall[] | null>(null);
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [animatorStatus, setAnimatorStatus] = useState<AnimatorStatus>("idle");
  const [currentStep, setCurrentStep] = useState(-1);
  const [config, setConfigState] = useState<ApiConfig>(loadConfig());
  const [showConfig, setShowConfig] = useState(false);

  // Init MuJoCo + Three.js
  useEffect(() => {
    let mounted = true;
    let frameId: number;

    async function init() {
      try {
        const mState = await loadMujoco();
        if (!mounted) return;
        mujocoRef.current = mState;

        const rState = initRenderer(canvasRef.current!);
        rendererRef.current = rState;

        const vState = buildVisuals(mState, rState);
        vizRef.current = vState;

        const extractedScene = extractScene(mState);
        setScene(extractedScene);

        // Create animator
        animatorRef.current = new Animator(mState, {
          onStepStart: (idx) => setCurrentStep(idx),
          onStepComplete: () => {},
          onStatusChange: (s) => setAnimatorStatus(s),
          onError: (e) => setError(e.message),
        });

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

  // Resize handler
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

  // Generate plan
  const handleGenerate = useCallback(async (task: string) => {
    if (!scene) return;
    setIsGenerating(true);
    setError(null);
    setPlan(null);
    setTrajectory(null);
    setCurrentStep(-1);
    setAnimatorStatus("idle");

    try {
      const prompt = buildPrompt(scene, task);
      const tools = toOpenAITools();
      const toolCalls = await callLLM(prompt, tools, config);
      setPlan(toolCalls);

      if (toolCalls.length > 0) {
        // Re-extract scene (objects may have moved from previous run)
        const currentScene = extractScene(mujocoRef.current!);
        const traj = transpile(toolCalls, currentScene);
        setTrajectory(traj);

        // Load into animator
        animatorRef.current?.loadTrajectory(traj);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGenerating(false);
    }
  }, [scene, config]);

  // Execution controls
  const handlePlay = useCallback(() => animatorRef.current?.play(), []);
  const handlePause = useCallback(() => animatorRef.current?.pause(), []);
  const handleReset = useCallback(() => {
    animatorRef.current?.reset();
    setCurrentStep(-1);
  }, []);

  // Config
  const handleSaveConfig = useCallback((newConfig: ApiConfig) => {
    setConfigState(newConfig);
    saveConfig(newConfig);
  }, []);

  return (
    <div className="app-layout">
      <div className="viewport-container">
        <canvas ref={canvasRef} />
        {loading && <div className="viewport-overlay">Loading MuJoCo...</div>}
        {error && !loading && <div className="viewport-overlay error">{error}</div>}
      </div>

      <div className="sidebar">
        <div className="sidebar-header">
          <h1>LLM Trajectory</h1>
          <button onClick={() => setShowConfig(true)} title="Settings">
            &#9881;
          </button>
        </div>

        <ScenePanel scene={scene} />
        <TaskInput
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          disabled={loading || !scene}
        />
        <PlanView plan={plan} currentStep={currentStep} />
        <ExecutionControls
          status={animatorStatus}
          onPlay={handlePlay}
          onPause={handlePause}
          onReset={handleReset}
          disabled={!trajectory}
        />
      </div>

      <StatusBar
        config={config}
        animatorStatus={animatorStatus}
        error={error}
        loading={loading}
      />

      {showConfig && (
        <ConfigDialog
          config={config}
          onSave={handleSaveConfig}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  );
}

export default App;
