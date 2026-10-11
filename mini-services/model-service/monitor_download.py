import os
import glob
import time

TARGET_GB = 23.3
TARGET_BYTES = TARGET_GB * 1024**3

print("\n🚀 Monitoring Wan2.2 Mega AIO Download...")
print(f"Target size: {TARGET_GB} GB\n")

while True:
    incomplete_files = glob.glob('models/.cache/huggingface/download/**/*.incomplete', recursive=True)
    safetensors_files = glob.glob('models/Mega-v3/*.safetensors')
    
    downloaded_bytes = 0
    if safetensors_files:
        downloaded_bytes = sum(os.path.getsize(f) for f in safetensors_files)
    elif incomplete_files:
        downloaded_bytes = sum(os.path.getsize(f) for f in incomplete_files)
        
    downloaded_gb = downloaded_bytes / (1024**3)
    percentage = min((downloaded_bytes / TARGET_BYTES) * 100, 100.0)
    
    if safetensors_files and downloaded_gb > 20:
        print(f"\r✅ Download COMPLETE! Total size: {downloaded_gb:.2f} GB / {TARGET_GB} GB [100.00%]", end="")
        break
        
    bar_length = 30
    filled = int(bar_length * (percentage / 100))
    bar = "█" * filled + "-" * (bar_length - filled)
    
    print(f"\rDownloading: [{bar}] {downloaded_gb:.2f} GB / {TARGET_GB} GB ({percentage:.2f}%)", end="", flush=True)
    time.sleep(1)
