import os
import sys
from huggingface_hub import snapshot_download

repo_id = os.environ.get("WAN_MODEL_ID") or "Wan-AI/Wan2.2-T2V-A14B-Diffusers"
token = os.environ.get("HF_TOKEN") or None
print(f"Starting download of {repo_id}...")
snapshot_download(repo_id=repo_id, token=token, resume_download=True)
print("Finished!")
