/**
 * TourGuide AI — FastAPI backend client (panorama-first)
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

/* ── Job polling ─────────────────────────────────── */

export interface JobStatus {
  job_id: string;
  status:
    | "uploaded"
    | "validating_panorama"
    | "optimizing_panorama"
    | "generating_outputs"
    | "finalizing"
    | "complete"
    | "failed"
    // legacy statuses
    | "extracting_frames"
    | "selecting_frames"
    | "stitching_panorama"
    | "generating_preview"
    | "estimating_cameras"
    | "training_scene"
    | "exporting";
  progress: number;
  error?: string;
}

/* ── Viewer config (optional per-room) ───────────── */

export interface ViewerConfig {
  mode?: "panorama" | "first_person" | "orbit";
  viewer_type?: "panorama_360" | "panorama_partial" | "panorama_flat";
  projection_type?: "equirectangular" | "cylindrical";
  wrap_enabled?: boolean;
  hide_padding?: boolean;
  strict_bounds?: boolean;
  allow_zoom_out_to_padding?: boolean;
  horizontal_fov_deg?: number;
  vertical_fov_deg?: number;
  recommended_hfov_deg?: number;
  min_hfov_deg?: number;
  max_hfov_deg?: number;
  // Safe/clamp bounds — where the camera CENTER may point (keeps padding/edges out of view)
  yaw_min_deg?: number;
  yaw_max_deg?: number;
  pitch_min_deg?: number;
  pitch_max_deg?: number;
  // Content bounds — the angular extent the actual captured pixels occupy (used to build geometry)
  content_yaw_min_deg?: number;
  content_yaw_max_deg?: number;
  content_pitch_min_deg?: number;
  content_pitch_max_deg?: number;
  // Where the content sits within the texture (0..1), with any baked-in padding outside this region
  content_left_norm?: number;
  content_right_norm?: number;
  content_top_norm?: number;
  content_bottom_norm?: number;
  initial_yaw_deg?: number;
  initial_pitch_deg?: number;
  initial_pitch?: number;  // degrees
  initial_fov?: number;    // degrees
  near_plane?: number;
  far_plane?: number;
  initial_position?: [number, number, number];
  initial_target?: [number, number, number];
  min_distance?: number;
  max_distance?: number;
  min_polar_angle?: number;
  max_polar_angle?: number;
}

/* ── Room data ───────────────────────────────────── */

export interface RoomData {
  room_id: string;
  room_name: string;
  file_name: string;
  status: string;
  // panorama-first fields
  panorama_url?: string;
  preview_url?: string;
  viewer_type?: "panorama" | "panorama_360" | "panorama_partial" | "panorama_flat" | "splat" | "pointcloud";
  viewer_config?: ViewerConfig;
  error?: string;
  // legacy fields (kept for backward compat)
  scene_url?: string;
  thumbnail_url?: string;
  pointcloud_url?: string;
  dense_view_url?: string;
}

/* ── API helpers ─────────────────────────────────── */

export function resolveAssetUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${clean}`;
}

/**
 * Upload a panorama image for a room.
 */
export async function uploadRoomPanorama(
  imageFile: File,
  roomName?: string,
  onProgress?: (pct: number) => void,
): Promise<{ room_id: string }> {
  const formData = new FormData();
  formData.append("file", imageFile);
  if (roomName) formData.append("name", roomName);

  const url = `${API_BASE_URL}/upload-room-panorama`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

    xhr.send(formData);
  });
}

/**
 * Legacy: Upload video file.
 */
export async function uploadRoomVideo(
  roomName: string,
  videoFile: File,
  onProgress?: (pct: number) => void,
): Promise<{ room_id: string }> {
  const formData = new FormData();
  formData.append("room_name", roomName);
  formData.append("video", videoFile);

  const url = `${API_BASE_URL}/upload-room-video`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

    xhr.send(formData);
  });
}

/**
 * Start panorama processing for a room.
 */
export async function startPanoramaProcessing(roomId: string): Promise<{ job_id: string; room_id: string }> {
  const url = `${API_BASE_URL}/start-panorama-processing/${roomId}`;
  const res = await fetch(url, { method: "POST" });
  const body = await res.json().catch(() => res.text());
  if (!res.ok) throw new Error(`Start processing failed (${res.status}): ${JSON.stringify(body)}`);
  return body as { job_id: string; room_id: string };
}

/**
 * Legacy: Start reconstruction job for a room.
 */
export async function startReconstruction(roomId: string): Promise<{ job_id: string }> {
  const url = `${API_BASE_URL}/start-reconstruction/${roomId}`;
  const res = await fetch(url, { method: "POST" });
  const body = await res.json().catch(() => res.text());
  if (!res.ok) throw new Error(`Start reconstruction failed (${res.status}): ${JSON.stringify(body)}`);
  return body as { job_id: string };
}

/**
 * Poll the status of a job.
 */
export async function pollJob(jobId: string): Promise<JobStatus> {
  const url = `${API_BASE_URL}/job-status/${jobId}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => res.text());
  if (!res.ok) throw new Error(`Poll failed (${res.status}): ${JSON.stringify(body)}`);
  return body as JobStatus;
}

/**
 * Get the final room data once processing is complete.
 */
export async function getRoom(roomId: string): Promise<RoomData> {
  const url = `${API_BASE_URL}/room/${roomId}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => res.text());
  if (!res.ok) throw new Error(`Failed to fetch room (${res.status}): ${JSON.stringify(body)}`);
  return body as RoomData;
}
