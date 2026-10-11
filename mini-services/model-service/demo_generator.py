"""demo_generator.py — ffmpeg-based fallback video generator.

When the Wan2.1 model isn't available (no torch / GPU / model weights),
this module produces a short, visually pleasing MP4 placeholder so the
web app UI is always functional.

Output: a 4-second 640x360 MP4 with an animated gradient background and
the user's prompt text overlaid (line-wrapped). Designed to look like a
"generating…" preview rather than a broken image.
"""

from __future__ import annotations

import logging
import os
import shlex
import shutil
import subprocess
from typing import Optional

logger = logging.getLogger("demo_generator")

def _get_ffmpeg_bin() -> str:
    env_bin = os.environ.get("FFMPEG_BIN")
    if env_bin and os.path.exists(env_bin):
        return env_bin
    which = shutil.which("ffmpeg")
    if which:
        return which
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    for p in [
        r"C:\Users\vudha\.vscode\extensions\kilocode.kilo-code-7.8.8-win32-x64\bin\ffmpeg.exe",
        "/usr/bin/ffmpeg",
    ]:
        if os.path.exists(p):
            return p
    return "ffmpeg"


def _get_font_path() -> str:
    env_font = os.environ.get("FFMPEG_FONT")
    if env_font and os.path.exists(env_font):
        return env_font.replace("\\", "/").replace(":", "\\:")
    for p in [
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]:
        if os.path.exists(p):
            return p.replace("\\", "/").replace(":", "\\:")
    return ""


FFMPEG_BIN = _get_ffmpeg_bin()
FONT_PATH = _get_font_path()

# Demo video specs (must match the values returned in /status payload).
DURATION_SEC = 4
WIDTH = 640
HEIGHT = 360
FPS = 25


def _ffmpeg_available() -> bool:
    """True if ffmpeg binary exists and is executable."""
    bin_path = _get_ffmpeg_bin()
    try:
        res = subprocess.run(
            [bin_path, "-version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return res.returncode == 0
    except Exception:
        return False



def _escape_drawtext(text: str) -> str:
    """Escape a string for ffmpeg drawtext filter, including newlines.

    ffmpeg drawtext treats `:` as a filter option separator and has its
    own escaping rules. We:
      1. Replace newlines with %{n} so we can use a single drawtext call.
         (Actually we just join lines with a space to keep it simple.)
      2. Escape backslashes, colons, single quotes, commas, %.
    """
    if text is None:
        text = ""
    text = text.replace("\\", "\\\\")
    text = text.replace(":", "\\:")
    text = text.replace("'", "\\'")
    text = text.replace(",", "\\,")
    text = text.replace("%", "\\%")
    # Replace newlines with a space — multiline drawtext is finicky.
    text = text.replace("\n", " ").replace("\r", " ")
    return text


def _wrap_text(text: str, max_chars: int = 36) -> str:
    """Naive greedy word-wrap to fit prompt within video width."""
    if not text:
        return ""
    words = text.split()
    lines: list[str] = []
    current = ""
    for w in words:
        if not current:
            current = w
        elif len(current) + 1 + len(w) <= max_chars:
            current += " " + w
        else:
            lines.append(current)
            current = w
    if current:
        lines.append(current)
    # Cap at 3 lines so the overlay doesn't overflow the 360px height.
    if len(lines) > 3:
        lines = lines[:3]
        lines[-1] = lines[-1][: max_chars - 3] + "..."
    return "\n".join(lines)


def generate_demo_video(
    prompt: str,
    output_path: str,
    enhanced_prompt: Optional[str] = None,
) -> dict:
    """Render a placeholder MP4 using ffmpeg.

    Args:
        prompt: original user prompt (shown as the title line).
        output_path: absolute path to write the MP4.
        enhanced_prompt: optional subtitle (smaller text below title).

    Returns:
        dict with keys: width, height, duration, num_frames, fps.
    Raises RuntimeError if ffmpeg fails.
    """
    if not _ffmpeg_available():
        raise RuntimeError(f"ffmpeg not found at {FFMPEG_BIN}")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)

    # Use the enhanced prompt as the headline if present, else the prompt.
    headline = (enhanced_prompt or prompt).strip() or "Wan2.1 demo video"
    title = _escape_drawtext(_wrap_text(headline, 36))

    # Build a calm animated gradient background. We use the `gradients`
    # filter (available in ffmpeg ≥ 4.4); if absent, the simpler `color`
    # fallback below is tried.
    #
    # Gradient colors chosen to evoke a cinematic dark-emerald theme
    # consistent with the rest of the web app.
    color_top = "0x06251f"
    color_bottom = "0x0a3d31"

    # drawtext with leading newlines pushes the title down toward the
    # vertical center. We escape literal newlines in the text by passing
    # them as \\n inside the filter graph string.
    title_with_newlines = title.replace("\n", "\\n")

    # Subtitle line showing this is a demo render.
    subtitle = "Wan2.1 • demo render (model not loaded)"
    subtitle_esc = _escape_drawtext(subtitle)

    # Compose filter graph:
    #  1. gradient background (animated; `rate` is the framerate option,
    #     not `fps` — they are different on the gradients filter).
    #  2. draw title text near vertical center
    #  3. draw subtitle near bottom
    font_opt = f":fontfile='{FONT_PATH}'" if FONT_PATH else ""
    filter_graph = (
        f"gradients=s={WIDTH}x{HEIGHT}:"
        f"duration={DURATION_SEC}:rate={FPS}:"
        f"c0={color_top}:c1={color_bottom}:"
        f"x0=0:x1={WIDTH}:y0=0:y1={HEIGHT}:"
        f"nb_colors=2,"
        # Slight zoom-in to add motion.
        f"zoompan=z='min(zoom+0.0015,1.15)':d=1:"
        f"s={WIDTH}x{HEIGHT}:fps={FPS},"
        # Title overlay (vertical center).
        f"drawtext=text='{title_with_newlines}'{font_opt}:"
        f"fontcolor=white:fontsize=28:"
        f"x=(w-text_w)/2:y=(h-text_h)/2:"
        f"shadowcolor=black@0.6:shadowx=2:shadowy=2:"
        f"line_spacing=8,"
        # Subtitle overlay (bottom).
        f"drawtext=text='{subtitle_esc}'{font_opt}:"
        f"fontcolor=0x6ee7b7:fontsize=14:"
        f"x=(w-text_w)/2:y=h-30"
    )

    cmd = [
        FFMPEG_BIN,
        "-y",                       # overwrite
        "-f", "lavfi",
        "-i", filter_graph,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",  # web-friendly streaming
        "-t", str(DURATION_SEC),
        "-loglevel", "error",
        output_path,
    ]

    logger.info("Running ffmpeg: %s", " ".join(shlex.quote(c) for c in cmd))

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("ffmpeg timed out") from exc

    if proc.returncode != 0:
        # Try the simpler `color` fallback (older ffmpeg without gradients).
        logger.warning(
            "ffmpeg gradient failed (rc=%d): %s. Falling back to solid color.",
            proc.returncode,
            proc.stderr.strip(),
        )
        simple_graph = (
            f"color=c=0x0a3d31:s={WIDTH}x{HEIGHT}:d={DURATION_SEC}:r={FPS},"
            f"drawtext=text='{title_with_newlines}'{font_opt}:"
            f"fontcolor=white:fontsize=28:"
            f"x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=8,"
            f"drawtext=text='{subtitle_esc}'{font_opt}:"
            f"fontcolor=0x6ee7b7:fontsize=14:"
            f"x=(w-text_w)/2:y=h-30"
        )
        cmd = [
            FFMPEG_BIN,
            "-y",
            "-f", "lavfi",
            "-i", simple_graph,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-t", str(DURATION_SEC),
            "-loglevel", "error",
            output_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            raise RuntimeError(
                f"ffmpeg failed (rc={proc.returncode}): {proc.stderr.strip()}"
            )

    if not os.path.exists(output_path):
        raise RuntimeError("ffmpeg produced no output file")

    size = os.path.getsize(output_path)
    logger.info("Demo video written: %s (%d bytes)", output_path, size)

    return {
        "width": WIDTH,
        "height": HEIGHT,
        "duration": DURATION_SEC,
        "num_frames": DURATION_SEC * FPS,
        "fps": FPS,
    }


if __name__ == "__main__":
    # Quick smoke test from CLI: python3 demo_generator.py
    out = os.path.join(os.path.dirname(__file__), "videos", "smoke.mp4")
    info = generate_demo_video("a fluffy cat playing with yarn", out)
    print("OK:", info)
