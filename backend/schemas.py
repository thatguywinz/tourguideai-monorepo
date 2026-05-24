"""
schemas.py — Pydantic response schemas for TourGuide AI MVP.

Defines the shape of every JSON response returned by the API.
"""

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class UploadResponse(BaseModel):
    """Returned after a successful video or panorama upload."""
    room_id: str
    room_name: str
    filename: str
    status: str


class ReconstructionResponse(BaseModel):
    """Returned after starting a reconstruction job."""
    job_id: str
    room_id: str
    status: str


class JobStatusResponse(BaseModel):
    """Returned when polling a job's progress."""
    job_id: str
    room_id: str
    status: str
    processing_stage: str | None = None
    progress: int
    message: str | None = None
    error: str | None = None


class RoomResponse(BaseModel):
    """Full room record."""
    room_id: str
    room_name: str
    filename: str
    status: str
    source_type: str | None = None
    original_video_path: str | None = None
    original_panorama_path: str | None = None
    panorama_path: str | None = None
    panorama_url: str | None = None
    preview_path: str | None = None
    preview_url: str | None = None
    viewer_type: str | None = None
    processing_stage: str | None = None
    processing_summary: dict | None = None
    error_message: str | None = None
    scene_url: str | None = None
    thumbnail: str | None = None
    pointcloud_url: str | None = None
    dense_view_url: str | None = None
    viewer_config: dict | None = None
    metrics: dict | None = None
    quality_assessment: str | None = None
    error: str | None = None


class HealthResponse(BaseModel):
    """Health-check response."""
    status: str


class ErrorResponse(BaseModel):
    """Standard error envelope."""
    detail: str
