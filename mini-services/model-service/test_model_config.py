"""test_model_config.py — unit tests for the Wan model checkpoint resolution
and distilled-detection logic (no GPU / torch required).

These lock in the fixes for the "weak, disturbed video" root causes:

  1. Loading from HuggingFace (no local checkpoint file) must NEVER be
     treated as distilled, no matter what WAN_SAFETENSORS points at —
     the old code saw "rapid" in the default filename and silently ran
     the standard Wan2.1-T2V-1.3B with 6 steps / CFG 1.0 / no negative
     prompt, which produced mushy, noisy output.
  2. The old path join produced models/models/Mega-v3/... when both
     WAN_MODEL_PATH and WAN_SAFETENSORS contained the models/ prefix —
     the checkpoint was "not found" and the service fell back to demo
     mode without any error.
  3. Distilled checkpoints (rapid/lightx2v/distill in the FILENAME of a
     file that actually exists) must be detected so CFG-free settings
     are applied.

Run:  python -m pytest test_model_config.py -v
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wan_inference  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Isolate the WAN_* env vars for every test."""
    for var in (
        "WAN_MODEL_PATH", "WAN_SAFETENSORS", "WAN_BASE_PIPELINE",
        "WAN_NUM_STEPS", "WAN_GUIDANCE_SCALE", "WAN_FLOW_SHIFT",
        "WAN_WIDTH", "WAN_HEIGHT", "WAN_NUM_FRAMES",
        "WAN_DISABLE_MODEL", "WAN_DISTILLED_BETA",
    ):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.chdir(os.path.dirname(os.path.abspath(__file__)))


def _make_checkpoint(path: str) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"placeholder")
    return path


# --------------------------------------------------------------- resolution

def test_no_checkpoint_anywhere_is_none():
    assert wan_inference.resolve_checkpoint() is None


def test_default_safetensors_relative_to_service_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(wan_inference, "DEFAULT_SAFETENSORS", "models/Mega-v3/x.safetensors")
    here = os.path.dirname(os.path.abspath(__file__))
    real = os.path.join(here, "models", "Mega-v3", "x.safetensors")
    _make_checkpoint(real)
    try:
        assert wan_inference.resolve_checkpoint() == real
    finally:
        os.remove(real)


def test_absolute_path_wins(tmp_path):
    f = _make_checkpoint(str(tmp_path / "wan2.1_t2v_1.3B_fp16.safetensors"))
    monkey = pytest.MonkeyPatch()
    monkey.setenv("WAN_SAFETENSORS", f)
    try:
        assert wan_inference.resolve_checkpoint() == f
    finally:
        monkey.undo()


def test_models_prefix_is_not_doubled(tmp_path, monkeypatch):
    """WAN_MODEL_PATH='models' + WAN_SAFETENSORS='models/Mega-v3/x' must not
    produce models/models/Mega-v3/x (the old silent-demo-mode bug)."""
    root = tmp_path / "root"
    (root / "models" / "Mega-v3").mkdir(parents=True)
    ckpt = root / "models" / "Mega-v3" / "wan2.2-rapid-mega-aio-v3.safetensors"
    ckpt.write_bytes(b"x")

    # Run with CWD = root so the plain relative candidate resolves.
    monkeypatch.chdir(root)
    monkeypatch.setenv("WAN_MODEL_PATH", str(root / "models"))
    monkeypatch.setenv("WAN_SAFETENSORS", "models/Mega-v3/wan2.2-rapid-mega-aio-v3.safetensors")

    resolved = wan_inference.resolve_checkpoint()
    assert resolved is not None
    assert "models/models" not in resolved
    assert resolved.endswith("wan2.2-rapid-mega-aio-v3.safetensors")


def test_basename_inside_model_path(tmp_path, monkeypatch):
    """WAN_MODEL_PATH pointing at a dir that holds just the filename."""
    d = tmp_path / "weights"
    d.mkdir()
    ckpt = d / "some-rapid-file.safetensors"
    ckpt.write_bytes(b"x")
    monkeypatch.setenv("WAN_MODEL_PATH", str(d))
    monkeypatch.setenv("WAN_SAFETENSORS", "some-rapid-file.safetensors")
    assert wan_inference.resolve_checkpoint() == str(ckpt)


# ------------------------------------------------------- distilled detection

def test_hf_load_is_never_distilled():
    """No local file → standard model, even though the DEFAULT filename
    contains 'rapid'. This was THE bug behind weak/disturbed output."""
    assert wan_inference.resolve_checkpoint() is None
    assert wan_inference.checkpoint_is_distilled(None) is False


def test_default_filename_without_file_is_not_distilled():
    # The default WAN_SAFETENSORS contains 'rapid' but the file does not
    # exist → the pipeline loads from HF → standard settings.
    resolved = wan_inference.resolve_checkpoint()
    assert resolved is None
    assert wan_inference.checkpoint_is_distilled(resolved) is False


@pytest.mark.parametrize("name", [
    "wan2.2-rapid-mega-aio-v3.safetensors",
    "Wan2.1_Lightx2V_T2V_14B_fp16.safetensors",
    "wan2.1_t2v_1.3B_distill.safetensors",
    "model-noCFG-v2.safetensors",
])
def test_distilled_filenames(tmp_path, monkeypatch, name):
    f = _make_checkpoint(str(tmp_path / name))
    monkeypatch.setenv("WAN_SAFETENSORS", f)
    assert wan_inference.resolve_checkpoint() == f
    assert wan_inference.checkpoint_is_distilled(f) is True


@pytest.mark.parametrize("name", [
    "wan2.1_t2v_1.3B_fp16.safetensors",
    "Wan2.2-T2V-A14B-Diffusers.safetensors",
])
def test_standard_filenames(tmp_path, monkeypatch, name):
    f = _make_checkpoint(str(tmp_path / name))
    monkeypatch.setenv("WAN_SAFETENSORS", f)
    assert wan_inference.resolve_checkpoint() == f
    assert wan_inference.checkpoint_is_distilled(f) is False


# ---------------------------------------------------- effective settings shape

def test_defaults_on_fresh_model_object():
    m = wan_inference.WanModel()
    # Standard-model defaults until a real distilled checkpoint loads.
    assert m.is_distilled is False
    assert m.default_num_steps == 35
    assert m.default_guidance == 5.0
    assert m.uses_negative_prompt is True
    assert m.flow_shift == 3.0
    # Native 480p resolution (the old 640x352 default was below-native and
    # produced soft output).
    assert m.default_width == 832
    assert m.default_height == 480


def test_effective_settings_shape():
    m = wan_inference.WanModel()
    s = m.effective_settings()
    for key in ("distilled", "num_steps", "guidance_scale", "flow_shift",
                "negative_prompt", "width", "height", "checkpoint"):
        assert key in s


# ------------------------------------------------------------- env overrides

def test_env_overrides_for_generation_vars(monkeypatch):
    monkeypatch.setenv("WAN_NUM_STEPS", "30")
    monkeypatch.setenv("WAN_GUIDANCE_SCALE", "7.5")
    monkeypatch.setenv("WAN_WIDTH", "768")
    monkeypatch.setenv("WAN_HEIGHT", "432")
    assert wan_inference._env_int("WAN_NUM_STEPS") == 30
    assert wan_inference._env_float("WAN_GUIDANCE_SCALE") == 7.5
    m = wan_inference.WanModel()
    # The __init__ defaults stay at auto; load() applies envs — here we just
    # prove the helpers parse properly (including garbage).
    assert wan_inference._env_int("WAN_NUM_STEPS", 35) == 30
    assert wan_inference._env_int("WAN_WIDTH", 832) == 768


def test_env_helpers_ignore_garbage(monkeypatch):
    monkeypatch.setenv("WAN_NUM_STEPS", "not-a-number")
    monkeypatch.setenv("WAN_GUIDANCE_SCALE", "")
    assert wan_inference._env_int("WAN_NUM_STEPS", 35) == 35
    assert wan_inference._env_float("WAN_GUIDANCE_SCALE", 5.0) == 5.0
    assert wan_inference._env_bool("WAN_DISTILLED_BETA", True) is True


def test_candidate_paths_are_deduped(monkeypatch):
    monkeypatch.setenv("WAN_MODEL_PATH", "")
    monkeypatch.setenv("WAN_SAFETENSORS", "models/Mega-v3/x.safetensors")
    paths = wan_inference._candidate_paths()
    assert paths, "expected at least one candidate"
    assert len(paths) == len(set(paths))
