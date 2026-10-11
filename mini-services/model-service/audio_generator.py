import sys
import os
import logging
import subprocess
import tempfile
import shutil
from unittest.mock import MagicMock

import numpy as np
import torch

# PyAV's DLLs are blocked by Windows Application Control on this machine.
# MMAudio imports `av` at module level (only used for video I/O, which we bypass),
# so stub it out before importing mmaudio.
try:
    import av  # noqa: F401
except Exception:
    sys.modules["av"] = MagicMock()

_MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(_MODEL_DIR, "MMAudio"))

from mmaudio.eval_utils import ModelConfig, all_model_cfg, generate  # noqa: E402
from mmaudio.model.flow_matching import FlowMatching  # noqa: E402
from mmaudio.model.networks import get_my_mmaudio  # noqa: E402
from mmaudio.model.utils.features_utils import FeaturesUtils  # noqa: E402

import soundfile as sf  # noqa: E402
import imageio_ffmpeg  # noqa: E402

log = logging.getLogger("audio_generator")

_mmaudio_net = None
_feature_utils = None
_fm = None
_rng = None
_model_cfg = None

device = "cuda" if torch.cuda.is_available() else "cpu"


def ensure_loaded():
    global _mmaudio_net, _feature_utils, _fm, _rng, _model_cfg
    if _mmaudio_net is not None:
        _mmaudio_net.to(device)
        if _feature_utils is not None:
            _feature_utils.to(device)
        return

    log.info("Loading MMAudio model...")
    model: ModelConfig = all_model_cfg["small_16k"]
    # Weights paths are relative to CWD; pin them to the model-service folder.
    cwd = os.getcwd()
    os.chdir(_MODEL_DIR)
    try:
        model.download_if_needed()
    finally:
        os.chdir(cwd)
    _model_cfg = model

    def _abs(p):
        return None if p is None else (p if os.path.isabs(str(p)) else os.path.join(_MODEL_DIR, str(p)))

    dtype = torch.bfloat16
    _mmaudio_net = get_my_mmaudio(model.model_name).to(device, dtype).eval()
    _mmaudio_net.load_weights(torch.load(_abs(model.model_path), map_location=device, weights_only=True))

    _rng = torch.Generator(device=device)
    _rng.manual_seed(42)
    _fm = FlowMatching(min_sigma=0, inference_mode="euler", num_steps=25)

    _feature_utils = FeaturesUtils(
        tod_vae_ckpt=_abs(model.vae_path),
        synchformer_ckpt=_abs(model.synchformer_ckpt),
        enable_conditions=True,
        mode=model.mode,
        bigvgan_vocoder_ckpt=_abs(model.bigvgan_16k_path),
        need_vae_encoder=False,
    ).to(device, dtype).eval()
    log.info("MMAudio model loaded.")


def unload():
    global _mmaudio_net, _feature_utils
    if _mmaudio_net is not None:
        _mmaudio_net.to("cpu")
    if _feature_utils is not None:
        _feature_utils.to("cpu")
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    log.info("MMAudio moved to CPU to free VRAM.")


def _read_frames(video_path: str, fps: float, vf_size: str, w: int, h: int, duration: float):
    """Decode frames with ffmpeg into a (T, 3, H, W) float tensor in [0, 1]."""
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-t", str(duration),
           "-i", video_path, "-vf", f"fps={fps},{vf_size}",
           "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, h, w, 3)
    return torch.from_numpy(frames.copy()).permute(0, 3, 1, 2).float() / 255.0


def _load_video_frames(video_path: str, duration: float):
    clip = _read_frames(video_path, 8.0, "scale=384:384:flags=bicubic", 384, 384, duration)
    sync = _read_frames(
        video_path, 25.0,
        "scale='if(gt(iw,ih),-2,224)':'if(gt(iw,ih),224,-2)':flags=bicubic,crop=224:224",
        224, 224, duration)
    sync = (sync - 0.5) / 0.5
    duration = min(duration, clip.shape[0] / 8.0, sync.shape[0] / 25.0)
    return clip[:int(8.0 * duration)], sync[:int(25.0 * duration)], duration


@torch.inference_mode()
def add_audio_to_video(video_path: str, prompt: str, duration: float):
    ensure_loaded()

    clip_frames, sync_frames, duration = _load_video_frames(video_path, float(duration))
    clip_frames = clip_frames.unsqueeze(0)
    sync_frames = sync_frames.unsqueeze(0)

    seq_cfg = _model_cfg.seq_cfg
    seq_cfg.duration = duration
    _mmaudio_net.update_seq_lengths(seq_cfg.latent_seq_len, seq_cfg.clip_seq_len, seq_cfg.sync_seq_len)

    audios = generate(
        clip_frames, sync_frames, [prompt],
        negative_text=[""],
        feature_utils=_feature_utils,
        net=_mmaudio_net,
        fm=_fm,
        rng=_rng,
        cfg_strength=4.5,
    )
    audio = audios.float().cpu()[0].numpy()  # (channels, samples)
    if audio.ndim == 2:
        audio = audio.T

    tmp_dir = tempfile.mkdtemp()
    try:
        wav = os.path.join(tmp_dir, "a.wav")
        out = os.path.join(tmp_dir, "out.mp4")
        sf.write(wav, audio, seq_cfg.sampling_rate)
        subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
             "-i", video_path, "-i", wav,
             "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
             "-map", "0:v:0", "-map", "1:a:0", "-shortest", out],
            check=True,
        )
        shutil.copy(out, video_path)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    log.info(f"Added audio to {video_path}")
