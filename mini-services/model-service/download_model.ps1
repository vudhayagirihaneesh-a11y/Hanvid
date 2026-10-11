# Ensure the models directory exists
New-Item -ItemType Directory -Force -Path "models" | Out-Null

Write-Host "Downloading wan2.1_t2v_1.3B_fp16.safetensors (~2.6GB) directly via curl..."
Write-Host "This will take a few minutes depending on your internet connection."

# Use Windows built-in curl.exe to download the file directly from HuggingFace
curl.exe -L "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors?download=true" -o "models\wan2.1_t2v_1.3B_fp16.safetensors"

Write-Host "Download complete! Saved to models\wan2.1_t2v_1.3B_fp16.safetensors"
