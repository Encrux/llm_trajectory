import type { ApiConfig } from "../core/types";
import type { AnimatorStatus } from "../sim/animator";

interface Props {
  config: ApiConfig;
  animatorStatus: AnimatorStatus;
  error: string | null;
  loading: boolean;
}

export function StatusBar({ config, animatorStatus, error, loading }: Props) {
  const statusText = loading
    ? "Loading MuJoCo..."
    : animatorStatus === "running"
      ? "Executing trajectory..."
      : animatorStatus === "done"
        ? "Trajectory complete"
        : "Ready";

  const dotClass = error ? "red" : loading ? "yellow" : "green";

  return (
    <div className="status-bar">
      <span>
        <span className={`dot ${dotClass}`} />
        {error ? `Error: ${error}` : statusText}
      </span>
      <span>{config.model}</span>
      <span>{new URL(config.baseUrl).hostname}</span>
    </div>
  );
}
