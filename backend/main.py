"""
main.py — FastAPI application for TourGuide AI.
"""

import asyncio
import os
import uuid
from collections.abc import Mapping, Sequence
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from models import create_room, create_job, rooms, jobs, get_room as _get_room_data
from schemas import (
    UploadResponse,
    ReconstructionResponse,
    JobStatusResponse,
    RoomResponse,
    HealthResponse,
)
from storage import (
    save_panorama_upload,
    save_upload,
    validate_panorama_extension,
    validate_video_extension,
)
from jobs import run_panorama_processing, run_reconstruction

# ---------------------------------------------------------------------------
# App initialization
# ---------------------------------------------------------------------------

app = FastAPI(
    title="RoomShare — Backend",
    description="Panorama-first MVP backend for immersive room tours.",
    version="0.1.0",
)

# CORS — allow the deployed frontend(s) in production, and all origins in dev.
# FRONTEND_URL may be a single origin or a comma-separated list of origins.
# We also always allow this project's Vercel deployments (production + preview
# URLs change per deployment) and local dev servers via a regex, so the API
# keeps working without re-pinning FRONTEND_URL on every new frontend deploy.
_frontend_url = os.environ.get("FRONTEND_URL", "")
_cors_origins = [o.strip() for o in _frontend_url.split(",") if o.strip()]

# Matches https://tourguideai-monorepo*.vercel.app (prod alias + preview builds)
# and http://localhost:<port> / http://127.0.0.1:<port> for local development.
# Fully anchored so it is safe whether Starlette uses re.match or re.fullmatch.
_cors_origin_regex = (
    r"^(https://tourguideai[a-z0-9-]*\.vercel\.app"
    r"|http://(localhost|127\.0\.0\.1)(:\d+)?)$"
)

_cors_kwargs = dict(
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_origin_regex=_cors_origin_regex,
)

# If no explicit origins are configured, fall back to allowing all (dev only).
_cors_kwargs["allow_origins"] = _cors_origins if _cors_origins else ["*"]

app.add_middleware(CORSMiddleware, **_cors_kwargs)


def _to_builtin_json(value):
    """Recursively coerce numpy-like scalars/containers into builtin Python types."""
    if isinstance(value, Mapping):
        return {key: _to_builtin_json(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_to_builtin_json(item) for item in value]
    if hasattr(value, "item") and callable(value.item):
        try:
            return _to_builtin_json(value.item())
        except Exception:
            pass
    if hasattr(value, "tolist") and callable(value.tolist):
        try:
            return _to_builtin_json(value.tolist())
        except Exception:
            pass
    return value


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Upload panorama image
# ---------------------------------------------------------------------------

@app.post(
    "/upload-room-panorama",
    response_model=UploadResponse,
    tags=["Rooms"],
    summary="Upload a panorama image",
)
async def upload_room_panorama(
    file: UploadFile = File(..., description="Panorama image file"),
    name: str | None = Form(None, description="Optional room name"),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="A panorama image file is required.")

    if not validate_panorama_extension(file.filename):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Upload a JPG, JPEG, PNG, or WEBP panorama image.",
        )

    room_name = (name or "").strip() or Path(file.filename).stem
    room_id = str(uuid.uuid4())
    file_path = await save_panorama_upload(file, room_id)

    room = create_room(
        room_id=room_id,
        room_name=room_name,
        filename=file.filename,
        file_path=file_path,
        source_type="panorama",
    )

    return UploadResponse(
        room_id=room["room_id"],
        room_name=room["room_name"],
        filename=room["filename"],
        status=room["status"],
    )


# ---------------------------------------------------------------------------
# Upload room video (legacy)
# ---------------------------------------------------------------------------

@app.post(
    "/upload-room-video",
    response_model=UploadResponse,
    tags=["Rooms"],
    summary="Upload a room video",
)
async def upload_room_video(
    room_name: str = Form(..., description="Human-readable room name"),
    video: UploadFile = File(..., description="MP4 video file of the room"),
):
    if not room_name or not room_name.strip():
        raise HTTPException(status_code=400, detail="room_name is required.")

    if not video.filename:
        raise HTTPException(status_code=400, detail="A video file is required.")

    if not validate_video_extension(video.filename):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only MP4 files are accepted.",
        )

    room_id = str(uuid.uuid4())
    file_path = await save_upload(video, room_id)

    room = create_room(
        room_id=room_id,
        room_name=room_name.strip(),
        filename=video.filename,
        file_path=file_path,
        source_type="video",
    )

    return UploadResponse(
        room_id=room["room_id"],
        room_name=room["room_name"],
        filename=room["filename"],
        status=room["status"],
    )


# ---------------------------------------------------------------------------
# Start reconstruction
# ---------------------------------------------------------------------------

def _create_processing_job(room_id: str) -> tuple[dict, str]:
    room = rooms[room_id]
    source_type = room.get("source_type", "video")
    if source_type == "panorama":
        return (
            create_job(
                job_id=str(uuid.uuid4()),
                room_id=room_id,
                status="validating_panorama",
                processing_stage="validating_panorama",
                progress=10,
                message="Queued panorama validation",
            ),
            "panorama",
        )
    return (
        create_job(
            job_id=str(uuid.uuid4()),
            room_id=room_id,
            status="extracting_frames",
            processing_stage="extracting_frames",
            progress=10,
            message="Queued frame extraction",
        ),
        "video",
    )


def _start_processing_task(job_id: str, room_id: str, source_type: str) -> None:
    if source_type == "panorama":
        asyncio.create_task(run_panorama_processing(job_id, room_id))
    else:
        asyncio.create_task(run_reconstruction(job_id, room_id))


@app.post(
    "/start-reconstruction/{room_id}",
    response_model=ReconstructionResponse,
    tags=["Reconstruction"],
    summary="Start room processing",
)
async def start_reconstruction(room_id: str):
    room = _get_room_data(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")

    if room.get("status") == "processing":
        raise HTTPException(status_code=400, detail="Room is already processing.")

    job, source_type = _create_processing_job(room_id)
    rooms[room_id]["status"] = "processing"
    _start_processing_task(job["job_id"], room_id, source_type)

    return ReconstructionResponse(
        job_id=job["job_id"],
        room_id=job["room_id"],
        status=job["status"],
    )


@app.post(
    "/start-panorama-processing/{room_id}",
    response_model=ReconstructionResponse,
    tags=["Reconstruction"],
    summary="Start panorama processing",
)
async def start_panorama_processing(room_id: str):
    room = _get_room_data(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")

    if room.get("source_type") != "panorama":
        raise HTTPException(status_code=400, detail="Room does not contain a panorama upload.")

    if room.get("status") == "processing":
        raise HTTPException(status_code=400, detail="Room is already processing.")

    job, source_type = _create_processing_job(room_id)
    rooms[room_id]["status"] = "processing"
    _start_processing_task(job["job_id"], room_id, source_type)

    return ReconstructionResponse(
        job_id=job["job_id"],
        room_id=job["room_id"],
        status=job["status"],
    )


# ---------------------------------------------------------------------------
# Poll job status
# ---------------------------------------------------------------------------

@app.get(
    "/job-status/{job_id}",
    response_model=JobStatusResponse,
    tags=["Reconstruction"],
    summary="Check reconstruction job progress",
)
async def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found.")

    job = jobs[job_id]
    return JobStatusResponse(
        job_id=job["job_id"],
        room_id=job["room_id"],
        status=job["status"],
        processing_stage=job.get("processing_stage"),
        progress=job["progress"],
        message=job.get("message"),
        error=job.get("error"),
    )


# ---------------------------------------------------------------------------
# Fetch room details
# ---------------------------------------------------------------------------

@app.get(
    "/room/{room_id}",
    response_model=RoomResponse,
    tags=["Rooms"],
    summary="Get room details",
)
async def get_room(room_id: str):
    room = _get_room_data(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")

    viewer_config = _to_builtin_json(room.get("viewer_config"))
    metrics = _to_builtin_json(room.get("metrics"))
    processing_summary = _to_builtin_json(room.get("processing_summary"))
    return RoomResponse(
        room_id=room["room_id"],
        room_name=room["room_name"],
        filename=room["filename"],
        status=room["status"],
        source_type=room.get("source_type"),
        original_video_path=room.get("original_video_path"),
        original_panorama_path=room.get("original_panorama_path"),
        panorama_path=room.get("panorama_path"),
        panorama_url=room.get("panorama_url"),
        preview_path=room.get("preview_path"),
        preview_url=room.get("preview_url"),
        viewer_type=room.get("viewer_type"),
        processing_stage=room.get("processing_stage"),
        processing_summary=processing_summary,
        error_message=room.get("error_message"),
        scene_url=room.get("scene_url"),
        thumbnail=room.get("thumbnail"),
        pointcloud_url=room.get("pointcloud_url"),
        dense_view_url=room.get("dense_view_url"),
        viewer_config=viewer_config,
        metrics=metrics,
        quality_assessment=room.get("quality_assessment"),
    )
