# Wan2.1 Model Service (Python / FastAPI, port 3004)

A small FastAPI micro-service that turns text prompts into short MP4 videos
using the **Wan2.1-T2V-1.3B** (`wan2.1_t2v_1.3B_fp16.safetensors`) model.

> This is a Python service (not Bun). It's a documented exception to the
> bun-only mini-services rule because the Wan2.1 model requires PyTorch.

---

## 1. What it does

- Loads the `Wan-AI/Wan2.1-T2V-1.3B-Diffusers` pipeline from Hugging Face
  (or a local path) into VRAM when torch + CUDA + diffusers are available.
- Exposes four HTTP endpoints (see below) that the Next.js backend calls.
- Tracks async generation jobs in memory (no DB needed).

---

## 2. Install

```bash
cd /home/z/my-project/mini-services/model-service
pip install -r requirements.txt
```

`requirements.txt` ships with **only** FastAPI + uvicorn — that's enough
for demo mode. The optional torch/diffusers stack is commented out so
`pip install` works on machines without CUDA.

---

## 3. Run

```bash
# from inside mini-services/model-service/
python server.py
#   OR
uvicorn server:app --host 0.0.0.0 --port 3004
```

The service listens on **port 3004** (hardcoded by contract).

Verify it started:

```bash
curl -s http://localhost:3004/health
# → {"status":"ok","model_loaded":false,"mode":"demo"}
```

### Running as a true daemon (recommended for sandboxed shells)

Some sandboxed shells (notably this one) kill background processes when the
launching command returns. `nohup ... &` therefore doesn't survive between
shell calls. To work around this, use the included double-fork launcher:

```bash
cd /home/z/my-project/mini-services/model-service
python3 launch.py                 # detaches into a new session, returns immediately
# logs go to /home/z/my-project/model-service.log by default
```

Stop with: `pkill -f "python3 server.py"`

---

## 4. Enabling REAL Wan2.1 generation

Demo mode is great for development, but for true text-to-video you need
the ML stack:

### a) Install torch (CUDA build) + diffusers

Edit `requirements.txt` and uncomment the optional ML lines:

```
torch
diffusers
transformers
accelerate
imageio
imageio-ffmpeg
```

Then install — note torch needs the CUDA wheel index:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install diffusers transformers accelerate imageio imageio-ffmpeg
```

### b) Download the model

We now use the ComfyUI repackaged single-file version for the transformer:
```bash
# Install huggingface_hub if not already
pip install huggingface_hub

# 1. Download the main diffusers repo for VAE, tokenizer, etc. (diffusers will auto-download if missing, but it's good to be explicit)
# 2. Download the specific ComfyUI repackaged safetensors file for the transformer
huggingface-cli download Comfy-Org/Wan_2.1_ComfyUI_repackaged split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors --local-dir ./models/
```

### c) Point the service at a local model dir

```bash
# Set the base diffusers repo or local path (diffusers will download the rest here if it's an ID)
export WAN_MODEL_PATH="Wan-AI/Wan2.1-T2V-1.3B-Diffusers"

# Set the single safetensors file to use for the transformer
export WAN_SAFETENSORS="models/wan2.1_t2v_1.3B_fp16.safetensors"
```

### d) Restart and verify

```bash
python server.py
curl -s http://localhost:3004/health
# → {"status":"ok","model_loaded":true,"mode":"real"}
```

### Force demo mode

```bash
export WAN_DISABLE_MODEL=1
python server.py
```

---

## 5. API endpoints

### `GET /health`
Returns service status.

```json
{ "status": "ok", "model_loaded": true, "mode": "real" }
```
- `model_loaded`: true only when the real Wan2.1 pipeline is in VRAM.

### `POST /generate`
Queue a generation job. Returns immediately.

```http
POST /generate
Content-Type: application/json

{
  "prompt": "a cat playing",
  "enhanced_prompt": "a fluffy cat playing with yarn on a sunny rug",
  "message_id": "msg_abc123"
}
```

Response:
```json
{ "task_id": "1f3a9c2b8e7d4a10" }     // 202 Accepted
```

- Uses `enhanced_prompt` (RAG-enhanced) for actual generation.
- Falls back to `prompt` if `enhanced_prompt` is empty.

### `GET /status/<task_id>`
Polls a job.

```json
// pending / generating
{ "status": "generating", "progress": 42 }

// ready
{
  "status": "ready",
  "progress": 100,
  "video_url": "/video/1f3a9c2b8e7d4a10",
  "duration": 4,
  "width": 640,
  "height": 360,
  "mode": "demo"
}

// failed
{ "status": "failed", "error": "ffmpeg not found" }
```

### `GET /video/<task_id>`
Streams the generated MP4 with `Content-Type: video/mp4` and HTTP Range
support (so HTML5 `<video>` can seek). Returns `404` if the video isn't
ready yet.



---

## 7. File layout

```
mini-services/model-service/
├── README.md            # this file
├── requirements.txt
├── server.py             # FastAPI app on port 3004
├── wan_inference.py      # Lazy Wan2.1 loader + inference
├── demo_generator.py     # ffmpeg-based fallback generator
├── task_manager.py       # Async in-memory task registry
├── launch.py             # Double-fork daemon launcher (sandbox-safe)
└── videos/               # generated MP4s (one per task_id)
```

---

## 8. Notes / caveats

- The task registry is **in-memory** — restarting the service drops
  pending tasks and the ability to fetch existing `/video/<task_id>` URLs
  whose files have been deleted.
- For real generation, a single 1.3B run is ~8 GB of VRAM and takes
  30-90 seconds on an RTX-class card. The Next.js backend polls `/status`
  every ~1 s and relays progress over WebSocket (port 3003).
- `WAN_DISABLE_MODEL=1` forces demo mode regardless of GPU/torch state.
