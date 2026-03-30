import { useState } from "react";
import { SUGGESTED_PROMPT } from "../core/prompt";

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
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Describe what the robot should do..."
        disabled={isGenerating}
      />
      <div className="actions">
        <button
          className="btn btn-primary"
          onClick={() => onGenerate(task)}
          disabled={disabled || isGenerating || !task.trim()}
        >
          {isGenerating ? "Generating..." : "Generate Plan"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => setTask(SUGGESTED_PROMPT)}
          disabled={isGenerating}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
