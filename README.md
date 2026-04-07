# LLM Trajectory

Natural language to robot trajectory. Type a task, watch a Franka Panda execute it.

Runs entirely in the browser (MuJoCo WASM + Three.js). Only the LLM call goes to a backend.

<video src="https://private-user-images.githubusercontent.com/28564983/574677449-06b4a244-97c7-4368-b9bd-7aaed495efbe.mp4?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NzU1NjcyMzksIm5iZiI6MTc3NTU2NjkzOSwicGF0aCI6Ii8yODU2NDk4My81NzQ2Nzc0NDktMDZiNGEyNDQtOTdjNy00MzY4LWI5YmQtN2FhZWQ0OTVlZmJlLm1wND9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNjA0MDclMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjYwNDA3VDEzMDIxOVomWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPTkxOWUxOTIyZDFjNGZiZWY3Y2Q0OGZlMTM3YjUwYzM0NjA5N2I0MjgzMzNlM2Y4NmY2MTA4MzYyNmMxZGZmMmMmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0In0.5mFdZviZ8SpgHC4yv50M4cZKugcTR2X6XBdIReVVd6Q" autoplay loop muted playsinline></video>

**[Live demo](https://llm-trajectory.boesch.dev)** | **[Blog post](https://boesch.dev/posts/llm-trajectory/)**

## Quick start

```bash
cd frontend
cp .env.example .env
npm install
npx vite
```

Open `http://localhost:5173`. That's it. The default config points at a hosted backend that proxies to Groq's free tier, so no API key needed.

The hosted demo uses my own endpoint (qwen/qwen3-32b) that is rate-limited to 20-60 requests per minute. Please be gentle with it.

## Use your own LLM

Edit `frontend/.env`:

```bash
# Any OpenAI-compatible endpoint works
VITE_API_BASE_URL=http://localhost:11434  # Ollama
VITE_MODEL=llama3

# Or direct to a provider (CORS must be enabled)
VITE_API_BASE_URL=https://api.groq.com/openai
VITE_MODEL=qwen/qwen3-32b
```

If you're calling a provider directly (not through a proxy), you'll need to add an API key header. See `frontend/src/core/llmClient.ts`.

### Model requirements

The model must support **tool calling** (function calling) via the OpenAI-compatible API. Models known to work:

- `qwen/qwen3-32b` (Groq) - recommended, supports reasoning
- `meta-llama/llama-4-scout-17b-16e-instruct` (Groq)
- `gpt-4o` (OpenAI)
- Any Ollama model with tool support

**Note on reasoning models:** Models like Qwen3 and DeepSeek-R1 can spend all their output tokens on thinking and return no tool calls. The system prompt includes "Keep your reasoning brief" to mitigate this, but very long/complex tasks may still fail. If you get empty plans, try a non-reasoning model or simplify the task.

## Project structure

```
frontend/           TypeScript + React + Vite
  src/
    core/           Pure logic (scene, primitives, resolver, LLM client)
    sim/            MuJoCo WASM + Three.js (loader, visualizer, IK, animator)
    components/     React UI
  public/mujoco/    Franka Panda model + scene XML
  vendor/mujoco/    MuJoCo WASM runtime

src/                Python CLI (original prototype, not used by web demo)
```

## How it works

1. **Scene extraction** reads object positions from the MuJoCo simulation
2. **LLM** receives a text scene description + tool definitions, returns tool calls like `pick("Red Cube")`, `place("Plate")`
3. **Resolver** expands tool calls into waypoints (name to coordinates, higher-order primitives to atomic steps)
4. **Animator** drives the robot arm to each waypoint using IK

## Adding primitives

Add one function in `frontend/src/core/primitives.ts`:

```typescript
const push: PrimitiveDef = {
  name: "push",
  description: "Push an object sideways.",
  parameters: {
    type: "object",
    properties: {
      object_name: { type: "string" },
      direction: { type: "string", description: "left or right" },
    },
    required: ["object_name", "direction"],
  },
  handler: (scene, params): Waypoint[] => {
    // ... return waypoints
  },
};
```

Add it to the `LLM_PRIMITIVES` array and the LLM can use it immediately.

## Running the backend proxy

Only needed if you want to host your own proxy (to hide API keys or add rate limiting).

```bash
cd backend/  # or wherever your proxy lives
pip install -r requirements.txt
GROQ_API_KEY=your_key python app.py
```

The proxy forwards `/v1/chat/completions` to Groq with the API key injected. The frontend's `VITE_API_BASE_URL` should point at it.

## Tests

```bash
cd frontend
npx vitest run
```

## Disclaimer
The system was designed and implemented by myself back in 2023. This demo is a re-implementation of the original concept. AI was used to speed up the process. 
