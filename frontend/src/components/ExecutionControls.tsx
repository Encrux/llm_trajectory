import type { AnimatorStatus } from "../sim/animator";

interface Props {
  status: AnimatorStatus;
  onPlay: () => void;
  onReset: () => void;
  disabled: boolean;
}

export function ExecutionControls({ status, onPlay, onReset, disabled }: Props) {
  return (
    <div className="panel">
      <h2>Execution</h2>
      <div className="exec-controls">
        <button className="btn btn-primary" onClick={onPlay} disabled={disabled || status === "running"}>
          {status === "running" ? "Running..." : status === "done" ? "Replay" : "Play"}
        </button>
        <button className="btn btn-secondary" onClick={onReset} disabled={disabled}>
          Reset
        </button>
      </div>
    </div>
  );
}
