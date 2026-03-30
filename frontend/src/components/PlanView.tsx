import type { ToolCall } from "../core/types";

interface Props {
  plan: ToolCall[] | null;
  currentStep: number;
}

export function PlanView({ plan, currentStep }: Props) {
  return (
    <div className="panel">
      <h2>Generated Plan</h2>
      {!plan ? (
        <div className="plan-empty">No plan generated yet</div>
      ) : plan.length === 0 ? (
        <div className="plan-empty">LLM returned no tool calls</div>
      ) : (
        <ol className="plan-steps">
          {plan.map((call, i) => {
            const params = Object.entries(call.params || {})
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(", ");
            return (
              <li
                key={i}
                className={i === currentStep ? "active" : i < currentStep ? "completed" : ""}
              >
                <span className="step-idx">{i + 1}.</span>
                <span>{call.name}({params})</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
