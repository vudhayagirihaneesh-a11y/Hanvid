"""gpu_check.py — hardware compatibility doctor for Hanvid's model service.

Targets the #1 real-world blocker for new RTX 50-series builds: NVIDIA
Blackwell GPUs (RTX 5070 / 5070 Ti / 5080 / 5090 — compute capability 12.x,
"sm_120") require a PyTorch wheel compiled with **CUDA 12.8 or newer**
(torch >= 2.7, the `cu128` build).

With an older wheel (cu121 / cu124), `torch.cuda.is_available()` STILL
returns True, the GPU name is detected correctly, everything looks fine —
and then the first real kernel launch dies with:

    RuntimeError: CUDA error: no kernel image is available for execution
    on the device

Depending on where that happens it either crashes the task or silently
degrades generation (weak / disturbed output, minutes-long step times,
quiet fallback to demo mode). This module catches it *before* the model
loads and prints the exact fix.

Usage:
    python gpu_check.py          # human-readable report, exit code 0/1

    from gpu_check import check_gpu_compatibility, probe_cuda_kernel
"""

from __future__ import annotations

import logging
import os
import shutil
import sys
from typing import Any, Optional

logger = logging.getLogger("gpu_check")

# RTX 5070 (8GB) is the reference build for this service.
REFERENCE_VRAM_GB = 8.0
MIN_RECOMMENDED_VRAM_GB = 6.0

# Blackwell consumer GPUs are compute capability 12.x (sm_120).
BLACKWELL_PREFIX = 12


def _ram_gb() -> Optional[float]:
    """Total system RAM in GB (best effort, cross-platform)."""
    try:
        import psutil  # type: ignore

        return round(psutil.virtual_memory().total / (1024**3), 1)
    except Exception:
        pass
    try:  # Linux fallback without psutil
        with open("/proc/meminfo", "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    return round(int(line.split()[1]) / (1024 * 1024), 1)
    except Exception:
        pass
    return None


def _torch_import():
    """Import torch if possible; returns (module_or_None, import_error_or_None)."""
    try:
        import torch  # type: ignore

        return torch, None
    except Exception as exc:  # ImportError or a broken CUDA-linked binary
        return None, f"{type(exc).__name__}: {exc}"


def probe_cuda_kernel(torch_module: Any) -> tuple[bool, Optional[str]]:
    """Run a tiny GPU matmul to surface 'no kernel image' errors NOW.

    Returns (ok, error_message). A 32x32 matmul uses a real CUDA kernel, so
    a torch build without Blackwell (sm_120) kernels fails here with the
    classic 'no kernel image' error instead of in the middle of a 5-minute
    video generation.
    """
    try:
        a = torch_module.ones((32, 32), device="cuda", dtype=torch_module.float16)
        b = a @ a
        _ = float(b[0, 0].item())
        torch_module.cuda.synchronize()
        return True, None
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def check_gpu_compatibility(probe: bool = True) -> dict:
    """Collect everything needed to decide whether real generation will work.

    Result keys:
        torch_installed, torch_version, cuda_build, cuda_available,
        device_name, compute_cap, arch_list, is_blackwell, arch_supported,
        kernel_probe_ok, kernel_probe_error, vram_total_gb, vram_free_gb,
        ram_gb, ok, warnings[], fixes[]
    """
    info: dict[str, Any] = {
        "torch_installed": False,
        "torch_version": None,
        "cuda_build": None,
        "cuda_available": False,
        "device_name": None,
        "compute_cap": None,
        "arch_list": [],
        "is_blackwell": False,
        "arch_supported": None,
        "kernel_probe_ok": None,
        "kernel_probe_error": None,
        "vram_total_gb": None,
        "vram_free_gb": None,
        "ram_gb": _ram_gb(),
        "ok": False,
        "warnings": [],
        "fixes": [],
    }

    torch_mod, torch_err = _torch_import()
    if torch_mod is None:
        info["warnings"].append(f"torch not importable: {torch_err}")
        info["fixes"].append(
            "Install the CUDA 12.8 build (required for RTX 50-series):\n"
            "  pip install --force-reinstall torch --index-url "
            "https://download.pytorch.org/whl/cu128"
        )
        return info

    info["torch_installed"] = True
    info["torch_version"] = getattr(torch_mod, "__version__", "unknown")
    info["cuda_build"] = str(getattr(torch_mod.version, "cuda", None) or "CPU-only build")

    try:
        info["cuda_available"] = bool(torch_mod.cuda.is_available())
    except Exception as exc:
        info["warnings"].append(f"torch.cuda.is_available() raised: {exc}")
        return info

    if not info["cuda_available"]:
        info["warnings"].append(
            "torch is installed but reports NO usable CUDA device. If you have an "
            "RTX 5070, you almost certainly installed a CPU-only or too-old CUDA "
            "wheel — this is the classic cause of 'weak' video (CPU inference)."
        )
        info["fixes"].append(
            "Reinstall PyTorch with CUDA 12.8 support:\n"
            "  pip uninstall -y torch\n"
            "  pip install torch --index-url https://download.pytorch.org/whl/cu128"
        )
        return info

    try:
        props = torch_mod.cuda.get_device_properties(0)
        info["device_name"] = props.name
        info["vram_total_gb"] = round(props.total_memory / (1024**3), 1)
    except Exception as exc:
        info["warnings"].append(f"Could not read device properties: {exc}")

    try:
        cap = torch_mod.cuda.get_device_capability(0)
        info["compute_cap"] = f"{cap[0]}.{cap[1]}"
        info["is_blackwell"] = cap[0] >= BLACKWELL_PREFIX
    except Exception as exc:
        info["warnings"].append(f"Could not read compute capability: {exc}")

    try:
        info["arch_list"] = list(torch_mod.cuda.get_arch_list())
    except Exception:
        info["arch_list"] = []

    # --- Blackwell (RTX 50-series) kernel support ------------------------
    if info["is_blackwell"]:
        wanted = [a for a in info["arch_list"] if "120" in a]
        info["arch_supported"] = bool(wanted)
        if not info["arch_supported"]:
            info["warnings"].append(
                f"BLACKWELL GPU DETECTED ({info['device_name']}, sm_"
                f"{info['compute_cap']}) but this PyTorch build (CUDA "
                f"{info['cuda_build']}) has NO sm_120 kernels. Generation would "
                "fail or produce garbage. THIS IS THE #1 RTX 5070 BUG."
            )
            info["fixes"].append(
                "Install the CUDA 12.8 PyTorch build (torch >= 2.7):\n"
                "  pip uninstall -y torch\n"
                "  pip install torch --index-url https://download.pytorch.org/whl/cu128"
            )

    # --- Live kernel probe (catches everything the static checks miss) ---
    if probe:
        ok, err = probe_cuda_kernel(torch_mod)
        info["kernel_probe_ok"] = ok
        info["kernel_probe_error"] = err
        if not ok:
            info["warnings"].append(f"GPU kernel probe FAILED: {err}")
            if info["arch_supported"] is not False:
                info["fixes"].append(
                    "The GPU failed a basic kernel test. Update the NVIDIA driver "
                    "(Game Ready / Studio 572.xx or newer for RTX 50-series) and "
                    "reinstall the cu128 torch wheel."
                )

    # --- VRAM sanity -------------------------------------------------------
    if info["vram_total_gb"] is not None:
        if info["vram_total_gb"] < MIN_RECOMMENDED_VRAM_GB:
            info["warnings"].append(
                f"Only {info['vram_total_gb']}GB VRAM detected — sequential "
                "offloading will be used; expect slower generation."
            )
        try:
            free, _total = torch_mod.cuda.mem_get_info()
            info["vram_free_gb"] = round(free / (1024**3), 1)
        except Exception:
            pass
        if info.get("vram_free_gb") is not None and info["vram_free_gb"] < 2.0:
            info["warnings"].append(
                f"Only {info['vram_free_gb']}GB VRAM currently FREE — close other "
                "GPU apps (browsers with hardware acceleration, games) before "
                "generating, or generation may hit out-of-memory."
            )

    # --- Overall verdict ----------------------------------------------------
    info["ok"] = bool(
        info["torch_installed"]
        and info["cuda_available"]
        and (not info["is_blackwell"] or info["arch_supported"] is not False)
        and (info["kernel_probe_ok"] in (None, True))
    )
    return info


def format_report(info: dict) -> str:
    """Render the compatibility report as a human-readable string."""
    yes = lambda v: "yes" if v else "NO"  # noqa: E731
    lines = [
        "=" * 62,
        " HANVID GPU COMPATIBILITY REPORT",
        "=" * 62,
        f" torch            : {info['torch_installed']} "
        f"(v{info['torch_version']})" if info["torch_installed"] else
        " torch            : NOT INSTALLED",
        f" CUDA build       : {info['cuda_build']}",
        f" CUDA available   : {yes(info['cuda_available'])}",
        f" GPU              : {info['device_name'] or 'n/a'}",
        f" Compute cap      : {info['compute_cap'] or 'n/a'}"
        + ("  (Blackwell RTX 50-series)" if info["is_blackwell"] else ""),
        f" VRAM total/free  : {info['vram_total_gb']}GB / {info.get('vram_free_gb')}GB",
        f" System RAM       : {info.get('ram_gb')}GB",
        f" Kernel probe     : "
        + ("PASS" if info["kernel_probe_ok"] else ("FAIL" if info["kernel_probe_ok"] is False else "skipped")),
        "=" * 62,
    ]
    if info["warnings"]:
        lines.append(" ⚠ WARNINGS:")
        lines.extend(f"   - {w}" for w in info["warnings"])
    if info["fixes"]:
        lines.append(" ✔ FIXES:")
        lines.extend(f"   - {f}" for f in info["fixes"])
    lines.append(
        f"\n VERDICT: {'✅ REAL generation supported' if info['ok'] else '❌ NOT ready for real generation'}"
    )
    return "\n".join(lines)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    info = check_gpu_compatibility(probe=True)
    print(format_report(info))
    # Also verify ffmpeg availability — the export/polish stages need it.
    ff = os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg")
    if ff:
        print(f" ffmpeg           : {ff}")
    else:
        print(" ffmpeg           : not found in PATH (export falls back to the "
              "imageio-ffmpeg bundled binary)")
    return 0 if info["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
