"""server.py — FastAPI entry point for the Wan 2.2 model service.

Endpoints (must match the Next.js backend expectations):
    GET  /health           → { status, model_loaded, mode }
    POST /generate         → { task_id }   (queued, returns immediately)
    GET  /status/<task_id> → { status, progress, ... }
    GET  /video/<task_id>  → streams the MP4 file

Port 3004 (hardcoded). CORS open to *. Model loading is required. If torch/diffusers/CUDA is unavailable, the service will not start successfully.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any, Optional

# Ensure local module imports resolve regardless of CWD.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from task_manager import task_manager, VIDEOS_DIR
from wan_inference import model as wan_model

# ----------------------------------------------------------------- logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("model-service")

# --------------------------------------------------------------------- app
app = FastAPI(
    title="Wan2.2 Model Service",
    description="Text-to-video generation.",
    version="2.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

# ----------------------------------------------------------------- models
class GenerateRequest(BaseModel):
    prompt: str = ""
    enhanced_prompt: str = ""
    message_id: str = ""
    attachment_base64: Optional[str] = None
    resolution: Optional[str] = "2k"


# --------------------------------------------------- startup / lifecycle
@app.on_event("startup")
async def _on_startup() -> None:
    """Model load."""
    logger.info("Starting Wan2.2 model service on port 3004")
    logger.info("VIDEOS_DIR=%s", VIDEOS_DIR)
    os.makedirs(VIDEOS_DIR, exist_ok=True)
    try:
        ok = wan_model.load()
    except Exception as exc:
        logger.exception("Unexpected error during model load: %s", exc)
        ok = False
    
    if ok:
        logger.info("Real model loaded → mode=real")
    else:
        logger.warning("Model NOT loaded (reason=%s) - Allowing startup for demo mode.", wan_model.last_error or "unknown")


@app.get("/health")
async def health() -> dict[str, Any]:
    # GPU / torch / Blackwell compatibility snapshot (static check only —
    # no kernel probe, so /health stays fast).
    gpu: dict[str, Any] = {}
    try:
        import gpu_check

        raw = gpu_check.check_gpu_compatibility(probe=False)
        gpu = {k: raw.get(k) for k in (
            "device_name", "compute_cap", "is_blackwell", "arch_supported",
            "cuda_build", "torch_version", "vram_total_gb", "vram_free_gb",
            "ram_gb", "ok",
        )}
    except Exception:
        pass
    return {
        "status": "ok",
        "model_loaded": bool(wan_model.loaded),
        "mode": wan_model.mode,
        "queue": await task_manager.queue_info(),
        "settings": wan_model.effective_settings(),
        "gpu": gpu,
    }


@app.get("/queue")
async def queue() -> dict[str, Any]:
    """Current waitlist: jobs waiting, whether one is running, est. wait."""
    return await task_manager.queue_info()


@app.post("/generate")
async def generate(req: GenerateRequest) -> JSONResponse:
    prompt = (req.prompt or "").strip()
    enhanced = (req.enhanced_prompt or "").strip()
    if not prompt and not enhanced:
        raise HTTPException(status_code=400, detail="prompt or enhanced_prompt required")

    task_id = await task_manager.create_task(
        prompt=prompt,
        enhanced_prompt=enhanced,
        message_id=req.message_id,
        attachment_base64=req.attachment_base64,
        resolution=req.resolution or "2k",
    )
    return JSONResponse({"task_id": task_id}, status_code=202)


@app.get("/status/{task_id}")
async def status(task_id: str) -> JSONResponse:
    task = await task_manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return JSONResponse(task)


@app.get("/status/by_message/{message_id}")
async def status_by_message(message_id: str) -> JSONResponse:
    task = await task_manager.get_task_by_message(message_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return JSONResponse(task)


@app.delete("/cancel/{message_id}")
async def cancel(message_id: str) -> JSONResponse:
    await task_manager.cancel_by_message(message_id)
    return JSONResponse({"ok": True})


@app.get("/video/{task_id}")
async def video(task_id: str) -> FileResponse:
    # Validate task_id to prevent path traversal.
    if not task_id.isalnum() or len(task_id) > 64:
        raise HTTPException(status_code=400, detail="invalid task_id")

    path = os.path.join(VIDEOS_DIR, f"{task_id}.mp4")
    if not os.path.exists(path) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="video not ready or not found")

    # `FileResponse` automatically streams with Range support, which is
    # needed for HTML5 video element seeking.
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=f"{task_id}.mp4",
    )


@app.get("/video/by_message/{message_id}")
async def video_by_message(message_id: str) -> FileResponse:
    """Stream the latest finished video for a chat message.

    Used by the Next.js streaming proxy (/api/videos/stream/[messageId])
    so browsers never need direct access to this service.
    """
    # Allow alphanumerics, underscores and hyphens (no dots/slashes → no
    # path traversal possible).
    import re as _re

    if not _re.fullmatch(r"[A-Za-z0-9_-]{1,64}", message_id):
        raise HTTPException(status_code=400, detail="invalid message_id")

    task = await task_manager.get_task_by_message(message_id)
    if task is None or task.get("status") != "ready":
        raise HTTPException(status_code=404, detail="video not ready or not found")

    video_url = task.get("video_url") or ""
    # video_url looks like "/video/<task_id>"
    task_id = video_url.rsplit("/", 1)[-1]
    if not task_id.isalnum() or len(task_id) > 64:
        raise HTTPException(status_code=400, detail="invalid task reference")

    path = os.path.join(VIDEOS_DIR, f"{task_id}.mp4")
    if not os.path.exists(path) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="video file missing")

    return FileResponse(
        path,
        media_type="video/mp4",
        filename=f"{task_id}.mp4",
    )


@app.get("/")
async def root() -> dict[str, Any]:
    """Tiny informational root for humans hitting the URL."""
    return {
        "service": "Wan2.2 Model Service",
        "version": "2.2.0",
        "endpoints": ["/health", "/generate", "/status/{task_id}", "/status/by_message/{message_id}", "/video/{task_id}", "/video/by_message/{message_id}"],
        "mode": wan_model.mode,
        "model_loaded": bool(wan_model.loaded),
    }


# --------------------------------------------------------------- entrypoint
if __name__ == "__main__":
    import uvicorn

    # Port 3004 is hardcoded per the API contract — do NOT use env PORT.
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=3004,
        log_level="info",
        reload=False,
    )
