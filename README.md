# Hanvid

Welcome to **Hanvid**, a blazing-fast, locally hosted Text-to-Video generation application. Powered by Wan2.1 and optimized for RTX GPUs, Hanvid combines a beautiful, responsive web interface with a high-performance Python inference server to bring your ideas to life in seconds.

![Hanvid Banner](https://via.placeholder.com/1200x400.png?text=Hanvid+-+Local+Text-to-Video)

## 🌟 Features

- **Blazing Fast Local Generation:** Optimized inference using the Wan2.1 model, capable of generating videos in ~2-3 minutes on an RTX 5070.
- **Beautiful Web Interface:** A sleek, modern Next.js frontend built with Tailwind CSS, Lucide icons, and Framer Motion for a seamless user experience.
- **RAG-Enhanced Prompting:** Automatically enhances user prompts with cinematic keywords, camera angles, and quality modifiers for stunning results.
- **Smart Queue Management:** A robust background task manager ensures sequential GPU usage, preventing out-of-memory crashes.
- **Full Chat History:** Keep track of all your prompts, generated videos, and conversations in a familiar chat-style interface.
- **Admin Dashboard:** Control system settings, manage RAG knowledge bases, and monitor the model server right from the web app.

## 🚀 Tech Stack

- **Frontend:** Next.js 15 (App Router), React, Tailwind CSS, Shadcn UI
- **Backend (Web):** Next.js API Routes, Prisma (SQLite/PostgreSQL)
- **Model Server:** Python, FastAPI, PyTorch, Diffusers
- **Model:** Wan2.1-T2V-1.3B-Diffusers

## 📋 Prerequisites

To run the model server locally, you need:
- Windows/Linux with Python 3.10+
- A CUDA-compatible NVIDIA GPU with at least 8GB VRAM (e.g., RTX 5070, RTX 3060, RTX 4060)
- Node.js 18+ for the web interface

## 🛠️ Installation & Setup

### 1. Web Application

Navigate to the project root and install dependencies:

```bash
npm install
```

Set up your database:

```bash
npx prisma generate
npx prisma db push
```

Start the development server:

```bash
npm run dev
```

The web app will be available at `http://localhost:3000`.

### 2. Model Server

Navigate to the `mini-services/model-service` directory:

```bash
cd mini-services/model-service
```

> **RTX 5070 / RTX 50-series (Blackwell) owners — install PyTorch FIRST with
> the CUDA 12.8 build, or every generation will fail or look weak:**
> ```bash
> pip uninstall -y torch
> pip install torch --index-url https://download.pytorch.org/whl/cu128
> ```

Create a virtual environment and install dependencies:

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

**Verify your hardware + stack before the first generation (takes seconds):**

```bash
python verify_setup.py    # ✅ ALL CHECKS PASSED = ready for real generation
```

It validates the RTX 50-series kernel support (live GPU probe), VRAM/RAM
budget, every Python module, ffmpeg, model weights and disk space — and
prints the exact fix for anything red.

Start the inference server:

```bash
python server.py
```

The model server runs on `http://localhost:3004`. The first run will automatically download the required model weights from HuggingFace.

## ⚙️ Configuration

Hanvid can be configured using environment variables in the `.env` file (frontend) and via the Admin Dashboard.

### Model Server Options (Environment Variables)

- `WAN_MODEL_PATH`: Local path to the model weights — either a diffusers pipeline folder (`model_index.json`, …) or a folder holding a single-file checkpoint (e.g. `models/`).
- `WAN_SAFETENSORS`: Name/path of the transformer safetensors file (default `models/Mega-v3/wan2.2-rapid-mega-aio-v3.safetensors` — the Phr00t WAN2.2-14B-Rapid-AllInOne "Mega v3" checkpoint). If the filename contains `rapid` / `lightx2v` / `distill`, the server automatically switches to CFG-free settings (guidance 1.0, no negative prompt, 4 steps, flow shift 8.0, beta sigma spacing) — required for distilled checkpoints. **The distilled detection only applies when the file actually exists and is loaded**; a plain HuggingFace load of the standard 1.3B model always runs with standard settings.
- `WAN_BASE_PIPELINE`: Repo/path used for the VAE + UMT5 text encoder + tokenizer when loading a single-file checkpoint (default `Wan-AI/Wan2.1-T2V-1.3B-Diffusers`).
- `WAN_NUM_FRAMES`: Number of frames to generate. Default is `81` (5 seconds @ 16 fps).
- `WAN_NUM_STEPS`: Diffusion steps. Default: `4` for distilled/Rapid checkpoints (official Mega-v3 value), `35` for the standard model. Higher = better quality, slower.
- `WAN_GUIDANCE_SCALE`: CFG scale. Default: `1.0` (distilled) / `5.0` (standard). **Do not raise this for Rapid/distilled models — it causes burning, distorted output.**
- `WAN_FLOW_SHIFT`: Scheduler flow shift. Default `8.0` for distilled/AIO checkpoints (official Mega-v3 workflow value), `3.0` for the standard 1.3B model at 480p (use `5.0` for 720p+).
- `WAN_DISTILLED_BETA`: `1` (default) uses beta sigma spacing — the "beta" scheduler ComfyUI recommends for Mega v3 — when scipy is installed; `0` forces plain shifted sigmas.
- `WAN_WIDTH` / `WAN_HEIGHT`: Output resolution. Default `832x480` (native 480p for both the 1.3B and Wan2.2 A14B checkpoints — generating below-native resolution produced soft, weak output).
- `WAN_SEED`: `random` (default, a fresh seed per video) or a fixed integer for reproducibility.
- `WAN_CACHE_THRESHOLD`: Controls First-Block Cache aggressiveness (default `0`, disabled). Higher means faster generation but lower quality. Ignored for distilled checkpoints.
- `WAN_DTYPE`: `auto` (default) — bfloat16 on RTX 50-series/Blackwell, float16 elsewhere. Also accepts `bf16`/`fp16`/`fp32`.
- `WAN_OOM_RETRIES`: Automatic out-of-memory recovery attempts (default `2`). On CUDA OOM the frame count is reduced ~20%, then the resolution — the video finishes instead of the task dying.
- `HANVID_POLISH`: Master switch for the post-generation anti-disturbance pass (default `1`). `0` disables.
- `HANVID_POLISH_STRENGTH`: Polish strength — `light` / `standard` (default) / `strong`. Temporal denoise + deflicker + sharpen + gentle color lift, applied automatically to every real video.
- `OLLAMA_URL` / `OLLAMA_MODEL` / `OLLAMA_TIMEOUT`: Local LLM used to merge RAG style rules into prompts (defaults: `http://localhost:11434`, `llama3.2:3b`, `45`s). If Ollama is down, the service automatically applies a DETERMINISTIC RAG enhancement (style keywords merged without any LLM) — the knowledge base improves every generation either way, and the raw RAG protocol text never reaches the video model.

### Anti-Hallucination Guardrails (prompt flow)

Every prompt passes through four verification layers before it reaches Wan2.1:

1. **Payload parsing** — the `---RAG_START---` protocol is parsed with multiple fallbacks; protocol markers are stripped from every path, and unparseable garbage falls back to a neutral safe prompt (never raw protocol text).
2. **LLM output sanitizer** — meta text ("Here is..."), labels, quotes, protocol echoes and conversational answers are rejected outright.
3. **Grounding firewall** — an accepted LLM rewrite must still contain the user's original subject and actions (content-word overlap ≥ 34%, or ≥ 67% for short prompts). A rewrite that drifts onto a different scene is discarded as a hallucination.
4. **Deterministic RAG enhancement** — whenever the LLM path is unavailable or rejected, style keywords extracted from the retrieved knowledge docs are merged into the user's prompt without any LLM, plus a professional quality tail (`highly detailed, crisp focus, smooth stable motion`).

Run the test suites (no GPU/Ollama needed):

```bash
cd mini-services/model-service && python -m pytest test_guardrails.py -v   # 37 tests
python -m pytest test_model_config.py -v                                   # 18 tests (checkpoint & distilled detection)
python -m pytest test_rag_corpus.py -v                                      # 19 tests (from repo root)
```

### RAG Knowledge Base (`rag-data/`)

The professional knowledge base lives in `rag-data/` (22 documents: lighting, camera movement, shot composition, color grading, pacing, depth of field, formats, Wan2.1 prompting rules, character consistency, motion stability, negative prompts, genre guides, food/urban/nature scenes, anatomy accuracy, the professional prompt formula, quality enhancers, clean-output guidelines, and audio pairing).

Sync it into the app (idempotent — safe to re-run):

```bash
node seed_rag.mjs            # create/update docs via the admin API
node seed_rag.mjs --dry-run  # preview changes
node seed_rag.mjs --prune    # also delete DB docs that are no longer in rag-data/
```

Adding knowledge = dropping a new `.md` file with `title`/`tags` front-matter into `rag-data/` and re-running the seed script.

### Architecture Notes

- **Generation runner:** `POST /api/chats/[id]/messages` kicks off a fire-and-forget background runner (`src/lib/generation-runner.ts`) that waits for the model service to warm up, submits the job, polls progress, persists the final video record, and pushes realtime updates. Progress reaches browsers two ways:
  1. **Realtime (socket.io):** the Next.js backend connects to the progress service on port 3003 (default `http://localhost:3003`; override with `NEXT_PUBLIC_WS_URL`, e.g. `/?XTransformPort=3003` behind the Caddy gateway).
  2. **REST fallback:** the browser polls `GET /api/videos/[id]`, which lazily syncs status from the Python service (by message id), updates the database, and even resurrects lost jobs if both the runner and the service task have vanished. This works on serverless too — no background tasks required.
- **Video streaming:** videos are served through `GET /api/videos/stream/[messageId]`, a proxy with HTTP Range support, so the Python service never has to be exposed publicly and nothing is written to `public/` (the MP4 stays on the model service).
- **Cancel:** `DELETE /api/videos/[id]` cancels the task on the Python service and marks the record cancelled (the "Stop generating" button).
- **Retry:** `POST /api/videos/[id]/retry` cancels and prunes the stale task on the service, then resubmits with the stored prompt (including RAG context).
- **Demo mode:** if torch/diffusers/CUDA are unavailable, the service renders short ffmpeg placeholder videos (see `demo_generator.py`) so the web UI remains fully functional.
- **Attachments:** the UI accepts image/video uploads, but the T2V pipeline does not condition on them — the model service logs a clear warning instead of silently ignoring them.

## 📚 Deep Guides

- **`RTX5070_TUNING.md`** — the deep operating manual for 8GB VRAM + 24GB RAM
  machines: the mandatory cu128 PyTorch stack, the VRAM budget table, which
  settings actually control accuracy, the three-layer anti-disturbance fix,
  performance expectations and a full symptom→fix troubleshooting map.
- **`LAUNCH_PLAYBOOK.md`** — how to take Hanvid public: positioning, the
  60-second demo that does the marketing, a 2-week content calendar,
  distribution targets and the 30-day scoreboard.
- **`FIXES.md`** — every bug found and fixed (v1 root causes + v2 RTX 5070
  hardening), with verification results.
- **`mini-services/model-service/verify_setup.py`** — one-command pre-flight
  doctor for your hardware, Python stack, ffmpeg and model weights.

## 🌍 Deployment

To deploy Hanvid to production (e.g., Vercel):

1. **Database:** Migrate your Prisma schema to use PostgreSQL (e.g., Supabase) instead of SQLite, as serverless environments cannot use local SQLite files.
2. **Model Server Exposure:** Use a tunneling service like [ngrok](https://ngrok.com/) to securely expose your local Python model server to the internet so the Vercel app can communicate with it.
3. **Environment Variables:** Update your Vercel project with the new `DATABASE_URL` and the ngrok URL for `MODEL_SERVER_URL`.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is licensed under the MIT License.
