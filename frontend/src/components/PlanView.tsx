import { useState } from "react";
import type { WaypointGroup } from "../core/types";

interface Props {
  groups: WaypointGroup[] | null;
  currentWaypointIndex: number;
}

export function PlanView({ groups, currentWaypointIndex }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (!groups) return (
    <div className="panel">
      <h2>Generated Plan</h2>
      <div className="plan-empty">No plan generated yet</div>
    </div>
  );

  if (groups.length === 0) return (
    <div className="panel">
      <h2>Generated Plan</h2>
      <div className="plan-empty">LLM returned no tool calls</div>
    </div>
  );

  const toggle = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Map each group to its starting waypoint index
  let waypointOffset = 0;

  return (
    <div className="panel">
      <h2>Generated Plan</h2>
      <div className="plan-groups">
        {groups.map((group, gi) => {
          const groupStart = waypointOffset;
          const groupEnd = groupStart + group.waypoints.length;
          waypointOffset = groupEnd;

          const isMultiStep = group.waypoints.length > 1;
          const isExpanded = expanded.has(gi);
          const isGroupActive = currentWaypointIndex >= groupStart && currentWaypointIndex < groupEnd;
          const isGroupDone = currentWaypointIndex >= groupEnd;

          return (
            <div key={gi} className={`plan-group ${isGroupActive ? "active" : ""} ${isGroupDone ? "done" : ""}`}>
              <div
                className={`plan-group-header ${isMultiStep ? "expandable" : ""}`}
                onClick={() => isMultiStep && toggle(gi)}
              >
                <span className="step-idx">{gi + 1}.</span>
                {isMultiStep && (
                  <span className="expand-icon">{isExpanded ? "▾" : "▸"}</span>
                )}
                <span className="step-label">{group.label}</span>
                {isMultiStep && (
                  <span className="step-count">{group.waypoints.length} steps</span>
                )}
              </div>
              {isMultiStep && isExpanded && (
                <div className="plan-substeps">
                  {group.waypoints.map((wp, wi) => {
                    const wpIdx = groupStart + wi;
                    return (
                      <div
                        key={wi}
                        className={`plan-substep ${wpIdx === currentWaypointIndex ? "active" : ""} ${wpIdx < currentWaypointIndex ? "done" : ""}`}
                      >
                        <span className="substep-label">{wp.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
