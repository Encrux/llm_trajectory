import { useState } from "react";
import { SUGGESTED_PROMPT } from "../core/prompt";

const EXAMPLES = [
  { label: "Pick & place", prompt: SUGGESTED_PROMPT },
  { label: "Sort by shape", prompt: "Put all the cubes on the plate" },
  { label: "Stack", prompt: "Stack the red cube on top of the blue cube" },
];

interface Props {
  onGenerate: (task: string) => void;
  isGenerating: boolean;
  disabled: boolean;
}

export function TaskInput({ onGenerate, isGenerating, disabled }: Props) {
  const [task, setTask] = useState(SUGGESTED_PROMPT);

  return (
    <div className="panel task-input">
      <h2>Task</h2>
      <div className="example-chips">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            className={`chip ${task === ex.prompt ? "active" : ""}`}
            onClick={() => {
              setTask(ex.prompt);
              (window as any).umami?.track("example-chip", { label: ex.label });
            }}
            disabled={isGenerating}
          >
            {ex.label}
          </button>
        ))}
      </div>
      <div className="textarea-wrapper">
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Describe what the robot should do..."
          disabled={isGenerating}
        />
        {task && !isGenerating && (
          <button className="textarea-clear" onClick={() => setTask("")} title="Clear">
            &times;
          </button>
        )}
      </div>
      <div className="actions">
        <button
          className="btn btn-primary"
          onClick={() => onGenerate(task)}
          disabled={disabled || isGenerating || !task.trim()}
        >
          {isGenerating ? "Generating..." : "Generate Plan"}
        </button>
      </div>
    </div>
  );
}
