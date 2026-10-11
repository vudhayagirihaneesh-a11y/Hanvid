"""wan_inference.py — Wan2.1-T2V-1.3B / Wan2.2-Rapid model loader + inference wrapper.

This module is *defensive*: it tries to import the heavy ML stack (torch,
diffusers, transformers) inside try/except blocks. If anything is missing
(e.g. the service is running on a CPU-only sandbox), the module still imports
cleanly and exposes a `WanModel` class whose `loaded` attribute is False.
The rest of the service can then transparently fall back to demo generation.

Environment variables (all optional):
  WAN_MODEL_PATH     — local directory that contains the model weights.
                       Two layouts are supported:
                         a) a diffusers pipeline folder (model_index.json, ...)
                         b) a plain folder holding a single-file checkpoint
                            (e.g. the Phr00t "AIO" safetensors downloaded by
                            download_model.py into models/Mega-v3/)
  WAN_SAFETENSORS    — name/path of the single-file transformer checkpoint.
                       Default: models/Mega-v3/wan2.2-rapid-mega-aio-v3.safetensors
                       (Phr00t WAN2.2-14B-Rapid-AllInOne, Mega v3).
                       If the filename contains `rapid` / `lightx2v` / `distill`
                       the server automatically switches to CFG-free settings
                       (guidance 1.0, no negative prompt, 4 steps).
                       NOTE: distilled detection only applies when the
                       transformer is REALLY loaded from that file — a plain
                       HuggingFace load of Wan-AI/Wan2.1-T2V-1.3B-Diffusers is
                       always treated as the standard model (this mismatch
                       previously produced weak, noisy, disturbed videos).
  WAN_BASE_PIPELINE  — diffusers repo id / local path used for the non-
                       transformer components (VAE, UMT5 text encoder,
                       tokenizer) when loading a single-file transformer.
                       Default: Wan-AI/Wan2.1-T2V-1.3B-Diffusers (the VAE and
                       UMT5-XXL are shared by the Wan2.2 A14B checkpoints).
  WAN_DISABLE_MODEL  — "1" / "true" to skip model loading entirely (force demo).

Generation-quality env vars:
  WAN_NUM_STEPS      — diffusion steps. Auto: 4 for Rapid/distilled
                       checkpoints (official Mega-v3 recommendation), 35 for
                       the standard model.
  WAN_GUIDANCE_SCALE — CFG scale. Auto: 1.0 for Rapid/distilled (they are
                       CFG-free — applying CFG on them causes burning,
                       deformed output), 5.0 for the standard model.
  WAN_SEED           — fixed seed, or "random" (default) for a fresh seed
                       per video.
  WAN_FLOW_SHIFT     — scheduler flow shift. Auto: 8.0 for distilled/AIO
                       checkpoints (official Mega-v3 workflow value),
                       3.0 for the standard 1.3B model at 480p.
  WAN_DISTILLED_BETA — "1" (default): use beta sigma spacing (the "beta"
                       scheduler ComfyUI recommends for Mega v3) when scipy is
                       available; "0" to force plain shifted sigmas.
  WAN_WIDTH /
  WAN_HEIGHT         — output resolution. Default 832x480 (the native 480p
                       training resolution of both the 1.3B model and the
                       Wan2.2 A14B checkpoints — generating below-native
                       resolution produced soft, weak output).
  WAN_NUM_FRAMES     — frames to generate (must be 4k+1). Default 81 (5s @16fps).
  WAN_CACHE_THRESHOLD— First-Block Cache aggressiveness (default 0, disabled).
                       Ignored for distilled checkpoints.
  WAN_DTYPE          — "auto" (default): bfloat16 on RTX 50-series Blackwell
                       GPUs, float16 everywhere else. Also accepts "bf16",
                       "fp16", "fp32". bf16 on Blackwell avoids fp16
                       rounding drift in long attention chains.
  WAN_OOM_RETRIES    — automatic out-of-memory recovery attempts (default 2).
                       On CUDA OOM the retry ladder first drops the frame
                       count ~20% (keeping the 4k+1 rule), then also scales
                       the resolution down — the video finishes instead of
                       the task dying with a cryptic CUDA error.

Hardware guard:
  On startup `gpu_check.check_gpu_compatibility()` detects RTX 50-series
  (Blackwell, sm_120) GPUs and verifies the installed PyTorch actually has
  sm_120 kernels (requires the cu128 wheel / torch >= 2.7). An incompatible
  build is the #1 cause of "weak, disturbed, slow" video on new RTX 50
  cards — the service reports it clearly and stays in demo mode instead of
  producing garbage.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
from typing import Any, Optional

os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

class GenerationCancelled(RuntimeError):
    """Raised when generation is cancelled mid-flight."""
    pass


logger = logging.getLogger("wan_inference")

MODEL_ID = os.environ.get("WAN_MODEL_ID", "Wan-AI/Wan2.2-T2V-A14B-Diffusers").strip()
DEFAULT_SAFETENSORS = os.path.join("models", "Mega-v3", "wan2.2-rapid-mega-aio-v3.safetensors")

# Checkpoint name fragments that identify CFG-distilled ("Rapid"/Lightx2V)
# models. These models are trained WITHOUT classifier-free guidance: running
# them with guidance_scale > 1 and a negative prompt over-guides them and
# produces the classic "burning", over-saturated, deformed output.
DISTILLED_KEYWORDS = ("rapid", "lightx2v", "nocfg", "no-cfg", "no_cfg", "distill")

# Official Wan negative prompt with explicit anti-hallucination and stability guardrails:
# suppresses blur, distortions, bad anatomy, warping, morphing, and deep-dream artifacts.
NEGATIVE_PROMPT = (
    "Bright tones, overexposed, static, blurred details, subtitles, style, works, "
    "paintings, images, static, overall gray, worst quality, low quality, JPEG "
    "compression residue, ugly, incomplete, extra fingers, poorly drawn hands, "
    "poorly drawn faces, deformed, disfigured, misshapen limbs, melted geometry, "
    "morphing objects, warping lines, psychedelic, deep dream, neon edge glow, "
    "noisy, grainy, flickering, low resolution, motion blur, artifact"
)

# --- Optional heavy-ML imports (guarded so the service always starts) -------
_torch: Optional[Any] = None
_diffusers: Optional[Any] = None
WanPipeline: Optional[Any] = None
AutoencoderKLWan: Optional[Any] = None
WanTransformer3DModel: Optional[Any] = None

try:  # pragma: no cover - environment dependent
    import torch as _torch_mod  # type: ignore

    _torch = _torch_mod
    logger.info("torch %s detected", _torch.__version__)
except Exception as exc:  # ImportError / subprocess issues / CUDA init, etc.
    logger.warning("torch unavailable (%s) — service will run in demo mode.", exc)

# Guard against Windows Application Control blocking sklearn/scipy DLLs
try:
    import types
    import importlib.machinery

    mock_sklearn = types.ModuleType("sklearn")
    mock_sklearn.__path__ = []
    mock_sklearn.__package__ = "sklearn"
    mock_sklearn.__spec__ = importlib.machinery.ModuleSpec("sklearn", None, is_package=True)

    mock_metrics = types.ModuleType("sklearn.metrics")
    mock_metrics.__path__ = []
    mock_metrics.__package__ = "sklearn.metrics"
    mock_metrics.__spec__ = importlib.machinery.ModuleSpec("sklearn.metrics", None, is_package=False)
    mock_metrics.roc_curve = lambda *args, **kwargs: (None, None, None)

    mock_sklearn.metrics = mock_metrics
    sys.modules["sklearn"] = mock_sklearn
    sys.modules["sklearn.metrics"] = mock_metrics
except Exception:
    pass

try:  # pragma: no cover - environment dependent
    from diffusers import (  # type: ignore
        AutoencoderKLWan as _AutoencoderKLWan,
        WanPipeline as _WanPipeline,
        WanTransformer3DModel as _WanTransformer3DModel,
    )

    WanPipeline = _WanPipeline
    AutoencoderKLWan = _AutoencoderKLWan
    WanTransformer3DModel = _WanTransformer3DModel
    _diffusers = True
    logger.info("diffusers detected — real Wan2.1 generation is possible.")
except Exception as exc:
    logger.warning("diffusers unavailable (%s) — service will run in demo mode.", exc)

# Ensure sibling modules (gpu_check, video_polish) resolve no matter the CWD.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:  # pragma: no cover - environment dependent
    import gpu_check  # type: ignore
except Exception as exc:
    gpu_check = None  # type: ignore[assignment]
    logger.warning("gpu_check unavailable (%s) — hardware guard disabled", exc)


def _env_int(name: str, default: Optional[int] = None) -> Optional[int]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid %s=%r — using default", name, raw)
        return default


def _env_float(name: str, default: Optional[float] = None) -> Optional[float]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Invalid %s=%r — using default", name, raw)
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _candidate_paths() -> list[str]:
    """All plausible locations of the single-file transformer checkpoint.

    Handles the historical footguns:
      * WAN_SAFETENSORS already contains the `models/...` prefix while
        WAN_MODEL_PATH also gets joined in front (old code produced
        models/models/Mega-v3/... and then silently fell back to demo mode).
      * Absolute vs relative checkpoint paths.
      * Service launched from a different CWD than model-service/.
    """
    model_path = os.environ.get("WAN_MODEL_PATH", "").strip()
    safetensors = os.environ.get("WAN_SAFETENSORS", "").strip() or DEFAULT_SAFETENSORS
    here = os.path.dirname(os.path.abspath(__file__))

    candidates: list[str] = []
    if os.path.isabs(safetensors):
        candidates.append(safetensors)
    else:
        # 1) As written, relative to CWD (matches download_model.py output).
        candidates.append(safetensors)
        # 2) Relative to the service directory (launch.py chdirs here).
        candidates.append(os.path.join(here, safetensors))
        # 3) Joined with WAN_MODEL_PATH (classic layout).
        if model_path:
            candidates.append(os.path.join(model_path, safetensors))
            # 4) Only the filename inside WAN_MODEL_PATH.
            candidates.append(os.path.join(model_path, os.path.basename(safetensors)))
        # 5) models/ folder conventions inside WAN_MODEL_PATH / the service dir.
        candidates.append(os.path.join(model_path or here, "models", os.path.basename(safetensors)))
    # Dedupe while keeping order.
    seen: set[str] = set()
    out: list[str] = []
    for c in candidates:
        c = os.path.normpath(c)
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def resolve_checkpoint() -> Optional[str]:
    """First existing single-file checkpoint path (absolute), or None.

    The distilled/Rapid detection is only trusted when the transformer is
    ACTUALLY loaded from this file. When no checkpoint file exists the
    pipeline is loaded from HuggingFace (Wan-AI/Wan2.1-T2V-1.3B-Diffusers),
    which is the *standard* model and must run with standard settings.
    """
    for c in _candidate_paths():
        if os.path.isfile(c):
            return os.path.abspath(c)
    return None


def checkpoint_is_distilled(checkpoint_path: Optional[str]) -> bool:
    """True only when a real single-file distilled checkpoint will be used."""
    if not checkpoint_path:
        return False
    name = os.path.basename(checkpoint_path).lower()
    return any(kw in name for kw in DISTILLED_KEYWORDS)


def get_wan_cached_snapshot() -> Optional[str]:
    """Find local cached diffusers snapshot containing configs, tokenizer, and vae."""
    hf_hub = os.path.expanduser("~/.cache/huggingface/hub")
    for repo_name in [
        "models--Wan-AI--Wan2.2-T2V-A14B-Diffusers",
        "models--Wan-AI--Wan2.1-T2V-1.3B-Diffusers",
        "models--Wan-AI--Wan2.1-VACE-14B-diffusers",
    ]:
        snapshots_dir = os.path.join(hf_hub, repo_name, "snapshots")
        if os.path.isdir(snapshots_dir):
            for snap in os.listdir(snapshots_dir):
                snap_path = os.path.join(snapshots_dir, snap)
                if os.path.isdir(snap_path) and os.path.isfile(os.path.join(snap_path, "model_index.json")):
                    return snap_path
    return None


class WanModel:
    """Lazy, resilient wrapper around the diffusers WanPipeline.

    Use `is_available()` to check whether the heavy stack + CUDA device
    are present, and `generate(prompt, on_progress)` to run inference.
    """

    def __init__(self) -> None:
        self.pipeline: Optional[Any] = None
        self.loaded: bool = False
        self.mode: str = "demo"
        self.device: str = "cpu"
        self.last_error: Optional[str] = None
        # Effective generation settings (filled during load()).
        self.is_distilled: bool = False
        self.checkpoint_path: Optional[str] = None
        self.default_num_steps: int = 35
        self.default_guidance: float = 5.0
        self.flow_shift: float = 3.0
        self.uses_negative_prompt: bool = True
        self.default_width: int = 832
        self.default_height: int = 480
        # Only one generation may use the GPU at a time (8GB VRAM).
        self._gpu_lock = threading.Lock()
        self._text_encoder: Optional[Any] = None
        self._negative_embeds: Optional[Any] = None
        # Transformer dtype (bf16 on Blackwell, fp16 elsewhere) — set in load().
        self._model_dtype: Optional[Any] = None
        # Hardware compatibility report from the last load() (gpu_check).
        self.gpu_info: Optional[dict] = None

    # ------------------------------------------------------- text encoding
    MAX_SEQ_LEN = 512

    def _encode_prompt(self, text: str):
        """Encode a prompt with the CPU-resident UMT5 encoder.

        To prevent CPU RAM from exceeding physical memory when the 14B transformer
        is loaded, the text encoder is loaded on-demand from AIO weights in bfloat16,
        encodes the prompt, and is immediately freed with gc.collect(). Results are cached.
        """
        assert _torch is not None
        if not hasattr(self, "_prompt_embed_cache"):
            self._prompt_embed_cache = {}
        if text in self._prompt_embed_cache:
            return self._prompt_embed_cache[text]

        try:
            from diffusers.pipelines.wan.pipeline_wan import prompt_clean  # type: ignore

            cleaned_text = prompt_clean(text)
        except Exception:
            cleaned_text = " ".join(text.split())

        tok = self.pipeline.tokenizer(
            [cleaned_text],
            padding="max_length",
            max_length=self.MAX_SEQ_LEN,
            truncation=True,
            add_special_tokens=True,
            return_attention_mask=True,
            return_tensors="pt",
        )

        if self._text_encoder is not None:
            with _torch.inference_mode():
                hidden = self._text_encoder(
                    tok.input_ids.to(self._text_encoder.device),
                    tok.attention_mask.to(self._text_encoder.device)
                ).last_hidden_state
        else:
            snap = get_wan_cached_snapshot()
            if not snap or not self.checkpoint_path or not os.path.isfile(self.checkpoint_path):
                raise RuntimeError("Cannot encode prompt: missing cached config or checkpoint")

            import json
            import struct
            from transformers import UMT5EncoderModel, AutoConfig
            import gc

            class DirectSafeTensorsReader:
                """Read safetensors tensors on Windows without CreateFileMapping/pagefile commitment."""
                def __init__(self, path: str):
                    self.f = open(path, "rb")
                    header_len = struct.unpack("<Q", self.f.read(8))[0]
                    self.header = json.loads(self.f.read(header_len).decode("utf-8"))
                    self.data_base = 8 + header_len
                    self.dtype_map = {
                        "F16": _torch.float16,
                        "BF16": _torch.bfloat16,
                        "F32": _torch.float32,
                        "F8_E4M3": _torch.float8_e4m3fn,
                    }

                def keys(self):
                    return self.header.keys()

                def get_tensor(self, key: str):
                    info = self.header[key]
                    s, e = info["data_offsets"]
                    self.f.seek(self.data_base + s)
                    raw = self.f.read(e - s)
                    dt = self.dtype_map.get(info["dtype"], _torch.float16)
                    return _torch.frombuffer(raw, dtype=dt).reshape(info["shape"]).clone()

                def close(self):
                    self.f.close()

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    self.close()

            config = AutoConfig.from_pretrained(os.path.join(snap, "text_encoder"), local_files_only=True)
            with _torch.device("meta"):
                meta_te = UMT5EncoderModel(config).to(dtype=_torch.bfloat16)
            te = meta_te.to_empty(device="cpu")

            prefix = "text_encoders.umt5xxl.transformer."
            with DirectSafeTensorsReader(self.checkpoint_path) as handle:
                scales = {}
                for k in handle.keys():
                    if k.startswith(prefix) and k.endswith(".scale_weight"):
                        scales[k[len(prefix):-len(".scale_weight")]] = handle.get_tensor(k)

                named_params = dict(te.named_parameters())
                for name, param in named_params.items():
                    aio_key = prefix + name
                    if aio_key not in handle.keys():
                        if name in ("encoder.embed_tokens.weight", "shared.weight"):
                            aio_key = prefix + "shared.weight"
                    if aio_key in handle.keys():
                        tensor = handle.get_tensor(aio_key)
                        clean = aio_key[len(prefix):]
                        scale_key = clean[:-len(".weight")] if clean.endswith(".weight") else clean
                        if scale_key in scales:
                            tensor = (tensor.to(_torch.bfloat16) * scales[scale_key]).to(_torch.bfloat16)
                        elif clean in scales:
                            tensor = (tensor.to(_torch.bfloat16) * scales[clean]).to(_torch.bfloat16)
                        else:
                            tensor = tensor.to(_torch.bfloat16)
                        with _torch.no_grad():
                            param.copy_(tensor)
                        del tensor

            with _torch.inference_mode():
                hidden = te(tok.input_ids, tok.attention_mask).last_hidden_state

            del te, meta_te
            gc.collect()

        n = int(tok.attention_mask.sum().item())
        dtype = self._model_dtype or _torch.float16
        hidden = hidden[0, :n].to(dtype)
        out = hidden.new_zeros(self.MAX_SEQ_LEN, hidden.size(-1))
        out[:n] = hidden
        embeds = out.unsqueeze(0)
        self._prompt_embed_cache[text] = embeds
        return embeds

    # ------------------------------------------------------------------ utils
    def is_available(self) -> bool:
        """True only if torch, diffusers and a CUDA GPU are present."""
        if os.environ.get("WAN_DISABLE_MODEL", "").lower() in ("1", "true", "yes"):
            return False
        if _torch is None or _diffusers is None:
            return False
        try:
            return bool(_torch.cuda.is_available())
        except Exception:
            return False

    # ------------------------------------------------------------- scheduler
    def _make_distilled_scheduler(self) -> Optional[Any]:
        """Scheduler for CFG-distilled (Rapid / AIO) checkpoints.

        ComfyUI reference workflow for Phr00t Mega-v3: sampler ipndm,
        scheduler `beta`, 4 steps, ModelSamplingSD3 shift 8.
        The closest diffusers equivalent is FlowMatchEulerDiscreteScheduler
        with beta sigma spacing (fallback: plain shifted sigmas).

        Diffusers renamed the `flow_shift` init arg to `shift` in newer
        releases — `from_config(..., flow_shift=...)` silently DROPPED the
        value (effective shift 1.0, badly degraded output). We therefore
        build the scheduler with a version-tolerant kwarg cascade.
        """
        assert _torch is not None
        from diffusers import FlowMatchEulerDiscreteScheduler  # type: ignore

        use_beta = _env_bool("WAN_DISTILLED_BETA", True) and self.flow_shift >= 8.0
        if use_beta:
            try:
                import scipy  # noqa: F401

                for kw_name in ("shift", "flow_shift"):
                    try:
                        sched = FlowMatchEulerDiscreteScheduler(
                            num_train_timesteps=1000,
                            use_beta_sigmas=True,
                            **{kw_name: float(self.flow_shift)},
                        )
                        logger.info("Distilled scheduler: Euler + beta sigmas (%s=%.1f)", kw_name, float(self.flow_shift))
                        return sched
                    except TypeError:
                        continue
            except ImportError:
                logger.info("scipy unavailable — beta sigmas disabled, using shift=%.1f", self.flow_shift)
            except Exception as exc:
                logger.warning("Beta-sigma scheduler failed (%s) — falling back to shift", exc)

        for kw_name in ("shift", "flow_shift"):
            try:
                sched = FlowMatchEulerDiscreteScheduler(
                    num_train_timesteps=1000, **{kw_name: float(self.flow_shift)}
                )
                logger.info(
                    "Distilled scheduler: Euler (%s=%.1f)", kw_name, float(self.flow_shift)
                )
                return sched
            except TypeError:
                continue
            except Exception as exc:
                logger.warning("Euler scheduler (%s) failed: %s", kw_name, exc)
                continue
        return None

    def _make_standard_scheduler(self, base_config: Any) -> Optional[Any]:
        """Scheduler for the standard Wan2.1-T2V-1.3B model.

        The official diffusers repo pins UniPCMultistepScheduler with
        prediction_type=flow_prediction, use_flow_sigmas=True and
        flow_shift=3.0 for 480p — keep exactly that.
        """
        from diffusers import UniPCMultistepScheduler  # type: ignore

        try:
            sched = UniPCMultistepScheduler.from_config(
                base_config, flow_shift=float(self.flow_shift)
            )
            logger.info("Standard scheduler: UniPC (flow_shift=%.1f)", float(self.flow_shift))
            return sched
        except Exception as exc:
            logger.warning("Could not apply UniPC flow_shift (%s); using repo default", exc)
            return None

    def _get_model_dtype(self) -> Any:
        assert _torch is not None
        dtype_name = os.environ.get("WAN_DTYPE", "auto").strip().lower()
        if dtype_name in ("", "auto"):
            try:
                cc = _torch.cuda.get_device_capability(0)
            except Exception:
                cc = (8, 6)
            dtype_name = "bf16" if cc[0] >= 9 else "fp16"
        target_dtype = {
            "bf16": _torch.bfloat16,
            "bfloat16": _torch.bfloat16,
            "fp16": _torch.float16,
            "float16": _torch.float16,
            "fp32": _torch.float32,
            "float32": _torch.float32,
        }.get(dtype_name, _torch.float16)
        return target_dtype

    # --------------------------------------------------------------- loading
    def _load_pipeline(self) -> Any:
        """Load the diffusers pipeline, preferring a local single-file checkpoint.

        AIO (All-In-One) checkpoint workflow:
          1. Load the transformer from the local AIO safetensors via
             ``WanTransformer3DModel.from_single_file()``.
          2. Build the rest of the pipeline (VAE, text encoder, tokenizer,
             scheduler) via ``WanPipeline.from_pretrained()`` on the
             canonical HuggingFace repo, passing our locally-loaded
             transformer in.
          3. Missing HF components (text encoder ~11 GB on first run)
             are downloaded automatically — no manual step needed.
        """
        assert _torch is not None
        import gc

        model_path = os.environ.get("WAN_MODEL_PATH", "").strip()
        checkpoint = resolve_checkpoint()
        self.checkpoint_path = checkpoint
        self.is_distilled = checkpoint_is_distilled(checkpoint)

        # Initialize generation settings BEFORE scheduler construction
        if self.is_distilled:
            self.default_num_steps = _env_int("WAN_NUM_STEPS", 6)
            self.default_guidance = _env_float("WAN_GUIDANCE_SCALE", 1.0)
            self.flow_shift = _env_float("WAN_FLOW_SHIFT", 8.0)
            self.uses_negative_prompt = False
            logger.info("Configured rapid distilled model: steps=%d, flow_shift=%.1f", self.default_num_steps, self.flow_shift)
        else:
            self.default_num_steps = _env_int("WAN_NUM_STEPS", 30)
            self.default_guidance = _env_float("WAN_GUIDANCE_SCALE", 5.0)
            self.flow_shift = _env_float("WAN_FLOW_SHIFT", 5.0)
            self.uses_negative_prompt = True

        base_source = os.environ.get("WAN_BASE_PIPELINE", "").strip() or MODEL_ID
        dtype = self._get_model_dtype()

        if (
            checkpoint
            and WanTransformer3DModel is not None
            and checkpoint.lower().endswith((".safetensors", ".pt", ".bin", ".ckpt"))
        ):
            logger.info(
                "Loading transformer from single file: %s (distilled=%s, dtype=%s)",
                checkpoint, self.is_distilled, dtype,
            )
            try:
                snap = get_wan_cached_snapshot()
                from transformers import AutoTokenizer

                # 1. Tokenizer
                if snap and os.path.isdir(os.path.join(snap, "tokenizer")):
                    tokenizer = AutoTokenizer.from_pretrained(os.path.join(snap, "tokenizer"), local_files_only=True)
                else:
                    tokenizer = AutoTokenizer.from_pretrained("Wan-AI/Wan2.2-T2V-A14B-Diffusers", subfolder="tokenizer")

                # 2. VAE (float32 keeps decode quality clean and artifact-free)
                if snap and os.path.isdir(os.path.join(snap, "vae")):
                    vae = AutoencoderKLWan.from_pretrained(os.path.join(snap, "vae"), local_files_only=True, torch_dtype=_torch.float32)
                else:
                    vae = AutoencoderKLWan.from_pretrained("Wan-AI/Wan2.2-T2V-A14B-Diffusers", subfolder="vae", torch_dtype=_torch.float32)

                # 3. Scheduler
                scheduler = (
                    self._make_distilled_scheduler()
                    if self.is_distilled
                    else FlowMatchEulerDiscreteScheduler(num_train_timesteps=1000, shift=5.0)
                )

                # 4. Transformer from single file AIO checkpoint
                trans_cfg = os.path.join(snap, "transformer") if (snap and os.path.isdir(os.path.join(snap, "transformer"))) else None
                transformer = WanTransformer3DModel.from_single_file(
                    checkpoint,
                    config=trans_cfg,
                    torch_dtype=dtype,
                    local_files_only=True if trans_cfg else False,
                )
                logger.info(
                    "Transformer loaded: %.2fB params on %s",
                    sum(p.numel() for p in transformer.parameters()) / 1e9,
                    next(transformer.parameters()).device,
                )
                gc.collect()

                # 5. Assemble WanPipeline with text_encoder=None (on-demand CPU encoding)
                pipe = WanPipeline(
                    tokenizer=tokenizer,
                    text_encoder=None,
                    vae=vae,
                    transformer=transformer,
                    scheduler=scheduler,
                )
                logger.info(
                    "WanPipeline assembled from %s with on-demand text encoding",
                    checkpoint,
                )
                return pipe
            except Exception as exc:
                logger.error(
                    "Single-file checkpoint %s could not be loaded (%s). "
                    "Falling back to the standard %s pipeline.",
                    checkpoint, exc, MODEL_ID,
                )
                self.checkpoint_path = None
                self.is_distilled = False

        # Standard load: prefer WAN_MODEL_PATH when it is a real diffusers
        # pipeline folder, else the hub repo (local cache first, then online).
        source = base_source
        if model_path and os.path.isfile(os.path.join(model_path, "model_index.json")):
            source = model_path
        elif model_path and not checkpoint:
            logger.warning(
                "WAN_MODEL_PATH=%s has no model_index.json and no usable "
                "checkpoint file — loading from %s instead.", model_path, base_source
            )
        logger.info("Loading Wan pipeline from %s ...", source)
        try:
            return WanPipeline.from_pretrained(
                source, torch_dtype=dtype, local_files_only=True
            )
        except Exception as local_exc:
            # Always try online download — the text encoder (~11 GB) is
            # typically missing on first run and must be fetched.
            logger.info(
                "Local cache load failed (%s); downloading missing components from %s...",
                local_exc, source,
            )
            try:
                return WanPipeline.from_pretrained(source, torch_dtype=dtype)
            except Exception as dl_exc:
                logger.error(
                    "Could not download missing components for '%s': %s",
                    source, dl_exc,
                )
                self.last_error = (
                    f"Model '{source}' weights not found locally and download failed ({dl_exc}). "
                    f"Run 'python download_model.py' to cache."
                )
                return None

    def load(self) -> bool:
        """Best-effort model load. Returns True on success, False otherwise.

        MUST NEVER raise — any failure is captured and recorded in
        `last_error` so the service can keep serving in demo mode.
        """
        if not self.is_available():
            self.loaded = False
            self.mode = "demo"
            if _torch is None or _diffusers is None:
                self.last_error = "torch/diffusers not installed"
            elif not _torch.cuda.is_available():
                self.last_error = "no CUDA-capable GPU detected"
            logger.warning(
                "Model load skipped (reason=%s). Running in DEMO mode.",
                self.last_error,
            )
            return False

        try:
            assert _torch is not None  # for type checker

            # ---- hardware guard: RTX 50-series / Blackwell compatibility ---
            if gpu_check is not None:
                try:
                    gpu_info = gpu_check.check_gpu_compatibility(probe=True)
                    self.gpu_info = gpu_info
                    if not gpu_info.get("ok"):
                        fixes = gpu_info.get("fixes") or ["(see gpu_check.py)"]
                        self.last_error = "GPU incompatible: " + "; ".join(
                            gpu_info.get("warnings") or ["unknown"]
                        )
                        logger.error(
                            "GPU COMPATIBILITY FAILURE — real generation is "
                            "DISABLED. Fix (from gpu_check):\n%s\n"
                            "The service keeps running in DEMO mode so the web "
                            "UI stays alive.", fixes[0],
                        )
                        return False
                    if gpu_info.get("is_blackwell"):
                        logger.info(
                            "Blackwell GPU OK: %s (compute %s, torch CUDA %s) — "
                            "sm_120 kernels verified by a live probe.",
                            gpu_info.get("device_name"),
                            gpu_info.get("compute_cap"),
                            gpu_info.get("cuda_build"),
                        )
                except Exception as exc:
                    logger.warning("gpu_check failed to run (%s) — continuing.", exc)

            self.pipeline = self._load_pipeline()
            if self.pipeline is None:
                self.loaded = False
                self.mode = "demo"
                if not self.last_error:
                    self.last_error = f"Wan model ({MODEL_ID}) weights not found. Run 'python download_model.py' to download."
                logger.warning("%s (Running in DEMO mode)", self.last_error)
                return False

            self.device = "cuda"

            # ---- effective generation settings for the loaded checkpoint ----
            if self.is_distilled:
                # CFG-distilled models: guidance MUST be 1.0 (no CFG) and the
                # negative prompt is unused.
                self.default_num_steps = _env_int("WAN_NUM_STEPS", 6)  # type: ignore[assignment]
                self.default_guidance = _env_float("WAN_GUIDANCE_SCALE", 1.0)  # type: ignore[assignment]
                self.flow_shift = _env_float("WAN_FLOW_SHIFT", 8.0)  # type: ignore[assignment]
                self.uses_negative_prompt = False
                logger.info(
                    "Distilled/Rapid checkpoint detected (%s) → steps=%d, guidance=%.2f, "
                    "flow_shift=%.1f, negative prompt OFF",
                    self.checkpoint_path, self.default_num_steps,
                    self.default_guidance, self.flow_shift,
                )
            else:
                # Official Wan 2.2 settings: 30 steps, guidance 5.0, flow_shift 5.0
                self.default_num_steps = _env_int("WAN_NUM_STEPS", 30)  # type: ignore[assignment]
                self.default_guidance = _env_float("WAN_GUIDANCE_SCALE", 5.0)  # type: ignore[assignment]
                self.flow_shift = _env_float("WAN_FLOW_SHIFT", 5.0)  # type: ignore[assignment]
                self.uses_negative_prompt = True
                logger.info(
                    "Standard Wan 2.2 checkpoint → steps=%d, guidance=%.2f, flow_shift=%.1f, "
                    "negative prompt ON",
                    self.default_num_steps, self.default_guidance, self.flow_shift,
                )

            # Resolution: native 480p for both the 1.3B and Wan2.2 A14B
            # checkpoints. The old 640x352 default was below training
            # resolution and produced soft, weak output.
            self.default_width = _env_int("WAN_WIDTH", 832)  # type: ignore[assignment]
            self.default_height = _env_int("WAN_HEIGHT", 480)  # type: ignore[assignment]

            # The UMT5-XXL text encoder: if attached to pipeline, move to CPU;
            # otherwise prompt encoding runs on-demand with zero RAM overhead.
            if hasattr(self.pipeline, "text_encoder") and self.pipeline.text_encoder is not None:
                self._text_encoder = self.pipeline.text_encoder.to(
                    device="cpu", dtype=_torch.bfloat16
                ).eval()
                self.pipeline.text_encoder = None

            # Negative embeddings are only needed when CFG is active.
            if self.uses_negative_prompt:
                self._negative_embeds = self._encode_prompt(NEGATIVE_PROMPT)
            else:
                self._negative_embeds = None

            sched = (
                self._make_distilled_scheduler()
                if self.is_distilled
                else self._make_standard_scheduler(self.pipeline.scheduler.config)
            )
            if sched is not None:
                self.pipeline.scheduler = sched

            # ---- transformer dtype: bf16 on Blackwell, fp16 elsewhere -----
            dtype_name = os.environ.get("WAN_DTYPE", "auto").strip().lower()
            if dtype_name in ("", "auto"):
                try:
                    cc = _torch.cuda.get_device_capability(0)
                except Exception:
                    cc = (8, 6)
                dtype_name = "bf16" if cc[0] >= 9 else "fp16"
            target_dtype = {
                "bf16": _torch.bfloat16,
                "bfloat16": _torch.bfloat16,
                "fp16": _torch.float16,
                "float16": _torch.float16,
                "fp32": _torch.float32,
                "float32": _torch.float32,
            }.get(dtype_name, _torch.float16)
            self._model_dtype = target_dtype
            logger.info(
                "Model dtype: %s (WAN_DTYPE=%s)",
                dtype_name, os.environ.get("WAN_DTYPE", "auto"),
            )

            # Explicit cast to a supported dtype avoids the classic
            # CUBLAS_STATUS_EXECUTION_FAILED on older GPUs.
            self.pipeline.to(dtype=target_dtype)
            # The VAE must be kept in float32 for Wan models; otherwise decoding produces weak/noisy artifacts
            if hasattr(self.pipeline, "vae"):
                self.pipeline.vae.to(dtype=_torch.float32)
            # The 14B model (14GB+ VRAM) instantly crashes an 8GB GPU, so we
            # MUST use sequential offloading to shuttle layers between RAM/VRAM.
            # Crucially: exclude the VAE from sequential sub-module offloading so
            # decoding runs in a single fast, native GPU pass instead of thousands
            # of slow PCIe chunk transfers.
            try:
                self.pipeline._exclude_from_cpu_offload = ["vae"]
                self.pipeline.enable_sequential_cpu_offload()
            except AttributeError:
                # Fallback if diffusers version doesn't support model offload
                self.pipeline.to("cuda")

            if hasattr(self.pipeline, "vae") and hasattr(self.pipeline.vae, "enable_tiling"):
                self.pipeline.vae.enable_tiling()
            if hasattr(self.pipeline, "vae") and hasattr(self.pipeline.vae, "enable_slicing"):
                self.pipeline.vae.enable_slicing()

            # NOTE: attention slicing is intentionally NOT enabled — it forces
            # a slow chunked attention path instead of PyTorch's fused SDPA
            # (flash / mem-efficient) kernels, which are already VRAM-light.

            # Fast matmuls on Ampere+/Blackwell GPUs.
            try:
                _torch.backends.cuda.matmul.allow_tf32 = True
                _torch.backends.cudnn.allow_tf32 = True
                _torch.backends.cudnn.benchmark = True
            except Exception:
                pass

            # First-Block Cache: skips the full transformer on steps where the
            # first block's output barely changes (~1.5-2x faster, minimal
            # quality loss). Tunable via WAN_CACHE_THRESHOLD (0 disables).
            # Only enabled for the standard model — distilled checkpoints are
            # already only a few steps, caching them degrades quality.
            try:
                threshold = float(os.environ.get("WAN_CACHE_THRESHOLD", "0.0"))
                if threshold > 0 and not self.is_distilled and hasattr(self.pipeline.transformer, "enable_cache"):
                    from diffusers.hooks import FirstBlockCacheConfig  # type: ignore

                    self.pipeline.transformer.enable_cache(
                        FirstBlockCacheConfig(threshold=threshold)
                    )
                    logger.info("First-Block Cache enabled (threshold=%.2f)", threshold)
            except Exception as cache_exc:
                logger.warning("Could not enable First-Block Cache: %s", cache_exc)

            self.loaded = True
            self.mode = "real"
            self.last_error = None
            logger.info(
                "Wan pipeline loaded (steps=%d guidance=%.2f flow_shift=%.1f distilled=%s "
                "res=%dx%d).",
                self.default_num_steps, self.default_guidance, self.flow_shift,
                self.is_distilled, self.default_width, self.default_height,
            )
            return True
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            self.loaded = False
            self.mode = "demo"
            self.pipeline = None
            logger.exception("Failed to load Wan2.1 pipeline: %s", exc)
            return False

    def unload(self) -> None:
        """Free GPU memory between generations (called before MMAudio runs).

        The old implementation only called empty_cache() and freed nothing,
        while the task manager relied on it to make room for audio
        generation. This version actually moves any lingering components
        back to the CPU. The pipeline stays loaded — sequential offloading
        re-uploads layers on the next generate() call.
        """
        if self.pipeline is None or _torch is None:
            return
        moved: list[str] = []
        try:
            components = getattr(self.pipeline, "components", None) or {}
            for name, comp in components.items():
                if comp is None or not hasattr(comp, "parameters"):
                    continue
                try:
                    if any(p.is_cuda for p in comp.parameters()):
                        comp.to("cpu")
                        moved.append(name)
                except Exception:
                    continue
        except Exception as exc:
            logger.debug("unload component scan failed: %s", exc)
        try:
            if _torch.cuda.is_available():
                _torch.cuda.empty_cache()
                _torch.cuda.ipc_collect()
        except Exception:
            pass
        if moved:
            logger.info("Wan2.1 components moved off GPU: %s", ", ".join(moved))
        else:
            logger.info("Wan2.1 VRAM cache flushed (nothing resident on GPU).")

    def effective_settings(self) -> dict:
        """Expose the effective generation settings (shown in /health)."""
        return {
            "distilled": self.is_distilled,
            "checkpoint": os.path.basename(self.checkpoint_path) if self.checkpoint_path else MODEL_ID,
            "num_steps": self.default_num_steps,
            "guidance_scale": self.default_guidance,
            "flow_shift": self.flow_shift,
            "negative_prompt": self.uses_negative_prompt,
            "width": self.default_width,
            "height": self.default_height,
            "dtype": str(self._model_dtype) if self._model_dtype is not None else None,
            "polish": os.environ.get("HANVID_POLISH", "1") + ":" + os.environ.get(
                "HANVID_POLISH_STRENGTH", "standard"
            ),
        }

    # ------------------------------------------------- OOM recovery ladder
    def _generate_with_oom_recovery(
        self,
        prompt_embeds,
        negative_embeds,
        num_frames: int,
        guidance_scale: float,
        width: int,
        height: int,
        num_inference_steps: int,
        generator,
        on_step_end,
    ):
        """Run the pipeline, automatically degrading on CUDA OOM.

        Retry ladder (WAN_OOM_RETRIES, default 2):
          attempt 1 → ~20% fewer frames (4k+1 rule preserved)
          attempt 2 → also scale resolution down one notch (÷4/3, /16 align)
        A task that OOMs at full quality finishes at reduced quality instead
        of dying with a cryptic CUDA error — the single most common crash on
        8GB cards.
        """
        assert _torch is not None
        max_retries = _env_int("WAN_OOM_RETRIES", 2) or 0
        attempt = 0
        while True:
            try:
                _torch.cuda.reset_peak_memory_stats()
            except Exception:
                pass
            try:
                output = self.pipeline(
                    prompt=None,
                    prompt_embeds=prompt_embeds,
                    negative_prompt_embeds=negative_embeds,
                    num_frames=num_frames,
                    guidance_scale=guidance_scale,
                    width=width,
                    height=height,
                    num_inference_steps=num_inference_steps,
                    generator=generator,
                    callback_on_step_end=on_step_end,
                    output_type="latent",
                )
                return output, width, height, num_frames
            except Exception as exc:
                oom_cls = getattr(_torch.cuda, "OutOfMemoryError", None)
                is_oom = (oom_cls is not None and isinstance(exc, oom_cls)) or (
                    "out of memory" in str(exc).lower()
                )
                if not is_oom or attempt >= max_retries:
                    raise
                attempt += 1
                try:
                    _torch.cuda.empty_cache()
                    _torch.cuda.ipc_collect()
                except Exception:
                    pass
                if attempt == 1:
                    num_frames = max(25, ((int(num_frames) * 4 // 5 - 1) // 4) * 4 + 1)
                    logger.warning(
                        "CUDA OOM — auto-recovering with %d frames (retry 1/%d)",
                        num_frames, max_retries,
                    )
                else:
                    height = max(256, (int(height) * 3 // 4 // 16) * 16)
                    width = max(448, (int(width) * 3 // 4 // 16) * 16)
                    num_frames = max(25, ((int(num_frames) * 4 // 5 - 1) // 4) * 4 + 1)
                    logger.warning(
                        "CUDA OOM — auto-recovering at %dx%d, %d frames (retry %d/%d)",
                        width, height, num_frames, attempt, max_retries,
                    )

    # ------------------------------------------------------------ generation
    def generate(
        self,
        prompt: str,
        input_path: Optional[str] = None,
        on_progress=None,
        is_cancelled=None,
        num_frames: int = 0,
        guidance_scale: float = 0.0,
        width: int = 0,
        height: int = 0,
        num_inference_steps: int = 0,
    ) -> dict:
        """Run a text-to-video generation pass.

        Returns a dict: {
            "frames": list[np.ndarray]  (one per frame, HxWxC, uint8 RGB),
            "width":  int,
            "height": int,
            "num_frames": int,
            "fps":    int,
        }
        Raises RuntimeError if the model isn't loaded.

        Steps/guidance default to the values chosen in load() (distilled vs
        standard checkpoint); callers may override per-call.

        `input_path` is accepted for API compatibility but text-to-video
        generation does not condition on it — a loud warning is logged so
        uploads are never silently ignored (the old behaviour).

        `on_progress(pct: int)` is called periodically (0-100).
        """
        if not self.loaded or self.pipeline is None or _torch is None:
            raise RuntimeError("Wan2.1 model not loaded")

        import time
        import random
        import numpy as _np

        if input_path:
            logger.warning(
                "An attachment (%s) was provided, but the loaded pipeline is "
                "text-to-video only — the file will NOT condition the "
                "generation. Set WAN_SAFETENSORS to an image-conditioned "
                "checkpoint to use uploads.", input_path,
            )

        # Per-call overrides fall back to the auto-detected defaults.
        if num_inference_steps <= 0:
            num_inference_steps = self.default_num_steps
        if guidance_scale <= 0:
            guidance_scale = self.default_guidance
        # Never apply CFG to a distilled checkpoint even if a caller insists.
        if self.is_distilled and guidance_scale > 1.0:
            logger.warning(
                "Ignoring guidance_scale=%.2f for distilled checkpoint (forcing 1.0)",
                guidance_scale,
            )
            guidance_scale = 1.0

        if width <= 0:
            width = self.default_width
        if height <= 0:
            height = self.default_height

        # Default duration: 5s (81 frames @ 16fps).
        # Override with WAN_NUM_FRAMES (e.g. 49 for 3s, 161 for 10s).
        if num_frames == 0:
            num_frames = int(os.environ.get("WAN_NUM_FRAMES", "81"))

        # Wan requires dimensions divisible by 16 and num_frames = 4k + 1.
        width = max(16, (int(width) // 16) * 16)
        height = max(16, (int(height) // 16) * 16)
        num_frames = max(5, ((int(num_frames) - 1) // 4) * 4 + 1)

        def _report(p: int) -> None:
            if on_progress is not None:
                try:
                    on_progress(int(max(0, min(100, p))))
                except Exception:
                    pass

        # Map denoising steps onto 10..90% of the progress bar.
        def _on_step_end(pipe, step, timestep, callback_kwargs):
            if is_cancelled and is_cancelled():
                logger.info("Generation cancelled at step %d/%d — aborting immediately!", step + 1, num_inference_steps)
                raise GenerationCancelled("Generation cancelled by user")
            logger.info("Denoising step %d/%d completed (timestep: %s)", step + 1, num_inference_steps, timestep)
            _report(10 + int(80 * (step + 1) / max(1, num_inference_steps)))
            return callback_kwargs

        # Seed: random per video (default) so retries aren't identical, or a
        # fixed seed via WAN_SEED=<int> for reproducibility.
        seed_raw = os.environ.get("WAN_SEED", "random").strip().lower()
        if seed_raw in ("", "random"):
            seed = random.randint(0, 2**31 - 1)
        else:
            try:
                seed = int(seed_raw)
            except ValueError:
                seed = random.randint(0, 2**31 - 1)

        with self._gpu_lock:
            start = time.time()
            try:
                if is_cancelled and is_cancelled():
                    raise GenerationCancelled("Generation cancelled before start")
                generator = _torch.Generator(device="cpu").manual_seed(seed)
                logger.info(
                    "Generating %dx%d %d frames | steps=%d guidance=%.2f seed=%d",
                    width, height, num_frames, num_inference_steps, guidance_scale, seed,
                )

                _report(10)
                t_enc = time.time()
                embed_dtype = self._model_dtype or _torch.float16
                prompt_embeds = self._encode_prompt(prompt).to(
                    device=self.device, dtype=embed_dtype
                )
                # For guidance <= 1.0, WanPipeline skips CFG entirely, so the
                # negative embeds are neither required nor used.
                negative_embeds = (
                    self._negative_embeds.to(device=self.device, dtype=embed_dtype)
                    if self._negative_embeds is not None and guidance_scale > 1.0
                    else None
                )
                logger.info("Prompt encoded on CPU in %.1fs", time.time() - t_enc)
                if is_cancelled and is_cancelled():
                    raise GenerationCancelled("Generation cancelled after prompt encoding")
                with _torch.inference_mode():
                    output, width, height, num_frames = self._generate_with_oom_recovery(
                        prompt_embeds=prompt_embeds,
                        negative_embeds=negative_embeds,
                        num_frames=num_frames,
                        guidance_scale=guidance_scale,
                        width=width,
                        height=height,
                        num_inference_steps=num_inference_steps,
                        generator=generator,
                        on_step_end=_on_step_end,
                    )
                _report(90)
                logger.info("Denoising complete. Decoding latents with VAE on GPU...")
                t_vae = time.time()
                latents = output.frames[0]
                if hasattr(latents, "to"):
                    latents = latents.to(device=self.device, dtype=_torch.float32)
                    if latents.dim() == 4:
                        latents = latents.unsqueeze(0)
                    self.pipeline.vae.to(device=self.device, dtype=_torch.float32)
                    latents_mean = (
                        _torch.tensor(self.pipeline.vae.config.latents_mean, device=self.device, dtype=_torch.float32)
                        .view(1, self.pipeline.vae.config.z_dim, 1, 1, 1)
                    )
                    latents_std = 1.0 / (
                        _torch.tensor(self.pipeline.vae.config.latents_std, device=self.device, dtype=_torch.float32)
                        .view(1, self.pipeline.vae.config.z_dim, 1, 1, 1)
                    )
                    latents = latents / latents_std + latents_mean
                    with _torch.no_grad():
                        video = self.pipeline.vae.decode(latents, return_dict=False)[0]
                    video = self.pipeline.video_processor.postprocess_video(video, output_type="np")
                    frames_raw = video[0]
                    self.pipeline.vae.to("cpu")
                    _torch.cuda.empty_cache()
                    logger.info("VAE decoded in %.2fs", time.time() - t_vae)
                else:
                    frames_raw = output.frames[0]

                try:
                    peak_gb = _torch.cuda.max_memory_allocated() / (1024 ** 3)
                    logger.info(
                        "Peak VRAM during generation: %.2f GB",
                        peak_gb,
                    )
                except Exception:
                    pass

                frames = []
                for frame in frames_raw:
                    if hasattr(frame, "convert"):
                        frame = frame.convert("RGB")
                    arr = _np.asarray(frame)
                    if arr.dtype != _np.uint8:
                        # Diffusers returns floats in [0, 1].
                        arr = (_np.clip(arr, 0.0, 1.0) * 255.0).round().astype(_np.uint8)
                    frames.append(arr)
            except GenerationCancelled:
                logger.info("Generation cancelled mid-run — GPU memory cleared.")
                raise
            finally:
                try:
                    _torch.cuda.empty_cache()
                except Exception:
                    pass

        elapsed = time.time() - start
        logger.info(
            "Wan generation complete: %d frames in %.2fs (seed=%d)",
            len(frames), elapsed, seed,
        )
        _report(100)
        return {
            "frames": frames,
            "width": width,
            "height": height,
            "num_frames": len(frames),
            "fps": 16,
        }


# Module-level singleton for the service to share.
model = WanModel()
