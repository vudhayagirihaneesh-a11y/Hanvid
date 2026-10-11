"""Standalone prompt encoder script for Wan 2.2 / UMT5-XXL.
Loads weights directly from local AIO checkpoint without any remote network downloads.
"""
import os, sys, time, argparse
import torch
from transformers import UMT5EncoderModel, AutoConfig, AutoTokenizer
from safetensors import safe_open

def encode(checkpoint_path: str, snapshot_path: str, text: str, output_path: str, max_seq_len: int = 512):
    t0 = time.time()
    config_dir = os.path.join(snapshot_path, "text_encoder")
    config = AutoConfig.from_pretrained(config_dir, local_files_only=True)
    with torch.device("meta"):
        meta_model = UMT5EncoderModel(config).to(dtype=torch.bfloat16)
    model = meta_model.to_empty(device="cpu")

    prefix = "text_encoders.umt5xxl.transformer."
    with safe_open(checkpoint_path, framework="pt") as handle:
        scales = {}
        for k in handle.keys():
            if k.startswith(prefix) and k.endswith(".scale_weight"):
                scales[k[len(prefix):-len(".scale_weight")]] = handle.get_tensor(k)

        named_params = dict(model.named_parameters())
        for name, param in named_params.items():
            aio_key = prefix + name
            if aio_key not in handle.keys():
                if name in ("encoder.embed_tokens.weight", "shared.weight"):
                    aio_key = prefix + "shared.weight"
            if aio_key in handle.keys():
                tensor = handle.get_tensor(aio_key)
                clean = aio_key[len(prefix):]
                if clean in scales:
                    tensor = (tensor.to(torch.bfloat16) * scales[clean]).to(torch.bfloat16)
                else:
                    tensor = tensor.to(torch.bfloat16)
                with torch.no_grad():
                    param.copy_(tensor)
                del tensor

    tokenizer = AutoTokenizer.from_pretrained(os.path.join(snapshot_path, "tokenizer"), local_files_only=True)
    cleaned_text = " ".join(text.split())
    tok = tokenizer(
        [cleaned_text],
        padding="max_length",
        max_length=max_seq_len,
        truncation=True,
        return_tensors="pt"
    )
    with torch.inference_mode():
        hidden = model(tok.input_ids, tok.attention_mask).last_hidden_state

    n = int(tok.attention_mask.sum().item())
    hidden = hidden[0, :n].to(torch.float16)
    out = hidden.new_zeros(max_seq_len, hidden.size(-1))
    out[:n] = hidden
    embeds = out.unsqueeze(0)

    torch.save(embeds, output_path)
    print(f"SUCCESS: Encoded prompt shape {embeds.shape} saved to {output_path} in {time.time()-t0:.2f}s")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ckpt", required=True)
    parser.add_argument("--snap", required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    encode(args.ckpt, args.snap, args.text, args.out)
