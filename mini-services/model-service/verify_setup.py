#!/usr/bin/env python3
"""verify_setup.py — one-command pre-flight check for the Hanvid stack.

Run this BEFORE generating your first video and any time something feels
off. It checks, in order:

  1. Python version            (3.10+ recommended)
  2. torch + CUDA + RTX 50-series Blackwell kernel support  (gpu_check)
  3. VRAM / RAM budget vs the 8GB + 24GB reference target
  4. diffusers / transformers / accelerate / scipy / sentencepiece
  5. imageio + ffmpeg (export & polish stages)
  6. Model weights presence (Phr00t single-file checkpoint and/or the
     diffusers pipeline cache for Wan-AI/Wan2.1-T2V-1.3B-Diffusers)
  7. Disk space on the model drive
  8. The exact generation settings the service will use

Exit code 0 = ready for real generation. Non-zero = fix the red items.

Usage:
    python verify_setup.py
"""

from __future__ import annotations

import importlib
import os
import shutil
import sys
from typing import Any, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PASS = "  [PASS]"
FAIL = "  [FAIL]"
WARN = "  [WARN]"
INFO = "  [INFO]"

problems: list[str] = []


def _check(label: str, ok: bool, detail: str = "", fix: str = "",
           warn_only: bool = False) -> bool:
    line = (PASS if ok else (WARN if warn_only else FAIL)) + f" {label}"
    if detail:
        line += f" — {detail}"
    print(line)
    if not ok:
        if fix:
            print(f"         fix: {fix}")
        if not warn_only:
            problems.append(f"{label}: {fix or detail}")
    return ok


def _module_version(name: str) -> Optional[str]:
    try:
        mod = importlib.import_module(name)
        return getattr(mod, "__version__", "installed")
    except Exception:
        return None


def main() -> int:
    print("=" * 66)
    print(" HANVID PRE-FLIGHT CHECK  (reference target: RTX 5070 8GB + 24GB RAM)")
    print("=" * 66)

    # 1 — Python ------------------------------------------------------------
    v = sys.version_info
    _check(
        "Python version", (v.major, v.minor) >= (3, 10),
        f"{v.major}.{v.minor}.{v.micro}",
        "Use Python 3.10-3.12 (3.12 recommended).",
    )

    # 2 — GPU / torch / Blackwell -------------------------------------------
    import gpu_check

    gpu = gpu_check.check_gpu_compatibility(probe=True)
    print(gpu_check.format_report(gpu))
    if not gpu["ok"]:
        problems.extend(gpu["fixes"] or ["GPU not ready for real generation"])
    if gpu.get("is_blackwell"):
        _check(
            "RTX 50-series (Blackwell) kernel support",
            gpu["arch_supported"] is not False and gpu["kernel_probe_ok"] is not False,
            f"compute cap {gpu['compute_cap']}, torch CUDA {gpu['cuda_build']}",
            "pip uninstall -y torch && pip install torch --index-url "
            "https://download.pytorch.org/whl/cu128",
        )

    # 3 — Memory budget -----------------------------------------------------
    vram = gpu.get("vram_total_gb")
    ram = gpu.get("ram_gb")
    if vram is not None:
        _check("VRAM >= 6GB (8GB reference)", vram >= 6.0, f"{vram} GB total",
               "Sequential CPU offloading is required below 6GB; expect slowness.",
               warn_only=vram >= 5.0)
    if ram is not None:
        _check("System RAM >= 16GB (24GB reference)", ram >= 16.0, f"{ram} GB",
               "UMT5 text encoder + 14B offload layers live in RAM; 24GB is the "
               "sweet spot.", warn_only=ram >= 12.0)

    # 4 — ML stack ----------------------------------------------------------
    for mod, why in (
        ("diffusers", "WanPipeline — the generation engine"),
        ("transformers", "UMT5 text encoder"),
        ("accelerate", "CPU offloading hooks"),
        ("scipy", "beta-sigma scheduler for Rapid/distilled checkpoints"),
        ("sentencepiece", "UMT5 tokenizer"),
        ("safetensors", "loading .safetensors checkpoints"),
        ("imageio", "MP4 export"),
        ("imageio_ffmpeg", "bundled ffmpeg fallback"),
    ):
        ver = _module_version(mod)
        _check(f"module: {mod}", ver is not None, f"{ver} — {why}" if ver else why,
               f"pip install {mod.replace('_', '-')}")

    # 5 — ffmpeg ------------------------------------------------------------
    ff = os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg")
    _check("ffmpeg on PATH (or FFMPEG_BIN)", bool(ff), ff or "not found",
           "Install ffmpeg, or rely on the imageio-ffmpeg bundled binary "
           "(video polish stage needs it).", warn_only=True)

    # 6 — Model weights -----------------------------------------------------
    try:
        import wan_inference

        ckpt = wan_inference.resolve_checkpoint()
        if ckpt:
            size_gb = os.path.getsize(ckpt) / (1024**3)
            distilled = wan_inference.checkpoint_is_distilled(ckpt)
            _check("Single-file checkpoint", True,
                   f"{ckpt} ({size_gb:.1f} GB, distilled={distilled})")
        else:
            _check(
                "Model weights", False, f"not found (service will load {wan_inference.MODEL_ID} from cache/hub)",
                f"Run 'python download_model.py' to download {wan_inference.MODEL_ID}.",
                warn_only=True,
            )
    except Exception as exc:
        _check("wan_inference import", False, str(exc), warn_only=True)

    # 7 — Disk space --------------------------------------------------------
    drive = os.path.splitdrive(os.path.abspath(HERE))[0] or "/"
    try:
        if os.name == "nt":
            import ctypes

            free = ctypes.c_ulonglong(0)
            ctypes.windll.kernel32.GetDiskFreeSpaceExW(
                os.path.abspath(HERE), ctypes.pointer(free), None, None
            )
            free_gb = free.value / (1024**3)
        else:
            st = os.statvfs(HERE)
            free_gb = st.f_bavail * st.f_frsize / (1024**3)
        _check("Free disk space >= 30GB", free_gb >= 30.0, f"{free_gb:.0f} GB free on {drive}",
               "Model weights + videos + HF cache need tens of GB.", warn_only=True)
    except Exception:
        print(f"{INFO} could not measure free disk space")

    # 8 — Effective settings -------------------------------------------------
    try:
        import wan_inference

        s = wan_inference.model.effective_settings()
        print(f"{INFO} effective settings (before model load): {s}")
    except Exception:
        pass

    # Verdict -----------------------------------------------------------------
    print("=" * 66)
    if problems:
        print(f" ✋ {len(problems)} problem(s) to fix before real generation:")
        for p in problems:
            print(f"   - {p}")
        print("   Then re-run:  python verify_setup.py")
        return 1
    print(" ✅ ALL CHECKS PASSED — you are ready for real video generation.")
    print("    Start the service:  python server.py   (then check /health)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
