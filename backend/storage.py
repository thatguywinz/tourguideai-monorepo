"""
storage.py — File storage helpers for TourGuide AI backend.

Uploads are saved locally first (needed for PIL/OpenCV processing pipeline),
then processed outputs are pushed to Supabase Storage for permanent,
CDN-served hosting.  Local temp files survive only for the lifetime of the
Render instance and are not relied on after processing completes.
"""

import os
from pathlib import Path

from fastapi import UploadFile

from db import get_supabase

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

UPLOAD_DIR = Path("uploads")
ALLOWED_VIDEO_EXTENSIONS = {".mp4"}
ALLOWED_PANORAMA_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

STORAGE_BUCKET = "panoramas"


def _ensure_upload_dir() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def validate_video_extension(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_VIDEO_EXTENSIONS


def validate_panorama_extension(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_PANORAMA_EXTENSIONS


# ---------------------------------------------------------------------------
# Local disk save (used by the processing pipeline)
# ---------------------------------------------------------------------------

async def save_upload(file: UploadFile, room_id: str, stem: str = "original_video") -> str:
    """Save an uploaded file to local disk and return the local path."""
    _ensure_upload_dir()
    room_dir = UPLOAD_DIR / room_id
    room_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename or "").suffix
    file_path = room_dir / f"{stem}{ext.lower() or '.bin'}"

    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    return str(file_path)


async def save_panorama_upload(file: UploadFile, room_id: str) -> str:
    """Save a panorama upload to local disk (for processing) and return local path."""
    return await save_upload(file, room_id, stem="original_panorama")


# ---------------------------------------------------------------------------
# Supabase Storage helpers
# ---------------------------------------------------------------------------

def upload_file_to_supabase(local_path: str | Path, storage_path: str) -> str:
    """Upload a local file to Supabase Storage and return its public CDN URL."""
    local_path = Path(local_path)
    supabase = get_supabase()

    with open(local_path, "rb") as f:
        data = f.read()

    content_type = _guess_content_type(local_path.suffix.lower())
    supabase.storage.from_(STORAGE_BUCKET).upload(
        storage_path,
        data,
        {"content-type": content_type, "upsert": "true"},
    )

    return supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)


def _guess_content_type(ext: str) -> str:
    mapping = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }
    return mapping.get(ext, "application/octet-stream")


def upload_panorama_output(local_path: str | Path, room_id: str) -> str:
    """Upload a processed panorama file to Supabase Storage.

    Storage path: panoramas/<room_id>/<filename>
    Returns the public CDN URL.
    """
    local_path = Path(local_path)
    storage_path = f"panoramas/{room_id}/{local_path.name}"
    return upload_file_to_supabase(local_path, storage_path)
