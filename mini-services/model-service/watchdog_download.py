import os
import time
import subprocess
import sys
from pathlib import Path

repo_id = os.environ.get("WAN_MODEL_ID") or "Wan-AI/Wan2.2-T2V-A14B-Diffusers"
token = os.environ.get("HF_TOKEN") or None
clean_repo = repo_id.replace("/", "--")
cache_dir = Path(os.path.expanduser(f"~/.cache/huggingface/hub/models--{clean_repo}/blobs"))

if token:
    os.environ["HF_TOKEN"] = token
os.environ["PYTHONUNBUFFERED"] = "1"

def get_cache_size():
    if not cache_dir.exists():
        return 0
    return sum(f.stat().st_size for f in cache_dir.glob("*"))

print(f"Starting robust download manager for {repo_id}...", flush=True)

while True:
    process = subprocess.Popen(
        [sys.executable, "download_model.py", repo_id],
    )
    
    last_size = get_cache_size()
    stuck_time = 0
    
    while process.poll() is None:
        time.sleep(20)
        current_size = get_cache_size()
        
        if current_size > last_size:
            diff_mb = (current_size - last_size) / (1024 * 1024)
            print(f"Progress: +{diff_mb:.2f} MB downloaded (total cached: {current_size/(1024**3):.2f} GB)...", flush=True)
            last_size = current_size
            stuck_time = 0
        else:
            stuck_time += 20
            print(f"Checking stream ({stuck_time}s without blob size change)...", flush=True)
            
            if stuck_time >= 900:
                print("Download appears stalled for 15 mins. Restarting download process...", flush=True)
                process.kill()
                break
                
    if process.poll() == 0:
        print("Download fully completed successfully!", flush=True)
        break
        
    print("Restarting in 5 seconds...", flush=True)
    time.sleep(5)
