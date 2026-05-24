# TourGuide AI Backend

TourGuide AI Backend is a FastAPI service that turns either:

- a direct panorama image upload, or
- a short MP4 room sweep

into web-ready panorama assets plus viewer metadata for an immersive room-tour frontend.

The current codebase is a panorama-first MVP. It produces panorama images, preview images, and rendering metadata. It does not currently expose a finished 3D NeRF or point-cloud product through the public API, even though some legacy reconstruction helpers still exist in the repository.

## What the app does

- Accepts direct panorama uploads: `.jpg`, `.jpeg`, `.png`, `.webp`
- Accepts room videos: `.mp4`
- Stores uploads on the local filesystem under `uploads/<room_id>/`
- Runs background processing with in-memory job tracking
- For video uploads:
  - extracts frames with FFmpeg
  - removes blurry, low-contrast, badly exposed, and redundant frames
  - estimates the camera sweep
  - composes a panorama
  - normalizes it onto a 2:1 immersive canvas
  - blends the wrap seam and exports delivery assets
- For direct panorama uploads:
  - validates the image
  - classifies it as `panorama_360`, `panorama_partial`, or `panorama_flat`
  - optimizes it for viewer delivery
  - exports delivery assets
- Serves generated files directly from `/uploads/...`
- Returns viewer metadata that a frontend can use to decide whether to render:
  - a full 360 equirectangular viewer
  - a bounded partial panorama viewer
  - a flat panorama fallback

## Current scope and limitations

- State is stored in memory:
  - rooms and jobs are held in Python dictionaries in `models.py`
  - restarting the server clears all job and room records
- Files are stored only on local disk:
  - there is no S3/GCS/database integration yet
- CORS is fully open:
  - suitable for development, not hardened production use
- There is no authentication, authorization, rate limiting, or persistence layer
- `pointcloud_url` and `dense_view_url` are currently placeholders and are not populated by the active API flows
- Run this app with a single worker unless you replace the in-memory stores with shared persistence

## Tech stack

- FastAPI
- Uvicorn
- Pydantic
- NumPy
- Pillow
- OpenCV (`opencv-python-headless`)
- FFmpeg for video frame extraction

## Repository layout

```text
.
|-- main.py                  # FastAPI app and routes
|-- jobs.py                  # Background processing orchestration
|-- panorama.py              # Panorama validation, frame selection, stitching, export
|-- config.py                # Tunable thresholds and quality constants
|-- models.py                # In-memory room/job stores
|-- schemas.py               # API response models
|-- storage.py               # Upload validation and disk persistence helpers
|-- test_api.py              # Optional smoke-test script
|-- _build_gsplat_manual.py  # Legacy helper for manual gsplat build work
|-- uploads/                 # Runtime-generated assets (gitignored)
```

## Requirements

### Required

- Python 3.10 or newer
- FFmpeg available on `PATH` if you want to process uploaded videos

### Python dependencies

Install from `requirements.txt`:

```text
fastapi
uvicorn[standard]
python-multipart
pydantic
numpy
pillow
opencv-python-headless
```

### Optional

- `requests` if you want to run `test_api.py`

## Setup

### Windows PowerShell

```powershell
python -m venv .venv
. .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### Verify FFmpeg

```bash
ffmpeg -version
```

If FFmpeg is missing, the direct panorama-upload flow can still work, but video processing will fail when frame extraction starts.

## Run the app

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Keep this as a single-worker process. The app stores room/job state in memory, so multiple workers will not share the same state.

Once the server is running:

- API root: `http://127.0.0.1:8000`
- Swagger UI: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`
- Uploaded/generated files: `http://127.0.0.1:8000/uploads/...`

## No environment variables are required

The current codebase does not rely on a `.env` file or mandatory runtime environment variables for the active panorama flows.

## How to use the API

### 1. Health check

```bash
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok"}
```

### 2. Panorama upload flow

Upload an existing panorama image:

```bash
curl -X POST "http://127.0.0.1:8000/upload-room-panorama" -F "file=@my-panorama.jpg" -F "name=Suite 1201"
```

Start processing:

```bash
curl -X POST "http://127.0.0.1:8000/start-panorama-processing/<room_id>"
```

Poll the job:

```bash
curl "http://127.0.0.1:8000/job-status/<job_id>"
```

Fetch the room result:

```bash
curl "http://127.0.0.1:8000/room/<room_id>"
```

### 3. Video upload flow

Upload a room sweep video:

```bash
curl -X POST "http://127.0.0.1:8000/upload-room-video" -F "room_name=Living Room" -F "video=@room-sweep.mp4"
```

Start processing:

```bash
curl -X POST "http://127.0.0.1:8000/start-reconstruction/<room_id>"
```

Poll the job:

```bash
curl "http://127.0.0.1:8000/job-status/<job_id>"
```

Fetch the room result:

```bash
curl "http://127.0.0.1:8000/room/<room_id>"
```

## API reference

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/upload-room-panorama` | Upload a panorama image |
| `POST` | `/upload-room-video` | Upload an MP4 room video |
| `POST` | `/start-reconstruction/{room_id}` | Start processing for a room; used for video uploads and can also dispatch panorama rooms |
| `POST` | `/start-panorama-processing/{room_id}` | Explicit panorama-processing endpoint for direct panorama uploads |
| `GET` | `/job-status/{job_id}` | Poll job stage, progress, and errors |
| `GET` | `/room/{room_id}` | Get the full room record and generated asset URLs |

## Request details

### `POST /upload-room-panorama`

Multipart form fields:

- `file`: required panorama image
- `name`: optional room name; defaults to the uploaded filename stem

### `POST /upload-room-video`

Multipart form fields:

- `room_name`: required
- `video`: required MP4 file

## Response model summary

### Upload response

Returns:

- `room_id`
- `room_name`
- `filename`
- `status`

### Job status response

Returns:

- `job_id`
- `room_id`
- `status`
- `processing_stage`
- `progress`
- `message`
- `error`

### Room response

Important fields:

- `room_id`
- `room_name`
- `status`
- `source_type`
- `panorama_url`
- `preview_url`
- `viewer_type`
- `processing_stage`
- `processing_summary`
- `viewer_config`
- `metrics`
- `quality_assessment`
- `error_message`

Notes:

- `scene_url` is currently set to the same value as `panorama_url`
- `thumbnail` is currently set to the same value as `preview_url`
- `pointcloud_url` and `dense_view_url` are currently `null` in the active flows
- `metrics` is effectively a copy of `processing_summary`

## Processing stages

### Panorama upload stages

- `validating_panorama`
- `optimizing_panorama`
- `generating_outputs`
- `complete`
- `failed`

### Video processing stages

- `extracting_frames`
- `selecting_frames`
- `stitching_panorama`
- `generating_outputs`
- `complete`
- `failed`

## Viewer types returned by the API

### `panorama_360`

- Full immersive 360 output
- `projection_type: equirectangular`
- `wrap_enabled: true`
- Suitable for a full 360 viewer

### `panorama_partial`

- Wide panorama that is not safe to treat as a full wraparound sphere
- `projection_type: cylindrical`
- `wrap_enabled: false`
- Includes yaw/pitch bounds and padding metadata to keep the viewer inside captured content

### `panorama_flat`

- Fallback when the image is not strong enough for immersive wrapping
- `wrap_enabled: false`
- Best rendered as a flat panorama preview

## How the video pipeline works

The active video-processing path is:

1. Save the uploaded MP4 to `uploads/<room_id>/original_video.mp4`
2. Extract frames with FFmpeg at `3 FPS`
3. Score each frame for blur, contrast, exposure, and motion consistency
4. Remove weak and redundant frames
5. Resize selected frames to a long side of `1600px`
6. Estimate sweep direction and horizontal pair shifts
7. Compose a cylindrical panorama from center strips
8. Fall back to OpenCV Stitcher if strip composition fails badly
9. Normalize the panorama to a 2:1 canvas
10. Apply mild clarity enhancement and seam blending
11. Classify the final output as `panorama_360` or `panorama_flat`
12. Export:
    - `panorama_full.jpg`
    - `panorama_web.jpg`
    - `preview.jpg`

Key operational thresholds from `config.py`:

- hard minimum selected frames before stitching: `4`
- preferred selected-frame window: `8` to `20`
- extracted frame rate: `3 FPS`

## How direct panorama uploads are handled

The direct panorama path:

1. Saves the upload as `uploads/<room_id>/original_panorama.<ext>`
2. Measures input width, height, aspect ratio, black-pixel ratio, and estimated horizontal FOV
3. Classifies the upload as:
   - `panorama_360`
   - `panorama_partial`
   - `panorama_flat`
4. Optimizes the image:
   - crops true 360 uploads toward a 2:1 canvas
   - embeds partial panoramas onto a 2:1 canvas with padded edges
5. Exports full/web/preview JPEGs
6. Returns viewer metadata that the frontend can use to clamp yaw, pitch, and zoom

Useful defaults from `config.py`:

- direct-upload 360 width target: at least `2000px`
- partial panorama minimum width: `1400px`
- partial panorama minimum estimated horizontal FOV: `140 degrees`

## Output files on disk

### Panorama upload

```text
uploads/<room_id>/
|-- original_panorama.<ext>
`-- panorama/
    |-- panorama_full.jpg
    |-- panorama_web.jpg
    `-- preview.jpg
```

### Video upload

```text
uploads/<room_id>/
|-- original_video.mp4
|-- frames/
|-- selected_frames/
`-- panorama/
    |-- panorama_full.jpg
    |-- panorama_web.jpg
    `-- preview.jpg
```

## Tuning behavior

Most quality thresholds live in `config.py`, including:

- frame blur threshold
- exposure thresholds
- similarity threshold
- frame-count caps
- seam blend ratios
- web/preview output sizes
- panorama classification thresholds

If you need to make the backend more or less strict, start there.

## Optional smoke test

There is a simple script at `test_api.py` that exercises:

- `GET /health`
- `POST /upload-room-video`
- `POST /start-reconstruction/{room_id}`
- `GET /job-status/{job_id}`
- `GET /room/{room_id}`

To run it:

```bash
pip install requests
python test_api.py
```

Note that it expects the API to already be running at `http://127.0.0.1:8000`.

## Legacy and experimental code in the repo

`jobs.py` and `_build_gsplat_manual.py` still contain helpers related to older COLMAP / Nerfstudio / gsplat experimentation. They are not part of the active public API path documented above. The current backend behavior exposed through FastAPI is panorama generation and panorama delivery.

## Troubleshooting

### `OpenCV is required for panorama generation`

Install the Python dependencies from `requirements.txt` inside the environment you are using to run Uvicorn.

### `FFmpeg executable not found`

Install FFmpeg and make sure `ffmpeg` is available on your shell `PATH`.

### `Room not found` or `Job not found`

The backend stores data in memory. If the process restarts, room/job records are lost even though uploaded files may still remain on disk.

### `Room is already processing`

The room already has an active in-memory job. Wait for completion or restart the service to clear state.

### Panorama was classified as flat instead of 360

This usually means the upload or stitched result did not meet the code's thresholds for:

- 2:1 aspect ratio quality
- fill ratio
- seam quality
- motion consistency
- low black-border ratio

Check the `processing_summary` and `metrics` fields from `GET /room/{room_id}` for diagnostics.
