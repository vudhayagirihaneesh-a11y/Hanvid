"""download_model.py — Download official Wan 2.2 diffusers models.

Usage:
    python download_model.py           # Downloads default Wan 2.2 (14B or configured)
    python download_model.py 14b       # Downloads Wan-AI/Wan2.2-T2V-A14B-Diffusers
    python download_model.py 5b        # Downloads Wan-AI/Wan2.2-TI2V-5B-Diffusers

Supports resuming interrupted downloads.
"""

import os
import sys
from huggingface_hub import snapshot_download

# Default Hugging Face token if not in environment
HF_TOKEN = os.environ.get("HF_TOKEN") or None

MODELS = {
    "14b": "Wan-AI/Wan2.2-T2V-A14B-Diffusers",
    "5b": "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
}

def get_target_model() -> str:
    if len(sys.argv) > 1:
        arg = sys.argv[1].strip().lower()
        if arg in MODELS:
            return MODELS[arg]
        return sys.argv[1].strip()
    return os.environ.get("WAN_MODEL_ID") or "Wan-AI/Wan2.2-T2V-A14B-Diffusers"

def main():
    repo_id = get_target_model()
    print(f"==================================================", flush=True)
    print(f" Official Wan 2.2 Model Downloader", flush=True)
    print(f" Target: {repo_id}", flush=True)
    print(f"==================================================", flush=True)

    try:
        print("Starting snapshot download (resumable)...", flush=True)
        local_path = snapshot_download(
            repo_id=repo_id,
            token=HF_TOKEN,
            resume_download=True,
        )
        print(f"\n[SUCCESS] Model successfully downloaded to:\n  {local_path}", flush=True)
    except Exception as e:
        print(f"\n[ERROR] Download failed: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
