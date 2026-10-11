# RTX 5070 (8GB VRAM + 24GB RAM) — Deep Tuning Guide

This is the operating manual for running Hanvid's real video generation on an
RTX 5070. It covers the exact stack you must install, the settings that
control accuracy, how the "disturbance" (flicker/noise) is removed, and what
to do when something goes wrong.

---

## 1. The mandatory stack (get this wrong and nothing else matters)

Your RTX 5070 is a **Blackwell** GPU — compute capability 12.0 (`sm_120`).
That has exactly one hard requirement:

> **PyTorch must be the CUDA 12.8 build (`cu128`), torch ≥ 2.7.**

Any other wheel (the default `pip install torch`, cu121, cu124) will either
report "no CUDA" or — far worse — report CUDA as available and then fail on
the first real kernel with:

```
RuntimeError: CUDA error: no kernel image is available for execution on the device
```

On this stack that bug looks like: *weak, disturbed, slow video* or silent
demo-mode fallback. It is the **#1 RTX 50-series bug** and Hanvid now detects
it at startup (`gpu_check.py`) instead of letting you generate garbage.

```bash
# 1. NVIDIA driver: 572.xx or newer (Game Ready or Studio).
# 2. Python 3.12, then:
pip uninstall -y torch
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
# 3. Prove it before generating:
python verify_setup.py        # must end with ✅ ALL CHECKS PASSED
```

`verify_setup.py` checks: Python version → torch/CUDA/Blackwell kernel probe
(a real 32x32 matmul on the GPU) → VRAM/RAM budget → diffusers, transformers,
accelerate, scipy, sentencepiece, safetensors → ffmpeg → model weights →
disk space → the exact effective generation settings.

---

## 2. Where your 8GB + 24GB actually goes

| Component | Lives in | Size (approx.) | Notes |
|---|---|---|---|
| UMT5-XXL text encoder | **RAM** (bf16) | ~11 GB | Pre-encodes prompts on CPU; never touches VRAM |
| Wan 1.3B transformer (fp16) | VRAM ↔ RAM streaming | ~3 GB | Sequential offload shuttles layer groups |
| Phr00t 14B-Rapid transformer | VRAM ↔ RAM streaming | ~14 GB (fp16) | Runs, but layer-by-layer — expect slower steps |
| VAE decoder | VRAM (fp32) | ~0.5 GB | Tiled + sliced; fp32 is mandatory for clean decodes |
| Activations @ 832x480x81f | VRAM | 2.5–4 GB | The main quality-vs-memory knob |
| ffmpeg polish stage | CPU | 0 | Deflicker/denoise/sharpen — no VRAM at all |
| headroom target | — | **≥ 0.8 GB free** | Below this, OOM retries kick in |

**RAM rule:** 24GB is the sweet spot — the text encoder + offload queues fit
comfortably. Keep big browser tabs closed anyway; page faults during layer
offload show up as multi-second stalls.

---

## 3. Two model paths — when to use which

| | **Standard 1.3B** (hub model) | **Phr00t Rapid 14B** (Mega-v3 AIO) |
|---|---|---|
| Speed on 8GB | ~2–5 min / 5s clip | ~1–3 min / 5s clip (4 steps) |
| Accuracy/prompt fidelity | Highest (CFG + negative prompt) | High (distilled, CFG-free) |
| Settings | 35 steps, CFG 5.0, UniPC, shift 3.0 | 4 steps, CFG **1.0**, beta sigmas, shift 8.0 |
| Negative prompt | ON (official Wan negative) | **OFF** (applying CFG burns/distorts it) |
| Best for | Finals, "make it accurate" | Drafts, iteration, live demos |

The service auto-detects which one is loaded (checkpoint filename → distilled
flag) and switches settings accordingly. You never tune this by hand — the
root cause of your original weak videos was exactly this mismatch (standard
model running at distilled settings).

**Download the Rapid checkpoint:**
```bash
python download_model.py      # → models/Mega-v3/wan2.2-rapid-mega-aio-v3.safetensors
```

---

## 4. Accuracy tuning — the settings that actually matter

Ordered by impact. All are env vars (set them in the model-service shell or
your `.env`):

1. **Resolution — `WAN_WIDTH` / `WAN_HEIGHT` (default 832x480)**
   Stay at native 480p. Below-native (e.g. 640x352) is the classic "soft,
   weak" look; above native (1280x720) on 8GB VRAM triggers OOM retries and
   the model didn't train there — detail is invented, not recovered.

2. **Steps — `WAN_NUM_STEPS` (35 standard / 4 distilled)**
   Standard model: 30 is usable, 35 is the sweet spot, 45–50 adds marginal
   detail at big time cost. Distilled: **keep 4** — more steps does not help
   a CFG-free student model, it drifts.

3. **Guidance — `WAN_GUIDANCE_SCALE` (5.0 standard / 1.0 distilled)**
   Standard: 5.0 is the official value. 6–7 = more prompt-faithful but
   riskier saturation/burning. **Never** raise guidance on a distilled
   checkpoint — the service now force-clamps it to 1.0 even if asked.

4. **Frames — `WAN_NUM_FRAMES` (81 = 5s @16fps, must be 4k+1)**
   Shorter clips = fewer chances for drift to accumulate. For your most
   accurate results: 49–81 frames. Long, single-take motion is the hardest
   thing for a 1.3B model — cut instead.

5. **Seed — `WAN_SEED`**
   Default `random` (each video differs). Set a fixed seed to iterate a
   prompt deterministically: change ONE thing (word, step count) and the
   seed makes the comparison meaningful. This is how you debug accuracy.

6. **Scheduler** — auto-selected per checkpoint (UniPC/shift 3.0 vs
   Euler/beta/shift 8.0). Requires `scipy` for beta sigmas — it's in
   requirements.txt now.

7. **`WAN_OOM_RETRIES` (default 2)** — if VRAM runs out mid-generation, the
   ladder auto-drops frames ~20%, then resolution, instead of killing the
   task. If you see the "auto-recovering" log line often, lower
   `WAN_NUM_FRAMES` or close GPU apps.

8. **`WAN_DTYPE` (auto)** — bf16 on Blackwell, fp16 elsewhere. bf16 is
   slightly more resistant to rounding drift in the long attention chains —
   leave it on auto unless you're chasing reproducibility against an older
   fp16 output.

---

## 5. Killing the "disturbance" — the three-layer fix

Disturbance = temporal flicker + per-frame noise + softness. Hanvid now
attacks it at three layers:

**Layer 1 — Generation (root cause, fixed in v1):** correct
steps/CFG/scheduler/negative-prompt per checkpoint, fp32 VAE, bf16 text
encoding, native resolution. Wrong CFG on a distilled model is what
over-saturates and "breathes".

**Layer 2 — Post-processing (`video_polish.py`, new in v2):** every real
video automatically runs through an ffmpeg chain, ~3 seconds of CPU time:

```
hqdn3d (spatio-temporal denoise) → deflicker (luma stabilization)
→ unsharp (micro-contrast restore) → eq (gentle saturation lift)
```

- Master switch: `HANVID_POLISH=1|0` (default on)
- Strength: `HANVID_POLISH_STRENGTH=light|standard|strong` (default standard)
- Standalone: `python video_polish.py any_video.mp4 strong`
- It never raises and never blocks delivery — on any failure the original
  file is kept.

**Layer 3 — Prompting (see `rag-data/motion_stability.md` in the app):**
- One lighting description ("soft golden-hour side light") — mixed lighting
  is the top flicker trigger.
- One camera instruction ("slow dolly-in, locked-off tripod") — camera +
  subject motion together is the second.
- Shorter clips, one action per clip.

---

## 6. Performance expectations (8GB, 480p, 81 frames)

| Scenario | Approx. wall time |
|---|---|
| Prompt encoding (CPU, UMT5 bf16) | 5–20 s |
| Standard 1.3B, 35 steps | 2–5 min |
| Rapid 14B, 4 steps | 1–3 min |
| VAE decode (tiled, fp32) | 15–40 s |
| Polish + audio | 5–30 s |

If a single step takes >30s: (a) you're on the 14B path — expected; (b) some
other app holds VRAM (check Task Manager → GPU → Dedicated GPU memory);
(c) `verify_setup.py` to rule out a kernel problem.

---

## 7. Troubleshooting map

| Symptom | Cause | Fix |
|---|---|---|
| "no kernel image is available" | cu121/cu124 torch wheel | Reinstall `--index-url .../whl/cu128` |
| Videos weak/slow but /health says real | CPU-only torch build | Same as above; run `python gpu_check.py` |
| mode=demo, reason "GPU incompatible" | Blackwell arch check failed | Fix torch, restart service |
| `CUDA out of memory` mid-task | Other GPU apps / frames too high | Auto-retried now; lower WAN_NUM_FRAMES |
| Flicker/pulsing brightness | VAE decode noise | Polish (default on); `strong` if needed |
| Over-saturated, "melting" motion | CFG on distilled model | Impossible now (auto-clamped) |
| Soft/washed output | Below-native resolution | Stay 832x480 |
| Grainy static-y noise | Temporal noise | `HANVID_POLISH_STRENGTH=strong` |
| MMAudio OOM after video | VRAM not freed | v1 unload fix handles it; re-run |
| First gen after boot is slow | Cold HF cache / CUDA JIT | Normal; second gen is faster |

**Always start debugging with:**
```bash
python verify_setup.py     # hardware + stack + models, with exact fixes
curl localhost:3004/health | jq    # mode, settings, gpu block, queue
```
