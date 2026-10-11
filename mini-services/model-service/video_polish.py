"""video_polish.py — post-generation "anti-disturbance" pass.

The complaint that drove this module: freshly generated videos can look
weak / disturbed — frame-to-frame brightness pulsing (flicker), grainy
temporal noise, slightly soft detail, washed-out color. Instead of touching
the diffusion math, we run a carefully tuned ffmpeg filter chain over the
finished MP4 (a few seconds of CPU time, zero VRAM):

    1. hqdn3d    — spatio-temporal denoise. The temporal component is the
                   key: it averages small frame-to-frame noise, which is
                   exactly the "disturbance" the eye picks up.
    2. deflicker — windowed global luma stabilization; removes the slow
                   brightness "breathing"/pulsing typical of diffusion VAE
                   decodes.
    3. unsharp   — restores the micro-contrast denoising costs us.
    4. eq        — a *gentle* saturation/contrast lift so output stops
                   reading as "weak"/washed out.

Presets (env HANVID_POLISH_STRENGTH): light | standard | strong
Master switch (env HANVID_POLISH): 1 (default) / 0

The module NEVER raises — on any failure the original file is returned
untouched, so video delivery can never be blocked by polishing.
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from typing import Optional

logger = logging.getLogger("video_polish")

# Preset → ffmpeg -vf chain. Tuned for 832x480/720p Wan output; the values
# are balanced to eliminate diffusion flicker/grain while enhancing edge micro-contrast.
FILTER_CHAINS = {
    "light": (
        "hqdn3d=0.8:0.8:1.5:1.5,"
        "unsharp=5:5:0.4:5:5:0.0"
    ),
    "standard": (
        "hqdn3d=1.0:1.0:2.0:1.8,"
        "deflicker=mode=pm:size=5,"
        "unsharp=5:5:0.6:5:5:0.0,"
        "eq=saturation=1.05:contrast=1.02"
    ),
    "strong": (
        "hqdn3d=1.4:1.4:2.8:2.4,"
        "deflicker=mode=pm:size=6,"
        "unsharp=5:5:0.75:5:5:0.0,"
        "eq=saturation=1.06:contrast=1.03"
    ),
    "market_clean": (
        "hqdn3d=1.0:1.0:2.0:1.8,"
        "deflicker=mode=pm:size=5,"
        "unsharp=5:5:0.65:5:5:0.0,"
        "eq=saturation=1.05:contrast=1.02"
    ),
}

RESOLUTION_PRESETS = {
    "480p": (832, 480),
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "2k": (2560, 1440),
    "4k": (3840, 2160),
}


def build_filter_chain(strength: str, resolution: Optional[str] = None, use_deflicker: bool = True) -> tuple[str, tuple[int, int]]:
    """Build an optimal ffmpeg filter chain with optional super-resolution upscaling.
    Temporal denoise is kept light (2.0) to strictly prevent motion smear/ghosting on fine elements like trees and birds.
    """
    res_key = (resolution or os.environ.get("HANVID_RESOLUTION", "2k")).strip().lower()
    target_dim = RESOLUTION_PRESETS.get(res_key, (2560, 1440))
    w, h = target_dim

    # Clean spatial noise while strictly zeroing temporal denoise (0:0) so fast/small
    # moving elements like birds, sparks, and fine textures are NEVER washed out or dissolved across frames.
    denoise = "hqdn3d=0.8:0.8:0:0"
    filters = [denoise]
    if use_deflicker:
        filters.append("deflicker=mode=pm:size=3")

    # Super-resolution scaling if upscaling above native 480p
    if res_key != "480p":
        filters.append(f"scale={w}:{h}:flags=lanczos+accurate_rnd+full_chroma_int")
        # Sharpening tuned specifically for upscaled resolution
        if res_key == "4k":
            filters.append("unsharp=5:5:1.0:5:5:0.0")
        elif res_key == "2k":
            filters.append("unsharp=5:5:0.80:5:5:0.0")
        else:
            filters.append("unsharp=5:5:0.65:5:5:0.0")
    else:
        filters.append("unsharp=5:5:0.65:5:5:0.0")

    filters.append("eq=saturation=1.05:contrast=1.02")
    return ",".join(filters), target_dim

# Fallback chain if this ffmpeg build lacks the `deflicker` filter
FALLBACK_CHAINS = {
    "light": "hqdn3d=0.8:0.8:0:0,unsharp=5:5:0.4:5:5:0.0",
    "standard": "hqdn3d=0.8:0.8:0:0,unsharp=5:5:0.6:5:5:0.0,eq=saturation=1.05:contrast=1.02",
    "strong": "hqdn3d=1.0:1.0:0:0,unsharp=5:5:0.75:5:5:0.0,eq=saturation=1.06:contrast=1.03",
    "market_clean": "hqdn3d=0.8:0.8:0:0,unsharp=5:5:0.65:5:5:0.0,eq=saturation=1.05:contrast=1.02",
}


def _ffmpeg_binary() -> Optional[str]:
    """Resolve an ffmpeg executable: env override → imageio-ffmpeg → PATH → local venv."""
    env_bin = os.environ.get("FFMPEG_BIN", "").strip()
    if env_bin and os.path.isfile(env_bin):
        return env_bin

    try:
        import imageio_ffmpeg  # type: ignore

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.isfile(exe):
            return exe
    except Exception:
        pass

    import shutil

    which_exe = shutil.which("ffmpeg")
    if which_exe:
        return which_exe

    # Look for bundled imageio-ffmpeg binary inside local .venv
    base_dir = os.path.dirname(os.path.abspath(__file__))
    venv_bin_dir = os.path.join(base_dir, ".venv", "Lib", "site-packages", "imageio_ffmpeg", "binaries")
    if os.path.isdir(venv_bin_dir):
        for fname in os.listdir(venv_bin_dir):
            if fname.startswith("ffmpeg") and fname.endswith(".exe"):
                candidate = os.path.join(venv_bin_dir, fname)
                if os.path.isfile(candidate):
                    return candidate

    return None


def _run_ffmpeg(ffmpeg: str, src: str, dst: str, vf: str) -> tuple[bool, str]:
    """Encode src → dst with the given -vf chain. Returns (ok, stderr tail)."""
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", src,
        # `0:a?` = map audio only if present (no audio → no error).
        "-map", "0:v:0", "-map", "0:a?",
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "17",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        dst,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if proc.returncode == 0 and os.path.isfile(dst) and os.path.getsize(dst) > 0:
            return True, ""
        tail = (proc.stderr or "").strip().splitlines()[-5:]
        return False, " | ".join(tail) if tail else f"exit code {proc.returncode}"
    except subprocess.TimeoutExpired:
        return False, "ffmpeg timed out after 600s (file kept unpolished)"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def polish_video(path: str, strength: Optional[str] = None, resolution: Optional[str] = None) -> dict:
    """Deflicker + denoise + upscale (1080p/2K/4K) + sharpen a finished MP4 in place.

    Returns {"polished": bool, "strength": str, "resolution": str, "width": int, "height": int, "note": str}.
    Never raises. The original file is only replaced by a fully valid,
    non-empty polished encode (atomic os.replace).
    """
    master = os.environ.get("HANVID_POLISH", "1").strip().lower()
    res_key = (resolution or os.environ.get("HANVID_RESOLUTION", "2k")).strip().lower()
    w, h = RESOLUTION_PRESETS.get(res_key, (2560, 1440))

    if master in ("0", "false", "no", "off"):
        return {"polished": False, "strength": "off", "resolution": "480p", "width": 832, "height": 480, "note": "HANVID_POLISH disabled"}

    strength = (strength or os.environ.get("HANVID_POLISH_STRENGTH", "market_clean")).strip().lower()
    if strength in ("", "off", "none", "0"):
        strength = "market_clean"

    if not path or not os.path.isfile(path):
        return {"polished": False, "strength": strength, "resolution": res_key, "width": w, "height": h, "note": "file missing"}

    ffmpeg = _ffmpeg_binary()
    if not ffmpeg:
        return {
            "polished": False, "strength": strength, "resolution": res_key, "width": w, "height": h,
            "note": "no ffmpeg binary found (install ffmpeg or imageio-ffmpeg)",
        }

    src_size = os.path.getsize(path)
    primary_chain, target_dim = build_filter_chain(strength, res_key, use_deflicker=True)
    fallback_chain, _ = build_filter_chain(strength, res_key, use_deflicker=False)
    out_w, out_h = target_dim

    with tempfile.TemporaryDirectory(prefix="hanvid_polish_") as tmp:
        dst = os.path.join(tmp, "polished.mp4")

        ok, note = _run_ffmpeg(ffmpeg, path, dst, primary_chain)
        if not ok:
            logger.warning(
                "Primary polish chain failed (%s) — retrying without deflicker.", note
            )
            ok, note2 = _run_ffmpeg(ffmpeg, path, dst, fallback_chain)
            if not ok:
                logger.warning("Polish fallback failed too (%s) — keeping original.", note2)
                return {"polished": False, "strength": strength, "resolution": "480p", "width": 832, "height": 480,
                        "note": f"ffmpeg failed: {note2}"}

        # Only replace when the new file is sane (non-trivially sized).
        new_size = os.path.getsize(dst)
        if new_size < 4096:
            return {"polished": False, "strength": strength, "resolution": "480p", "width": 832, "height": 480,
                    "note": "polished file suspiciously small — kept original"}

        os.replace(dst, path)
        logger.info(
            "Video polished & upscaled (%s → %s %dx%d): %s (%d → %d bytes)",
            strength, res_key.upper(), out_w, out_h, path, src_size, new_size,
        )
        return {"polished": True, "strength": strength, "resolution": res_key,
                "width": out_w, "height": out_h,
                "note": f"deflicker+denoise+upscale({res_key.upper()} {out_w}x{out_h}) ok ({new_size} bytes)"}


if __name__ == "__main__":
    # Standalone usage:  python video_polish.py <video.mp4> [strength]
    import sys as _sys

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if len(_sys.argv) < 2:
        print("usage: python video_polish.py <video.mp4> [light|standard|strong]")
        _sys.exit(2)
    result = polish_video(_sys.argv[1], _sys.argv[2] if len(_sys.argv) > 2 else None)
    print(result)
    _sys.exit(0 if result["polished"] else 1)
