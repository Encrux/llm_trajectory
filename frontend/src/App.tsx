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
import { resolve } from "./core/resolver";
import { config } from "./config";
import { ScenePanel } from "./components/ScenePanel";
import { TaskInput } from "./components/TaskInput";
import { PlanView } from "./components/PlanView";
import { ExecutionControls } from "./components/ExecutionControls";
import { StatusBar } from "./components/StatusBar";
import { BottomSheet } from "./components/BottomSheet";
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
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
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

        setLoading(false);

        // Pre-computed plan for the suggested prompt — no LLM call needed
        const defaultPlan: ToolCall[] = [
          { name: "pick", params: { object_name: "Red Cube" } },
          { name: "place", params: { target_name: "Plate" } },
        ];
        if (mounted) {
          setPlan(defaultPlan);
          const traj = resolve(defaultPlan, extractedScene);
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

  // Resize handler + mobile detection
  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth <= 768);
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
        const traj = resolve(toolCalls, currentScene);
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
  const bottomSheetRef = useRef<{ collapse: () => void }>(null);
  const handlePlay = useCallback(async () => {
    if (isMobile) {
      bottomSheetRef.current?.collapse();
    } else {
      // no-op on desktop, sidebar stays open
    }
    (window as any).umami?.track("play-trajectory");
    await animatorRef.current?.play();
  }, [isMobile]);
  const handlePause = useCallback(() => animatorRef.current?.pause(), []);
  const handleReset = useCallback(() => {
    animatorRef.current?.reset();
    setCurrentStep(-1);
  }, []);


  return (
    <div className={`app-layout ${!isMobile && sidebarOpen ? "" : "sidebar-closed"}`}>
      <div
        className="viewport-container"
        style={!isMobile && sidebarOpen ? { right: `${sidebarWidth}px` } : undefined}
      >
        <canvas ref={canvasRef} />
        {loading && <div className="viewport-overlay">Loading MuJoCo + Franka Panda...<br/><span style={{fontSize: "0.75rem", opacity: 0.6}}>This may take a moment</span></div>}
        {isGenerating && <div className="viewport-overlay">Generating plan...</div>}
        {animatorStatus === "running" && currentStep === -1 && <div className="viewport-overlay">Computing trajectory...</div>}
        {error && !loading && <div className="viewport-overlay error">{error}</div>}
      </div>

      {/* Desktop: sidebar */}
      {!isMobile && (
        <div
          ref={sidebarRef}
          className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}
          style={{ width: `${sidebarWidth}px` }}
        >
          <div
            className={`sidebar-handle ${showHint && !sidebarOpen ? "with-hint" : ""}`}
            onClick={() => {
              if (resizing.current) return;
              setSidebarOpen(!sidebarOpen);
              if (showHint) {
                setShowHint(false);
                localStorage.setItem("llm-traj-visited", "1");
                (window as any).umami?.track("sidebar-discovered");
              }
            }}
            onMouseDown={(e) => {
              if (!sidebarOpen) return;
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
              <div className="header-links">
                <a href="https://boesch.dev/posts/llm-trajectory/" target="_blank" rel="noopener" title="Blog post">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                </a>
                <a href="https://github.com/Encrux/llm_trajectory" target="_blank" rel="noopener" title="Source code">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                </a>
              </div>
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
      )}

      {/* Mobile: bottom sheet */}
      {isMobile && !loading && (
        <BottomSheet
          ref={bottomSheetRef}
          peekContent={
            <div className="bottom-sheet-peek-row">
              <span className="bottom-sheet-title">LLM Trajectory</span>
              {trajectory && (
                <button className="btn btn-primary btn-small" onClick={handlePlay}>
                  {animatorStatus === "done" ? "Replay" : "Play"}
                </button>
              )}
            </div>
          }
        >
          <ScenePanel scene={scene} defaultCollapsed />
          <TaskInput
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
            disabled={!scene}
          />
          <PlanView groups={groups} currentWaypointIndex={currentStep} />
          <ExecutionControls
            status={animatorStatus}
            onPlay={handlePlay}
            onPause={handlePause}
            onReset={handleReset}
            disabled={!trajectory}
          />
        </BottomSheet>
      )}

      {/* Desktop only */}
      {!isMobile && (
        <StatusBar
          config={config}
          animatorStatus={animatorStatus}
          error={error}
          loading={loading}
        />
      )}

    </div>
  );
}

export default App;
