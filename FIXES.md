# Hanvid — Fix Report

This document lists every bug and semantic issue found in the uploaded source
and how it was fixed. The fixes are grouped by area. Files touched are listed
at the end.

---

## 1. Video quality — why generations looked weak, noisy and disturbed

These were the root causes of the "weak + disturbed" output. Fix #1.1 alone
explains most of it.

### 1.1 Standard model running with distilled settings (CRITICAL)

`wan_inference.py` decided whether the model is "distilled" (Rapid/CFG-free)
by looking at the **`WAN_SAFETENSORS` filename — even when the transformer was
actually loaded from HuggingFace** (`Wan-AI/Wan2.1-T2V-1.3B-Diffusers`).

The default `WAN_SAFETENSORS` is `models/Mega-v3/wan2.2-rapid-mega-aio-v3.safetensors`
— the name contains "rapid". So with no local checkpoint file present, the
**standard 1.3B model ran with the distilled settings: 6 steps, CFG 1.0, no
negative prompt**. A standard diffusion model at 6 steps with no classifier
guidance produces exactly what you described: mushy, weak, noisy, disturbed
frames.

**Fix:** distilled detection now only applies when a single-file checkpoint
**actually exists and is loaded** (`resolve_checkpoint()` +
`checkpoint_is_distilled()`). A HuggingFace load is always treated as the
standard model → 35 steps, CFG 5.0, official negative prompt, UniPC scheduler.

### 1.2 Single-file (Phr00t AIO) checkpoint could never load (CRITICAL)

Two bugs in the single-file path:

1. **Path double-join:** `os.path.join(WAN_MODEL_PATH, WAN_SAFETENSORS)` with
   `WAN_MODEL_PATH=models` and the default `WAN_SAFETENSORS=models/Mega-v3/…`
   produced `models/models/Mega-v3/…` → file not found → silent demo-mode
   fallback.
2. **Wrong base pipeline:** after extracting the transformer from the single
   file, the code called `WanPipeline.from_pretrained(WAN_MODEL_PATH)` — a raw
   folder with no `model_index.json` → guaranteed failure.

**Fix:** `_candidate_paths()` now tries every sensible location (absolute
path, relative to CWD, relative to the service dir, joined with the model
path, basename-only, `models/` conventions) and returns the first file that
exists. Pipeline components (VAE / UMT5 / tokenizer) come from
`WAN_BASE_PIPELINE` (default the Wan2.1-T2V-1.3B-Diffusers repo — its VAE and
text encoder are the ones the Wan2.2 A14B checkpoints use). A failed
single-file load now **falls back to the standard hub model with correct
standard settings** and logs a clear error instead of silently degrading.

### 1.3 Distilled generation settings didn't match the model (CRITICAL)

The official Phr00t Mega-v3 ComfyUI workflow (fetched from the model repo)
uses: **4 steps, CFG 1.0, sampler `ipndm`, scheduler `beta`,
ModelSamplingSD3 shift 8**. The code used 6 steps and flow_shift 3.0 — and,
worse:

- **`flow_shift` was silently dropped.** Current diffusers renamed the
  `FlowMatchEulerDiscreteScheduler` init arg to `shift`, so
  `from_config(config, flow_shift=…)` ignored the value entirely → effective
  shift **1.0**. The scheduler is now constructed with a version-tolerant
  kwarg cascade (`shift` → `flow_shift`).

**Fix:** distilled checkpoints now default to **4 steps, shift 8.0, Euler
solver with beta sigma spacing** (the ComfyUI "beta" scheduler; needs scipy,
falls back to shifted sigmas). All still overridable via env.

### 1.4 Standard-path scheduler (verified, kept)

The hub repo's scheduler config is genuinely `UniPCMultistepScheduler` with
`prediction_type=flow_prediction`, `use_flow_sigmas=true`, `flow_shift=3.0` —
the old code was right here; it is kept, now guarded with a fallback.

### 1.5 Below-native resolution (HIGH)

Default output was **640×352**, but both the 1.3B model and the Wan2.2 A14B
checkpoints are native **480p (832×480)**. Generating below training
resolution yields soft, weak detail. **Fix:** default 832×480, overridable
via `WAN_WIDTH` / `WAN_HEIGHT`.

### 1.6 UMT5 text encoder in fp16 on CPU (MEDIUM)

T5-family encoders overflow in fp16 (a known issue — official Wan setups use
bfloat16). fp16 embeddings can contain NaNs/inf → "disturbed" conditioning.
**Fix:** the CPU-resident text encoder now runs in **bf16**; final embeddings
are cast to fp16 for the transformer.

### 1.7 `unload()` freed no VRAM (MEDIUM)

`unload()` only called `torch.cuda.empty_cache()` — nothing was moved off the
GPU — while `task_manager` called it to make room for MMAudio. **Fix:** it now
moves any lingering pipeline components to CPU, then empties the cache. The
pipeline stays loaded (sequential offloading re-uploads layers on the next
run).

### 1.8 MP4 export pixel format (MEDIUM)

The imageio export didn't force a pixel format; some builds default to
yuv444p, which browsers/QuickTime either refuse to play or render with wrong
colors. **Fix:** `pixelformat="yuv420p"`, quality 9, `+faststart` movflag.

---

## 2. Web app — the pipeline that made videos never appear

### 2.1 `/api/videos/[id]`, `/api/videos/[id]/retry` and DELETE cancel did not exist (CRITICAL)

The frontend polls `GET /api/videos/{id}` (video-card.tsx), calls
`POST /api/videos/{id}/retry` ("Try again") and `DELETE /api/videos/{id}`
("Stop generating") — but the `src/app/api/videos/` folder **didn't exist**.
Every card polled a 404 forever; the retry and cancel buttons were dead.

**Fix:** three new routes:
- `GET /api/videos/[id]` — lazily syncs status from the Python service by
  message id, updates the DB, and on completion stores the stream URL. Also
  merges live queue/ETA fields, and **resurrects lost jobs** (if both the
  in-process runner and the service task have vanished, it resubmits from the
  stored prompt — cards can no longer spin forever after a Next.js restart).
- `DELETE /api/videos/[id]` — cancels the service task + marks the record
  cancelled.
- `POST /api/videos/[id]/retry` — cancels the stale task, resets the record,
  resubmits through the background runner.

### 2.2 The generation runner was dead code (CRITICAL)

`src/lib/generation-runner.ts` (warmup wait → submit → poll → persist →
realtime push) was **never called by anything**. The messages route fired a
bare `submitLocalJob` and forgot about it: if the model service was still
warming up or offline, **the job was silently lost** and the card spun on
"Generating video…" forever; the DB was never updated with progress or the
final URL.

**Fix:** the messages route now kicks off `runGenerationInBackground`
(fire-and-forget, survives the request lifecycle via the global tracker).
It waits up to 10 min for the service, submits, polls, persists, updates the
message content ("Video generated." / failure) and pushes realtime updates.
Attachments are passed through (and finally size-validated).

### 2.3 Realtime socket URL only worked behind a nonexistent gateway (HIGH)

`WS_URL` defaulted to `/?XTransformPort=3003` — a Caddy-gateway transform.
The Caddyfile in the repo is empty, so locally the socket connected to the
Next.js server itself and never received events; the REST fallback (see 2.1)
was missing too. **Fix:** default `http://localhost:3003` (the realtime
service has open CORS); overridable via `NEXT_PUBLIC_WS_URL`.

### 2.4 Videos saved to `public/` broke in production (HIGH)

`downloadLocalVideo` wrote MP4s to `process.cwd()/public/videos`. In the
standalone production build (`npm start` runs `.next/standalone/server.js`),
that folder is **not** the one being served → 404s. **Fix:** the file stays on
the model service and is streamed through the new
`GET /api/videos/stream/[messageId]` proxy with HTTP Range support (as the
README always claimed). The URL is stored in the DB and works identically in
dev and production.

### 2.5 Demo mode never actually generated anything (MEDIUM)

`demo_generator.py` (ffmpeg placeholder videos) was fully implemented but
never referenced — without a GPU, every task failed with "model not loaded"
even though the README and requirements.txt promise a working demo mode.
**Fix:** the task manager now renders placeholder videos in demo mode, and
the web app accepts demo-mode services as "ready" (no more 10-minute
"warming" wait against a CPU-only box).

---

## 3. Semantic issues (things that lied)

- **Silent attachment ignoring:** uploads were accepted, base64-decoded,
  written to disk — and then never used by the T2V pipeline. Now clearly
  logged as a warning at generation time (and documented in the README).
- **Misleading logs:** "Wan2.1 VRAM freed" (nothing was freed — see 1.7);
  effective settings now honestly reported in `/health`, including the actual
  checkpoint name, resolution and scheduler.
- **README drift:** documented routes that didn't exist, a typo'd stream URL
  (`stream/essageId]`), outdated default settings. README now matches the
  actual behaviour.
- **Attachment size unbounded** on the API → now validated (≤ ~3 MB, HTTP 413
  beyond).
- **Status mapping:** the Python "queued" state is now mapped to the
  frontend's `pending` + `phase: "queued"` on every path (REST sync included),
  so the queue UI shows consistent states.

---

## 4. Security note

`.env` in the uploaded archive contains **live Supabase credentials**. Since
the archive has been shared, **rotate that password** in the Supabase
dashboard and update `.env` / your Vercel env vars.

---

## Files changed

```
mini-services/model-service/wan_inference.py    (rewritten loader + settings)
mini-services/model-service/task_manager.py     (demo mode, MP4 export params)
mini-services/model-service/test_model_config.py (NEW — 18 tests)
src/app/api/videos/[id]/route.ts                (NEW — GET sync + DELETE cancel)
src/app/api/videos/[id]/retry/route.ts          (NEW)
src/app/api/videos/stream/[messageId]/route.ts  (NEW — Range streaming proxy)
src/app/api/chats/[id]/messages/route.ts        (runner wiring, attachment validation)
src/lib/generation-runner.ts                    (attachment passthrough)
src/lib/video-gen.ts                            (stream URLs, demo-mode acceptance)
src/lib/constants.ts                            (WS_URL default)
README.md                                       (docs match reality)
FIXES.md                                        (this file)
```

## Verification

- `python -m pytest test_guardrails.py` → **37 passed**
- `python -m pytest test_model_config.py` → **18 passed**
- `python -m pytest test_rag_corpus.py` → **19 passed**
- `npx tsc --noEmit` → **0 errors**
- `npx next build` → **success**, all three new routes registered
- End-to-end demo-mode smoke test: submit RAG payload → queued → generated →
  `ready` with valid h264/yuv420p MP4 streamed back.

## Tuning cheat-sheet (quality vs. speed)

| Goal | Env vars |
|------|----------|
| Better quality (distilled/AIO model) | `WAN_NUM_STEPS=6` (or 8), keep `WAN_GUIDANCE_SCALE=1` |
| 720p output | `WAN_WIDTH=1280 WAN_HEIGHT=720 WAN_FLOW_SHIFT=5` (slower, more VRAM) |
| Standard 1.3B max quality | `WAN_NUM_STEPS=50` |
| Faster (standard model) | `WAN_CACHE_THRESHOLD=0.1` (First-Block Cache) |
| Reproducible tests | `WAN_SEED=42` |
| Disable beta scheduler | `WAN_DISTILLED_BETA=0` |

---

# v2 — RTX 5070 (8GB VRAM + 24GB RAM) Hardening

Deep-research-driven upgrade targeting the user's exact hardware
(RTX 5070, Blackwell sm_120, 8GB VRAM, 24GB RAM). Six new capabilities,
all verified by tests below.

## 2.1 RTX 50-series (Blackwell) compatibility guard — NEW `gpu_check.py`

**The bug class:** RTX 50-series GPUs need PyTorch compiled with CUDA 12.8+
(`cu128`, torch ≥ 2.7). With any other wheel, `torch.cuda.is_available()`
still returns True — then every real kernel fails with
`CUDA error: no kernel image is available for execution on the device`,
surfacing as weak/slow/garbage video or a silent demo fallback. This is the
single most-reported RTX 5070 issue.

**Fix:** `gpu_check.py` detects compute capability 12.x, checks
`torch.cuda.get_arch_list()` for sm_120 kernels AND runs a live 32×32 matmul
probe (catches driver/wheel problems static checks miss). `wan_inference`
calls it at load: on failure the service reports the exact pip command and
stays in demo mode (no garbage generations). `/health` exposes a `gpu` block;
`python gpu_check.py` prints a full report standalone.

## 2.2 Anti-disturbance post-processing — NEW `video_polish.py`

**The bug class:** even with correct generation settings, diffusion VAE
decodes carry frame-to-frame brightness pulsing + temporal grain — the
"soo much disturbance" look.

**Fix:** an ffmpeg polish chain runs on every real video after export,
before audio muxing: `hqdn3d` (spatio-temporal denoise) → `deflicker`
(luma stabilization) → `unsharp` (micro-contrast restore) → gentle `eq`
saturation/contrast lift. CPU-only (~3s), zero VRAM, never raises (any
failure keeps the original file), atomically replaces output only with a
valid encode. Presets via `HANVID_POLISH_STRENGTH=light|standard|strong`,
master switch `HANVID_POLISH=0/1` (default on). Falls back to a
deflicker-less chain on old ffmpeg builds.

## 2.3 CUDA OOM auto-recovery ladder (wan_inference.py)

**The bug class:** on an 8GB card a task that exceeds VRAM died mid-way
with a cryptic `CUDA out of memory` traceback — user loses minutes of work.

**Fix:** `_generate_with_oom_recovery()` retries up to `WAN_OOM_RETRIES=2`
times: attempt 1 drops frame count ~20% (4k+1 rule preserved), attempt 2
also scales resolution down (~75%, /16-aligned). Returns the *actual* final
width/height/frames so the export metadata always matches the frames.
Matches OOM via `torch.cuda.OutOfMemoryError` or message text (old torch).
Also logs peak VRAM per generation for tuning.

## 2.4 Blackwell dtype auto-selection (wan_inference.py)

`WAN_DTYPE=auto` (default) → bfloat16 transformer on sm_9.0+ (Blackwell),
float16 elsewhere. Embeddings are cast to the transformer dtype (avoids
dtype-mismatch exceptions on newer diffusers). VAE stays fp32 (unchanged,
mandatory). `effective_settings()`/`/health` now report dtype + polish.

## 2.5 Pre-flight doctor — NEW `verify_setup.py`

One command that validates the whole real-generation path: Python version →
Blackwell kernel probe → VRAM/RAM vs the 8GB+24GB reference →
diffusers/transformers/accelerate/scipy/sentencepiece/safetensors →
imageio/ffmpeg → model weights presence → disk space → effective settings.
Exit code 0 = ready; every failure prints its exact fix.

## 2.6 Dependency corrections (requirements.txt)

- **scipy** added — required for the beta-sigma scheduler of distilled
  checkpoints (was silently optional; Rapid generations without it fell
  back to plain shifted sigmas).
- **sentencepiece** added — UMT5 tokenizer requirement.
- **safetensors** pinned explicitly for single-file checkpoint loads.
- Install doc rewritten around the mandatory cu128 wheel for RTX 50-series.

## 2.7 Security

Live `.env` (Supabase credentials) is **excluded** from the distributed zip;
`.env.example` ships instead. (Rotate the old keys anyway — they previously
shipped in v1's archive.)

## New/changed files (v2)

```
mini-services/model-service/gpu_check.py       (NEW — Blackwell/VRAM guard)
mini-services/model-service/video_polish.py    (NEW — anti-disturbance pass)
mini-services/model-service/verify_setup.py    (NEW — pre-flight doctor)
mini-services/model-service/wan_inference.py   (guard hook, OOM ladder,
                                                 dtype auto, embeds cast)
mini-services/model-service/task_manager.py    (polish stage after export)
mini-services/model-service/server.py          (/health gpu block)
mini-services/model-service/requirements.txt   (cu128 instructions, scipy,
                                                 sentencepiece, safetensors)
RTX5070_TUNING.md                              (NEW — deep tuning guide)
LAUNCH_PLAYBOOK.md                             (NEW — launch/fame strategy)
.env.example                                   (NEW — credential-free template)
```

## Verification (v2)

- `py_compile` on all new/changed modules — clean (no SyntaxWarnings).
- `test_model_config.py` → **18 passed**; `test_guardrails.py` →
  **37 passed**; `test_rag_corpus.py` → **19 passed** (all still green).
- Import smoke test without torch/diffusers (demo-mode path) — all modules
  import cleanly; `effective_settings()` reports dtype + polish.
- `gpu_check.py` standalone — graceful no-GPU report with exact fix text.
- `verify_setup.py` full run — correct PASS/FAIL/WARN per check, exact fix
  commands, exit code logic verified.
- `video_polish.py` end-to-end on a synthetic noisy+flickering 832x480
  16fps h264 clip — polished OK; codec/pix_fmt/fps/duration/resolution
  preserved; atomic replace verified; graceful fallback path exercised.
