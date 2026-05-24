"""
models.py — Room and Job records for TourGuide AI.

In-memory dicts are the source of truth during an active processing job
(jobs.py writes directly to them).  Key state transitions are also synced
to Supabase so room data survives server restarts.
"""

from datetime import datetime

from db import get_supabase

# ---------------------------------------------------------------------------
# In-memory stores (used by jobs.py processing pipeline)
# ---------------------------------------------------------------------------

rooms: dict[str, dict] = {}
jobs: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Supabase sync helpers
# ---------------------------------------------------------------------------

def _upsert_room(room: dict) -> None:
    """Write a room record to Supabase (upsert so duplicate calls are safe)."""
    try:
        row = {
            "room_id": room["room_id"],
            "room_name": room["room_name"],
            "filename": room["filename"],
            "source_type": room.get("source_type", "panorama"),
            "status": room["status"],
            "panorama_url": room.get("panorama_url"),
            "preview_url": room.get("preview_url"),
            "viewer_type": room.get("viewer_type"),
            "viewer_config": room.get("viewer_config"),
            "processing_stage": room.get("processing_stage"),
            "error_message": room.get("error_message"),
            "updated_at": datetime.utcnow().isoformat(),
        }
        get_supabase().table("api_rooms").upsert(row).execute()
    except Exception as e:
        print(f"[models] Supabase upsert failed for room {room.get('room_id')}: {e}")


def _load_room_from_db(room_id: str) -> dict | None:
    """Fetch a room record from Supabase by room_id."""
    try:
        result = (
            get_supabase()
            .table("api_rooms")
            .select("*")
            .eq("room_id", room_id)
            .maybe_single()
            .execute()
        )
        return result.data
    except Exception as e:
        print(f"[models] Supabase fetch failed for room {room_id}: {e}")
        return None


# ---------------------------------------------------------------------------
# Factory helpers
# ---------------------------------------------------------------------------

def create_room(
    room_id: str,
    room_name: str,
    filename: str,
    file_path: str,
    source_type: str = "video",
) -> dict:
    """Create a new Room record in memory and persist it to Supabase."""
    is_panorama = source_type == "panorama"
    room = {
        "room_id": room_id,
        "room_name": room_name,
        "filename": filename,
        "file_path": file_path,
        "source_type": source_type,
        "original_video_path": None if is_panorama else file_path,
        "original_panorama_path": file_path if is_panorama else None,
        "status": "uploaded",
        "viewer_type": None,
        "processing_stage": "uploaded",
        "processing_summary": {
            "input_type": source_type,
            "output_resolution": None,
        },
        "panorama_path": None,
        "panorama_url": None,
        "preview_path": None,
        "preview_url": None,
        "error_message": None,
        "scene_url": None,
        "thumbnail": None,
        "pointcloud_url": None,
        "dense_view_url": None,
        "viewer_config": None,
        "metrics": {},
        "quality_assessment": None,
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
    }
    rooms[room_id] = room
    _upsert_room(room)
    return room


def get_room(room_id: str) -> dict | None:
    """Return room from memory, falling back to Supabase if not in memory."""
    if room_id in rooms:
        return rooms[room_id]
    db_room = _load_room_from_db(room_id)
    if db_room:
        rooms[room_id] = db_room
    return db_room


def save_room(room_id: str) -> None:
    """Sync current in-memory room state to Supabase."""
    if room_id in rooms:
        _upsert_room(rooms[room_id])


def create_job(
    job_id: str,
    room_id: str,
    *,
    status: str = "queued",
    processing_stage: str = "queued",
    progress: int = 0,
    message: str | None = None,
) -> dict:
    """Create a new Job record in memory (jobs are transient; not persisted to DB)."""
    job = {
        "job_id": job_id,
        "room_id": room_id,
        "status": status,
        "processing_stage": processing_stage,
        "progress": progress,
        "message": message,
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
    }
    jobs[job_id] = job
    return job
