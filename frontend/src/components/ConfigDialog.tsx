import { useState } from "react";
import type { ApiConfig } from "../core/types";

interface Props {
  config: ApiConfig;
  onSave: (config: ApiConfig) => void;
  onClose: () => void;
}

export function ConfigDialog({ config, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(config);

  return (
    <div className="config-overlay" onClick={onClose}>
      <div className="config-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>API Configuration</h2>

        <label>Base URL</label>
        <input
          value={draft.baseUrl}
          onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          placeholder="https://api.groq.com/openai"
        />

        <label>API Token</label>
        <input
          type="password"
          value={draft.apiToken}
          onChange={(e) => setDraft({ ...draft, apiToken: e.target.value })}
          placeholder="Leave empty if using proxy"
        />

        <label>Model</label>
        <input
          value={draft.model}
          onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          placeholder="llama-3.3-70b-versatile"
        />

        <div className="actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
