import { useCallback, useEffect, useRef, useState } from "react";
import { loadMujoco, type MujocoState } from "./sim/mujocoLoader";
import { initRenderer, render as renderThree, handleResize, type RendererState } from "./sim/threeRenderer";
import { buildVisuals, syncVisuals, type VisualizerState } from "./sim/mujocoVisualizer";
import { extractScene } from "./sim/sceneExtractor";
import { Animator, type AnimatorStatus } from "./sim/animator";
import { Scene } from "./core/scene";
import type { ToolCall, Trajectory, WaypointGroup } from "./core/types";
import { buildPrompt, SUGGESTED_PROMPT } from "./core/prompt";
import { toOpenAITools } from "./core/primitives";
import { callLLM } from "./core/llmClient";
import { transpile } from "./core/transpiler";
import { config } from "./config";
import { ScenePanel } from "./components/ScenePanel";
import { TaskInput } from "./components/TaskInput";
import { PlanView } from "./components/PlanView";
import { ExecutionControls } from "./components/ExecutionControls";
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
  const [groups, setGroups] = useState<WaypointGroup[] | null>(null);
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [animatorStatus, setAnimatorStatus] = useState<AnimatorStatus>("idle");
  const [currentStep, setCurrentStep] = useState(-1);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768);
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [showHint, setShowHint] = useState(() => !localStorage.getItem("llm-traj-visited"));
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const resizing = useRef(false);

  // Resize viewport when sidebar toggles or resizes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (canvasRef.current && rendererRef.current) {
        const parent = canvasRef.current.parentElement;
        if (parent) handleResize(rendererRef.current, parent.clientWidth, parent.clientHeight);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [sidebarOpen, sidebarWidth]);

  // Desktop resize handle
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const newWidth = Math.max(280, Math.min(600, window.innerWidth - e.clientX));
      setSidebarWidth(newWidth);
      // Live-resize: requestAnimationFrame to batch with render
      requestAnimationFrame(() => {
        if (canvasRef.current && rendererRef.current) {
          const parent = canvasRef.current.parentElement;
          if (parent) handleResize(rendererRef.current, parent.clientWidth, parent.clientHeight);
        }
      });
    };
    const onMouseUp = () => {
      if (resizing.current) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Delay clearing so onClick can check it
        setTimeout(() => { resizing.current = false; }, 50);
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

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

        // Create animator + give it the Three.js scene for IK goal marker
        animatorRef.current = new Animator(mState, {
          onStepStart: (idx) => setCurrentStep(idx),
          onStepComplete: () => {},
          onStatusChange: (s) => setAnimatorStatus(s),
          onError: (e) => setError(e.message),
        });
        animatorRef.current.setThreeScene(rState.scene);

        setLoading(false);

        // Pre-computed plan for the suggested prompt — no LLM call needed
        const defaultPlan: ToolCall[] = [
          { name: "pick", params: { object_name: "Red Cube" } },
          { name: "place", params: { target_name: "Plate" } },
        ];
        if (mounted) {
          setPlan(defaultPlan);
          const traj = transpile(defaultPlan, extractedScene);
          setGroups([...traj.groups]);
          setTrajectory(traj);
          animatorRef.current?.loadTrajectory(traj);
        }

        const SUBSTEPS = 5;
        function animate() {
          if (!mounted) return;
          const { mj: mjLib, model, data } = mujocoRef.current!;

          // Single unified loop: set values → step → re-apply → repeat
          const isRunning = animatorRef.current?.getStatus() === "running";

          // Check if all objects have settled (skip stepping if so)
          let maxVel = 0;
          if (!isRunning) {
            for (let i = 0; i < model.nv; i++) {
              maxVel = Math.max(maxVel, Math.abs(data.qvel[i]));
            }
          }

          // Only step physics if animator is running OR objects are still moving
          if (isRunning || maxVel > 0.01) {
            animatorRef.current?.preStep();
            for (let i = 0; i < SUBSTEPS; i++) {
              mjLib.mj_step(model, data);
              animatorRef.current?.postSubstep();
            }
            animatorRef.current?.postFrame();
          }

          animatorRef.current?.updateTcpDebugPoint();
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
    setGroups(null);
    setTrajectory(null);
    setCurrentStep(-1);
    setAnimatorStatus("idle");

    try {
      const prompt = buildPrompt(scene, task);
      const tools = toOpenAITools();
      const toolCalls = await callLLM(prompt, tools, config);
      (window as any).umami?.track("generate-plan", { prompt: task.slice(0, 200) });
      setPlan(toolCalls);

      if (toolCalls.length > 0) {
        const currentScene = extractScene(mujocoRef.current!);
        const traj = transpile(toolCalls, currentScene);
        setGroups([...traj.groups]);
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
  const handlePlay = useCallback(async () => {
    if (window.innerWidth <= 768) setSidebarOpen(false);
    (window as any).umami?.track("play-trajectory");
    await animatorRef.current?.play();
  }, []);
  const handlePause = useCallback(() => animatorRef.current?.pause(), []);
  const handleReset = useCallback(() => {
    animatorRef.current?.reset();
    setCurrentStep(-1);
  }, []);


  return (
    <div className={`app-layout ${sidebarOpen ? "" : "sidebar-closed"}`}>
      <div
        className="viewport-container"
        style={sidebarOpen && window.innerWidth > 768 ? { right: `${sidebarWidth}px` } : undefined}
      >
        <canvas ref={canvasRef} />
        {/* Right edge touch zone for opening sidebar (doesn't interfere with OrbitControls) */}
        {!sidebarOpen && (
          <div
            className="edge-swipe-zone"
            onTouchStart={(e) => {
              dragging.current = true;
              dragStartX.current = e.touches[0].clientX;
              sidebarRef.current?.classList.add("dragging");
            }}
            onTouchMove={(e) => {
              if (!dragging.current || !sidebarRef.current) return;
              const dx = dragStartX.current - e.touches[0].clientX;
              const sw = Math.min(320, window.innerWidth * 0.85);
              const offset = Math.max(0, sw - dx);
              sidebarRef.current.style.right = `${-offset}px`;
            }}
            onTouchEnd={(e) => {
              if (!dragging.current || !sidebarRef.current) return;
              dragging.current = false;
              sidebarRef.current.classList.remove("dragging");
              const dx = dragStartX.current - e.changedTouches[0].clientX;
              const sw = Math.min(320, window.innerWidth * 0.85);
              sidebarRef.current.style.right = "";
              if (dx / sidebarWidth > 0.3) {
                setSidebarOpen(true);
                if (showHint) {
                  setShowHint(false);
                  localStorage.setItem("llm-traj-visited", "1");
                  (window as any).umami?.track("sidebar-discovered");
                }
              }
            }}
          />
        )}
        {loading && <div className="viewport-overlay">Loading MuJoCo + Franka Panda...</div>}
        {isGenerating && <div className="viewport-overlay">Generating plan...</div>}
        {animatorStatus === "running" && currentStep === -1 && <div className="viewport-overlay">Computing trajectory...</div>}
        {error && !loading && <div className="viewport-overlay error">{error}</div>}
      </div>

      <div
        ref={sidebarRef}
        className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}
        style={window.innerWidth > 768 ? { width: `${sidebarWidth}px` } : undefined}
        onTouchStart={(e) => {
          dragging.current = true;
          dragStartX.current = e.touches[0].clientX;
          sidebarRef.current?.classList.add("dragging");
        }}
        onTouchMove={(e) => {
          if (!dragging.current || !sidebarRef.current) return;
          const dx = e.touches[0].clientX - dragStartX.current;
          if (dx > 0) {
            sidebarRef.current.style.right = `${-dx}px`;
          }
        }}
        onTouchEnd={(e) => {
          if (!dragging.current || !sidebarRef.current) return;
          dragging.current = false;
          sidebarRef.current.classList.remove("dragging");
          sidebarRef.current.style.right = "";
          const dx = e.changedTouches[0].clientX - dragStartX.current;
          if (dx > 80) setSidebarOpen(false);
        }}
      >
        {/* Handle — inside sidebar, sticks out to the left, always visible */}
        <div
          className={`sidebar-handle ${showHint && !sidebarOpen ? "with-hint" : ""}`}
          onClick={() => {
            // Don't toggle if we just finished resizing
            if (resizing.current) return;
            setSidebarOpen(!sidebarOpen);
            if (showHint) {
              setShowHint(false);
              localStorage.setItem("llm-traj-visited", "1");
              (window as any).umami?.track("sidebar-discovered");
            }
          }}
          onMouseDown={(e) => {
            if (window.innerWidth <= 768 || !sidebarOpen) return;
            e.preventDefault();
            resizing.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        >
          <span className="handle-grip">⋮</span>
          {showHint && !sidebarOpen && <span className="handle-hint">Open controls</span>}
        </div>
        <div className="sidebar-content">
          <div className="sidebar-header">
            <h1>LLM Trajectory</h1>
          </div>

          <ScenePanel scene={scene} />
          <TaskInput
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
            disabled={loading || !scene}
          />
          <PlanView groups={groups} currentWaypointIndex={currentStep} />
          <ExecutionControls
            status={animatorStatus}
            onPlay={handlePlay}
            onPause={handlePause}
            onReset={handleReset}
            disabled={!trajectory}
          />
        </div>
      </div>

      <StatusBar
        config={config}
        animatorStatus={animatorStatus}
        error={error}
        loading={loading}
      />

    </div>
  );
}

export default App;
