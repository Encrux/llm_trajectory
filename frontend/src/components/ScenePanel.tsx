import { useState } from "react";
import type { Scene } from "../core/scene";

export function ScenePanel({ scene, defaultCollapsed = false }: { scene: Scene | null; defaultCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (!scene) return <div className="panel"><div className="plan-empty">Loading scene...</div></div>;

  return (
    <div className="panel">
      <h2
        className="panel-header-toggle"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="expand-icon">{collapsed ? "▸" : "▾"}</span>
        Scene Objects
        <span className="step-count">{scene.objects.length}</span>
      </h2>
      {!collapsed && (
        <ul className="scene-objects">
          {scene.objects.map((o) => (
            <li key={o.name}>
              <div>
                <span>{o.name}</span>
                {o.shape && <span className="scene-shape"> {o.shape}</span>}
              </div>
              <span className="coords">
                {o.size || `${o.position.x.toFixed(2)}, ${o.position.y.toFixed(2)}, ${o.position.z.toFixed(2)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
