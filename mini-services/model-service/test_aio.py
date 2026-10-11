import torch
from diffusers import WanPipeline, WanTransformer3DModel

model_path = "models/Mega-v3/wan2.2-rapid-mega-aio-v3.safetensors"

print("Attempting to load AIO transformer...")
try:
    transformer = WanTransformer3DModel.from_single_file(
        model_path,
        torch_dtype=torch.bfloat16
    )
    print("SUCCESS: AIO Transformer loaded into Diffusers!")
except Exception as e:
    print(f"FAILED to load: {e}")
