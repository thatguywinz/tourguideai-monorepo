"""
jobs.py — Simulated reconstruction pipeline for TourGuide AI MVP.

Runs a fake background task that progresses a job through status stages.
Will be replaced with real FFmpeg / COLMAP / Nerfstudio calls in production.
"""

import asyncio
import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

from models import jobs, rooms, save_room
from storage import upload_panorama_output
from panorama import (
    analyze_panorama_input,
    build_partial_panorama_viewer_config,
    check_panorama_dependencies,
    classify_panorama_input,
    load_panorama_image,
    maybe_fix_horizontal_seam,
    optimize_panorama_image,
    run_ffmpeg_extract as run_panorama_ffmpeg_extract,
    save_panorama_outputs,
    select_panorama_frames,
    stitch_panorama,
)
from config import (
    FFMPEG_FPS,
    BLUR_THRESHOLD,
    SIMILARITY_MAD_THRESHOLD,
    PANORAMA_MIN_STITCH_FRAMES,
    TARGET_FRAME_MIN,
    TARGET_FRAME_MAX,
    RECONSTRUCTION_LONG_SIDE,
    SPLATFACTO_ITERATIONS,
    SPLATFACTO_MAX_ITERATIONS,
    QUALITY_EXCELLENT_RATIO,
    QUALITY_EXCELLENT_POINTS,
    QUALITY_USABLE_RATIO,
    QUALITY_USABLE_POINTS,
)

# ---------------------------------------------------------------------------
# Nerfstudio conda env config
# ---------------------------------------------------------------------------

NS_VENV_BIN = os.environ.get("NS_VENV_BIN", r"C:\nerfstudio_env\Scripts")


def _ns_cmd(args: list[str]) -> list[str]:
    """Wrap a nerfstudio CLI command to run inside the nerfstudio venv."""
    exe = str(Path(NS_VENV_BIN) / args[0])
    return [exe] + args[1:]


@lru_cache(maxsize=1)
def _msvc_dev_env() -> dict[str, str]:
    """Load the Visual Studio C++ toolchain environment for JIT CUDA builds."""
    vcvars = Path(
        r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    )
    if not vcvars.exists():
        return {}

    cmd = f'call "{vcvars}" >nul && set'
    result = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace', check=False, shell=True)
    if result.returncode != 0:
        return {}

    env: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key:
            env[key] = value
    return env


def _ns_env() -> dict:
    """Return a clean env dict for nerfstudio subprocesses.

    Strips venv vars from the FastAPI process so they don't interfere
    with the nerfstudio venv's Python.
    """
    env = os.environ.copy()
    env.update(_msvc_dev_env())
    for var in ("VIRTUAL_ENV", "PYTHONHOME", "PYTHONPATH"):
        env.pop(var, None)
    cache_root = Path.cwd() / ".cache"
    torch_home = cache_root / "torch"
    torch_extensions = cache_root / "torch_extensions"
    cuda_prefix = Path.cwd() / ".cuda-toolkit"
    cuda_root = cuda_prefix / "Library"
    cuda_bin = cuda_root / "bin"
    cuda_lib = cuda_root / "lib"
    cuda_lib_x64 = cuda_lib / "x64"
    cudart_lib = cuda_lib / "cudart.lib"
    path_parts = [NS_VENV_BIN, str(cuda_bin), str(cuda_root), str(cuda_prefix), str(cuda_prefix / "Scripts"), env.get("PATH", "")]
    cache_root.mkdir(parents=True, exist_ok=True)
    torch_home.mkdir(parents=True, exist_ok=True)
    torch_extensions.mkdir(parents=True, exist_ok=True)
    if cudart_lib.exists():
        cuda_lib_x64.mkdir(parents=True, exist_ok=True)
        cudart_x64 = cuda_lib_x64 / "cudart.lib"
        if not cudart_x64.exists():
            shutil.copy2(cudart_lib, cudart_x64)
    env["VIRTUAL_ENV"] = str(Path(NS_VENV_BIN).parent)
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["XDG_CACHE_HOME"] = str(cache_root)
    env["TORCH_HOME"] = str(torch_home)
    env["TORCH_EXTENSIONS_DIR"] = str(torch_extensions)
    env["CUDA_HOME"] = str(cuda_root)
    env["CUDA_PATH"] = str(cuda_root)
    env["MAX_JOBS"] = "4"
    env["LIB"] = os.pathsep.join(
        part for part in [str(cuda_lib_x64), str(cuda_lib), env.get("LIB", "")] if part
    )
    env["PATH"] = os.pathsep.join(part for part in path_parts if part)
    # Tell sitecustomize.py where the pre-built gsplat CUDA extension lives so it
    # can inject it as gsplat.csrc before _backend.py triggers a JIT recompile.
    gsplat_pyd = torch_extensions / "gsplat_cuda" / "gsplat_cuda.pyd"
    if gsplat_pyd.exists():
        env["GSPLAT_PREBUILT_PYD"] = str(gsplat_pyd)
    return env


def _absolute_path(path: Path) -> Path:
    """Resolve repo-relative paths before passing them to external tools."""
    return path if path.is_absolute() else Path.cwd() / path


def _normalize_score(value: float, low: float, high: float) -> float:
    """Normalize a scalar into [0, 1] with safe handling for flat ranges."""
    if high <= low:
        return 1.0
    return float(np.clip((value - low) / (high - low), 0.0, 1.0))


def _robust_spread(points: np.ndarray) -> float:
    """Return a robust scene spread using the 10th-90th percentile extent."""
    if len(points) < 2:
        return 0.0
    low = np.percentile(points, 10, axis=0)
    high = np.percentile(points, 90, axis=0)
    return float(np.linalg.norm(high - low))


def _vector_to_list(vector: np.ndarray) -> list[float]:
    """Round a numpy vector for API and log output."""
    return [round(float(value), 4) for value in vector]


def _choose_keyframe_target(total_frames: int, target_min: int, target_max: int) -> int:
    """Pick a final keyframe count while still culling weak extras when possible."""
    if total_frames <= target_min:
        return total_frames
    if total_frames <= target_max:
        removable = max(1, round(max(0, total_frames - target_min) * 0.30))
        return max(target_min, total_frames - removable)
    return target_max


def _selected_training_iterations() -> int:
    """Clamp configured training iterations to the supported quality range."""
    iterations = max(1, int(SPLATFACTO_ITERATIONS))
    if iterations > SPLATFACTO_MAX_ITERATIONS:
        print(
            f"Configured SPLATFACTO_ITERATIONS={iterations} exceeds "
            f"SPLATFACTO_MAX_ITERATIONS={SPLATFACTO_MAX_ITERATIONS}; clamping."
        )
    return min(iterations, SPLATFACTO_MAX_ITERATIONS)


def _colmap_sparse_model_dir(colmap_dir: Path) -> Path | None:
    """Return the COLMAP sparse model directory to use for downstream steps."""
    sparse_root = colmap_dir / "sparse"
    preferred = sparse_root / "0"
    if preferred.exists() and preferred.is_dir():
        return preferred

    candidates = [
        path for path in sorted(sparse_root.glob("*"))
        if path.is_dir() and (path / "images.bin").exists() and (path / "points3D.bin").exists()
    ]
    return candidates[0] if candidates else None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _blur_score(image_path: Path) -> float:
    """Return Laplacian variance of a grayscale image. Lower = blurrier."""
    img = Image.open(image_path).convert("L").resize((320, 240), Image.LANCZOS)
    arr = np.array(img, dtype=np.float32)
    lap = (
        arr[:-2, 1:-1] + arr[2:, 1:-1] + arr[1:-1, :-2] + arr[1:-1, 2:]
        - 4 * arr[1:-1, 1:-1]
    )
    return float(np.var(lap))


def filter_blurry_frames(frames_dir: Path, threshold: float = BLUR_THRESHOLD) -> int:
    """Delete blurry frames in-place. Returns number of frames removed."""
    frames = sorted(frames_dir.glob("*.png"))
    removed = 0
    for f in frames:
        try:
            score = _blur_score(f)
        except Exception as e:
            print(f"Blur check failed for {f.name}: {e}")
            continue
        if score < threshold:
            print(f"  Removing blurry frame {f.name} (score={score:.1f})")
            f.unlink()
            removed += 1
    print(f"Blur filter: removed {removed}/{len(frames)} frames (threshold={threshold})")
    return removed


def filter_similar_frames(frames_dir: Path, threshold: float = SIMILARITY_MAD_THRESHOLD) -> int:
    """Delete frames that are too visually similar to the previous accepted frame.

    Uses mean-absolute-difference on a 160×120 greyscale thumbnail.
    Returns number of frames removed.
    """
    frames = sorted(frames_dir.glob("*.png"))
    removed = 0
    prev_arr = None
    for f in frames:
        try:
            img = Image.open(f).convert("L").resize((160, 120), Image.LANCZOS)
            arr = np.array(img, dtype=np.float32)
        except Exception as e:
            print(f"  Similarity check failed for {f.name}: {e}")
            continue
        if prev_arr is not None:
            mad = float(np.mean(np.abs(arr - prev_arr)))
            if mad < threshold:
                print(f"  Removing similar frame {f.name} (MAD={mad:.2f})")
                f.unlink()
                removed += 1
                continue  # keep prev_arr unchanged — next frame compared to last accepted
        prev_arr = arr
    print(f"Similarity filter: removed {removed}/{len(frames)} frames (threshold MAD={threshold})")
    return removed


def select_keyframes(
    frames_dir: Path,
    target_min: int = TARGET_FRAME_MIN,
    target_max: int = TARGET_FRAME_MAX,
) -> int:
    """Keep only the strongest keyframes for reconstruction.

    Selection uses:
      - blur score
      - diversity against the previous kept frame
      - temporal spacing through the clip
      - penalties for abrupt motion spikes and likely shake frames
    """
    frames = sorted(frames_dir.glob("*.png"))
    n = len(frames)
    target = _choose_keyframe_target(n, target_min, target_max)
    if n <= 1 or target >= n:
        print(f"Keyframe selection: kept {n}/{n} frames (removed 0)")
        return 0

    fingerprints: list[np.ndarray | None] = []
    blur_scores: list[float] = []
    for f in frames:
        try:
            img = Image.open(f).convert("L")
            fingerprints.append(
                np.array(img.resize((96, 72), Image.LANCZOS), dtype=np.float32)
            )
            blur_scores.append(_blur_score(f))
        except Exception as e:
            print(f"  Keyframe scoring failed for {f.name}: {e}")
            fingerprints.append(None)
            blur_scores.append(0.0)

    prev_delta = [0.0] * n
    next_delta = [0.0] * n
    bridge_delta = [0.0] * n
    for idx in range(1, n):
        prev_fp = fingerprints[idx - 1]
        cur_fp = fingerprints[idx]
        if prev_fp is None or cur_fp is None:
            continue
        delta = float(np.mean(np.abs(cur_fp - prev_fp)))
        prev_delta[idx] = delta
        next_delta[idx - 1] = delta

    for idx in range(1, n - 1):
        prev_fp = fingerprints[idx - 1]
        next_fp = fingerprints[idx + 1]
        if prev_fp is None or next_fp is None:
            continue
        bridge_delta[idx] = float(np.mean(np.abs(next_fp - prev_fp)))

    motion_values = np.array(
        [0.5 * (prev_delta[idx] + next_delta[idx]) for idx in range(n)],
        dtype=np.float32,
    )
    blur_values = np.array([score for score in blur_scores if score > 0], dtype=np.float32)
    diversity_values = np.array([value for value in motion_values if value > 0], dtype=np.float32)
    shake_values = np.array(
        [max(0.0, motion_values[idx] - bridge_delta[idx]) for idx in range(n)],
        dtype=np.float32,
    )

    blur_low, blur_high = (
        np.percentile(blur_values, [20, 90]) if len(blur_values) else (0.0, 1.0)
    )
    diversity_low, diversity_mid, diversity_high = (
        np.percentile(diversity_values, [25, 50, 85])
        if len(diversity_values)
        else (SIMILARITY_MAD_THRESHOLD, SIMILARITY_MAD_THRESHOLD + 4.0, SIMILARITY_MAD_THRESHOLD + 8.0)
    )
    shake_low, shake_high = (
        np.percentile(shake_values, [60, 90]) if len(shake_values) else (0.0, 1.0)
    )

    bucket_size = n / target
    keep_indices: list[int] = []
    last_kept_fp: np.ndarray | None = None

    for bucket in range(target):
        start = int(bucket * bucket_size)
        end = min(int(np.ceil((bucket + 1) * bucket_size)), n)
        if start >= end:
            continue

        desired_center = (bucket + 0.5) * bucket_size - 0.5
        best_idx = start
        best_score = -1e9
        fallback_idx = start
        fallback_score = -1e9

        for idx in range(start, end):
            fp = fingerprints[idx]
            if fp is None:
                continue

            blur_norm = _normalize_score(blur_scores[idx], float(blur_low), float(blur_high))
            spacing_score = max(
                0.0,
                1.0 - abs(idx - desired_center) / max(bucket_size, 1.0),
            )

            if last_kept_fp is None:
                diversity = motion_values[idx]
            else:
                diversity = float(np.mean(np.abs(fp - last_kept_fp)))
            diversity_score = _normalize_score(
                diversity,
                float(SIMILARITY_MAD_THRESHOLD),
                float(max(diversity_high, SIMILARITY_MAD_THRESHOLD + 1.0)),
            )

            motion_score = 1.0 - min(
                1.0,
                abs(float(motion_values[idx]) - float(diversity_mid))
                / max(float(diversity_high - diversity_low), 1e-6),
            )
            abrupt_turn_penalty = _normalize_score(
                float(motion_values[idx]),
                float(diversity_high),
                float(max(diversity_high * 1.6, diversity_high + 1.0)),
            )
            shake_penalty = _normalize_score(
                float(max(0.0, motion_values[idx] - bridge_delta[idx])),
                float(shake_low),
                float(max(shake_high, shake_low + 1.0)),
            )

            score = (
                0.40 * blur_norm
                + 0.25 * diversity_score
                + 0.20 * spacing_score
                + 0.15 * motion_score
                - 0.18 * abrupt_turn_penalty
                - 0.22 * shake_penalty
            )

            if score > fallback_score:
                fallback_idx = idx
                fallback_score = score
            if abrupt_turn_penalty >= 0.98 and shake_penalty >= 0.98 and end - start > 1:
                continue
            if score > best_score:
                best_idx = idx
                best_score = score

        chosen_idx = best_idx if best_score > -1e8 else fallback_idx
        keep_indices.append(chosen_idx)
        last_kept_fp = fingerprints[chosen_idx]

    keep_set = set(keep_indices)
    removed = 0
    for i, f in enumerate(frames):
        if i not in keep_set:
            f.unlink()
            removed += 1

    print(
        f"Keyframe selection: kept {len(keep_set)}/{n} frames "
        f"(target={target}, removed {removed})"
    )
    return removed


def resize_frames_for_reconstruction(
    frames_dir: Path, long_side: int = RECONSTRUCTION_LONG_SIDE
) -> tuple[int, int]:
    """Resize all frames in-place so the long side ≤ long_side px.

    Returns (final_width, final_height) of the last processed frame.
    Skips frames already within the limit.
    """
    frames = sorted(frames_dir.glob("*.png"))
    final_w, final_h = 0, 0
    for f in frames:
        try:
            img = Image.open(f)
            w, h = img.size
            if max(w, h) <= long_side:
                final_w, final_h = w, h
                continue
            if w >= h:
                new_w = long_side
                new_h = max(1, int(h * long_side / w))
            else:
                new_h = long_side
                new_w = max(1, int(w * long_side / h))
            img.resize((new_w, new_h), Image.LANCZOS).save(f)
            final_w, final_h = new_w, new_h
        except Exception as e:
            print(f"  Resize failed for {f.name}: {e}")
    print(f"Frames resized to {final_w}×{final_h} (long side ≤{long_side}px)")
    return (final_w, final_h)


def _quat_to_rotation_matrix(qw: float, qx: float, qy: float, qz: float) -> np.ndarray:
    """Return a 3×3 world-to-camera rotation matrix from a unit quaternion."""
    return np.array([
        [1 - 2*(qy*qy + qz*qz),  2*(qx*qy - qz*qw),     2*(qx*qz + qy*qw)],
        [2*(qx*qy + qz*qw),      1 - 2*(qx*qx + qz*qz), 2*(qy*qz - qx*qw)],
        [2*(qx*qz - qy*qw),      2*(qy*qz + qx*qw),     1 - 2*(qx*qx + qy*qy)],
    ], dtype=np.float64)


def _analyze_colmap_geometry(colmap_dir: Path) -> dict:
    """Parse COLMAP text output into quality metrics and viewer metadata.

    Returns a dict with keys:
        camera_spread        – std of camera XZ positions (horizontal coverage proxy)
        point_compactness    – fraction of 3D points inside the dense central cluster
        scene_center         – median of all 3D points [x, y, z]
        usable_region_center – mean of the compact inlier cluster [x, y, z]
        initial_position     – recommended eye position [x, y, z]
        initial_target       – recommended look-at point [x, y, z]

    Safe defaults are returned on any parse failure so callers need no error handling.
    """
    images_txt = colmap_dir / "text" / "images.txt"
    points_txt = colmap_dir / "text" / "points3D.txt"

    _safe: dict = {
        "camera_position_spread": 0.0,
        "sparse_point_spread": 0.0,
        "dense_cluster_ratio": 0.0,
        "dense_central_cluster": False,
        "scene_center": [0.0, 0.0, 0.0],
        "usable_region_center": [0.0, 0.0, 0.0],
        "initial_position": [0.0, 1.6, 0.0],
        "initial_target": [0.0, 1.6, -1.0],
        "forward_direction": [0.0, 0.0, -1.0],
    }

    # ── 3-D points ────────────────────────────────────────────────────────────
    raw_points: list[list[float]] = []
    try:
        with open(points_txt, "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("#") or not line.strip():
                    continue
                parts = line.split()
                if len(parts) >= 4:
                    raw_points.append([float(parts[1]), float(parts[2]), float(parts[3])])
    except Exception as e:
        print(f"  [geometry] points3D.txt parse error: {e}")
        return _safe

    if len(raw_points) < 10:
        return _safe

    pts = np.array(raw_points, dtype=np.float64)
    scene_center = np.median(pts, axis=0)

    point_distances = np.linalg.norm(pts - scene_center, axis=1)
    q25, q75 = np.percentile(point_distances, [25, 75])
    inlier_limit = np.median(point_distances) + 1.5 * max(q75 - q25, 1e-6)
    inlier_mask = point_distances <= inlier_limit
    inlier_pts = pts[inlier_mask] if np.any(inlier_mask) else pts
    sparse_point_spread = _robust_spread(inlier_pts)

    usable_center = scene_center.copy()
    dense_cluster_ratio = 0.0
    dense_central_cluster = False
    if len(inlier_pts) >= 10:
        low = np.percentile(inlier_pts, 10, axis=0)
        voxel_size = max(_robust_spread(inlier_pts) / 18.0, 0.08)
        voxel_coords = np.floor((inlier_pts - low) / voxel_size).astype(np.int32)
        counts: dict[tuple[int, int, int], int] = {}
        for cell in map(tuple, voxel_coords):
            counts[cell] = counts.get(cell, 0) + 1
        if counts:
            densest_cell = np.array(max(counts, key=counts.get), dtype=np.int32)
            cluster_mask = np.all(np.abs(voxel_coords - densest_cell) <= 1, axis=1)
            cluster_pts = inlier_pts[cluster_mask]
            if len(cluster_pts):
                usable_center = np.median(cluster_pts, axis=0)
                dense_cluster_ratio = float(len(cluster_pts) / len(inlier_pts))
                dense_central_cluster = bool(
                    dense_cluster_ratio >= 0.10
                    and np.linalg.norm(usable_center - scene_center)
                    <= max(sparse_point_spread * 0.35, voxel_size * 2.0)
                )

    # ── Camera poses ──────────────────────────────────────────────────────────
    cameras: list[tuple[np.ndarray, np.ndarray]] = []  # (center_world, forward_world)
    try:
        with open(images_txt, "r", encoding="utf-8") as fh:
            take_next = True
            for line in fh:
                if line.startswith("#") or not line.strip():
                    continue
                if take_next:
                    parts = line.split()
                    if len(parts) >= 8:
                        qw, qx, qy, qz = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
                        tx, ty, tz = float(parts[5]), float(parts[6]), float(parts[7])
                        R = _quat_to_rotation_matrix(qw, qx, qy, qz)
                        t = np.array([tx, ty, tz], dtype=np.float64)
                        center  = -R.T @ t           # camera centre in world coords
                        forward = R[2, :]            # camera +Z (look dir) in world coords
                        cameras.append((center, forward))
                    take_next = False
                else:
                    take_next = True   # every other non-comment line is a keypoint list
    except Exception as e:
        print(f"  [geometry] images.txt parse error: {e}")

    if not cameras:
        return {
            **_safe,
            "scene_center": _vector_to_list(scene_center),
            "usable_region_center": _vector_to_list(usable_center),
            "sparse_point_spread": round(sparse_point_spread, 4),
            "dense_cluster_ratio": round(dense_cluster_ratio, 4),
            "dense_central_cluster": dense_central_cluster,
        }

    cam_centers = np.array([c[0] for c in cameras], dtype=np.float64)
    camera_position_spread = _robust_spread(cam_centers)
    distances_to_center = np.linalg.norm(cam_centers - usable_center, axis=1)
    positive_distances = distances_to_center[distances_to_center > 1e-6]
    preferred_distance = (
        float(np.percentile(positive_distances, 35))
        if len(positive_distances)
        else float(np.max(distances_to_center))
    )
    near_threshold = (
        float(np.percentile(distances_to_center, 45))
        if len(distances_to_center) > 1
        else float(distances_to_center[0])
    )
    candidates = [
        idx for idx, distance in enumerate(distances_to_center)
        if distance <= near_threshold
        or abs(distance - preferred_distance) <= max(preferred_distance * 0.25, 0.05)
    ] or [int(np.argmin(distances_to_center))]

    best_idx = candidates[0]
    best_score = -np.inf
    for idx in candidates:
        to_center = usable_center - cameras[idx][0]
        distance = float(np.linalg.norm(to_center))
        if distance <= 1e-6:
            continue
        forward = cameras[idx][1]
        forward_norm = float(np.linalg.norm(forward))
        if forward_norm > 1e-6:
            forward = forward / forward_norm
        direction = to_center / distance
        alignment = float(np.dot(forward, direction))
        distance_score = 1.0 - min(
            1.0,
            abs(distance - preferred_distance) / max(preferred_distance, 1e-6),
        )
        score = 0.65 * alignment + 0.35 * distance_score
        if score > best_score:
            best_score = score
            best_idx = idx

    initial_position = cameras[best_idx][0].copy()
    initial_target = usable_center.copy()
    forward_direction = initial_target - initial_position
    forward_norm = float(np.linalg.norm(forward_direction))
    if forward_norm <= 1e-6:
        forward_direction = np.array([0.0, 0.0, -1.0], dtype=np.float64)
        initial_target = initial_position + forward_direction
    else:
        forward_direction = forward_direction / forward_norm

    return {
        "camera_position_spread": round(camera_position_spread, 4),
        "sparse_point_spread": round(sparse_point_spread, 4),
        "dense_cluster_ratio": round(dense_cluster_ratio, 4),
        "dense_central_cluster": dense_central_cluster,
        "scene_center": _vector_to_list(scene_center),
        "usable_region_center": _vector_to_list(usable_center),
        "initial_position": _vector_to_list(initial_position),
        "initial_target": _vector_to_list(initial_target),
        "forward_direction": _vector_to_list(forward_direction),
    }


def run_ffmpeg_extract(video_path: str, frames_dir: Path):
    cmd = [
        "ffmpeg",
        "-i", str(video_path),
        "-vf", f"fps={FFMPEG_FPS}",
        "-y",
        str(frames_dir / "%04d.png"),
    ]

    print(f"Running command: {' '.join(cmd)}")

    return subprocess.run(
        cmd,
        capture_output=True,
        encoding='utf-8',
        errors='replace',
        check=False,
    )


def run_colmap_estimation(frames_dir: Path, colmap_dir: Path):
    database_path = colmap_dir / "database.db"
    sparse_dir = colmap_dir / "sparse"
    text_dir = colmap_dir / "text"
    
    sparse_dir.mkdir(parents=True, exist_ok=True)
    text_dir.mkdir(parents=True, exist_ok=True)

    commands = [
        [
            "colmap", "feature_extractor",
            "--database_path", str(database_path),
            "--image_path", str(frames_dir),
            "--ImageReader.single_camera", "1"
        ],
        [
            "colmap", "sequential_matcher",
            "--database_path", str(database_path),
            "--SequentialMatching.overlap", "30"
        ],
        [
            "colmap", "mapper",
            "--database_path", str(database_path),
            "--image_path", str(frames_dir),
            "--output_path", str(sparse_dir),
            "--Mapper.init_min_num_inliers", "50",
            "--Mapper.abs_pose_min_num_inliers", "30",
            "--Mapper.filter_max_reproj_error", "4",
            "--Mapper.tri_min_angle", "4.0"
        ]
    ]

    for cmd in commands:
        print(f"Running command: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace', check=False)
        print(f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
        if result.returncode != 0:
            return result

    sparse_model_dir = _colmap_sparse_model_dir(colmap_dir)
    if sparse_model_dir is not None:
        converter_cmd = [
            "colmap", "model_converter",
            "--input_path", str(sparse_model_dir),
            "--output_path", str(text_dir),
            "--output_type", "TXT"
        ]
        print(f"Running command: {' '.join(converter_cmd)}")
        result = subprocess.run(converter_cmd, capture_output=True, encoding='utf-8', errors='replace', check=False)
        print(f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
        if result.returncode != 0:
            return result

    return result


def run_colmap_export_ply(colmap_dir: Path):
    sparse_model_dir = _colmap_sparse_model_dir(colmap_dir)
    output_ply = colmap_dir / "sparse.ply"

    if sparse_model_dir is None:
        class MissingSparseModelResult:
            returncode = 1
            stderr = f"No COLMAP sparse model found under {colmap_dir / 'sparse'}"

        return MissingSparseModelResult()
    
    cmd = [
        "colmap", "model_converter",
        "--input_path", str(sparse_model_dir),
        "--output_path", str(output_ply),
        "--output_type", "PLY"
    ]
    print(f"Running command: {' '.join(cmd)}")
    return subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace', check=False)


def fallback_txt_to_ply(colmap_dir: Path) -> bool:
    points3D_txt = colmap_dir / "text" / "points3D.txt"
    output_ply = colmap_dir / "sparse.ply"
    
    if not points3D_txt.exists():
        return False
        
    points = []
    try:
        with open(points3D_txt, 'r', encoding='utf-8') as f:
            for line in f:
                if line.startswith('#'):
                    continue
                parts = line.strip().split()
                if len(parts) >= 7:
                    # POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[]
                    x, y, z = parts[1], parts[2], parts[3]
                    r, g, b = parts[4], parts[5], parts[6]
                    points.append((x, y, z, r, g, b))
        
        with open(output_ply, 'w', encoding='utf-8') as f:
            f.write("ply\n")
            f.write("format ascii 1.0\n")
            f.write(f"element vertex {len(points)}\n")
            f.write("property float x\n")
            f.write("property float y\n")
            f.write("property float z\n")
            f.write("property uchar red\n")
            f.write("property uchar green\n")
            f.write("property uchar blue\n")
            f.write("end_header\n")
            for x, y, z, r, g, b in points:
                f.write(f"{x} {y} {z} {r} {g} {b}\n")
        return True
    except Exception as e:
        print(f"Fallback TXT -> PLY failed: {e}")
        return False


def check_nerfstudio() -> tuple[bool, str]:
    """Check that all required Nerfstudio commands work inside the conda env."""
    print("Checking Nerfstudio environment...")
    ns_env = _ns_env()
    ns_venv = str(Path(NS_VENV_BIN).parent)
    for cmd in ["ns-process-data", "ns-train", "ns-export"]:
        result = subprocess.run(
            _ns_cmd([cmd, "--help"]),
            capture_output=True, encoding='utf-8', errors='replace', check=False, env=ns_env
        )
        if result.returncode != 0:
            return False, f"Nerfstudio command '{cmd}' not available in venv '{ns_venv}': {result.stderr[:300]}"
    import_result = subprocess.run(
        _ns_cmd(["python", "-c", "import nerfstudio; print('nerfstudio import ok')"]),
        capture_output=True, encoding='utf-8', errors='replace', check=False, env=ns_env
    )
    if import_result.returncode != 0:
        return False, f"nerfstudio import failed: {import_result.stderr[:300]}"
    cuda_result = subprocess.run(
        _ns_cmd(
            [
                "python",
                "-c",
                (
                    "import sys, torch; "
                    "print(f'cuda_available={torch.cuda.is_available()}'); "
                    "print(f'torch_cuda_version={torch.version.cuda}'); "
                    "sys.exit(0 if torch.cuda.is_available() else 1)"
                ),
            ]
        ),
        capture_output=True,
        encoding='utf-8',
        errors='replace',
        check=False,
        env=ns_env,
    )
    if cuda_result.returncode != 0:
        return (
            False,
            "PyTorch inside the Nerfstudio venv does not have CUDA available. "
            f"Install a CUDA-enabled torch build in '{ns_venv}' before running splatfacto. "
            f"Preflight output: {cuda_result.stdout.strip() or cuda_result.stderr[:300]}",
        )
    gsplat_result = subprocess.run(
        _ns_cmd(
            [
                "python",
                "-c",
                (
                    "from gsplat.cuda import _backend; "
                    "assert _backend._C is not None, "
                    "'gsplat._C is None - CUDA extension not loaded'; "
                    "print('gsplat backend ok, _C:', type(_backend._C).__name__)"
                ),
            ]
        ),
        capture_output=True,
        encoding='utf-8',
        errors='replace',
        check=False,
        env=ns_env,
        timeout=30,
    )
    if gsplat_result.returncode != 0:
        return (
            False,
            "gsplat CUDA backend import failed inside the Nerfstudio venv. "
            f"Preflight output: {gsplat_result.stdout.strip() or gsplat_result.stderr[:500]}",
        )
    return True, ""


def run_nerfstudio_pipeline(frames_dir: Path, colmap_dir: Path, nerfstudio_dir: Path):
    frames_dir = _absolute_path(frames_dir)
    colmap_dir = _absolute_path(colmap_dir)
    nerfstudio_dir = _absolute_path(nerfstudio_dir)

    data_dir = nerfstudio_dir / "data"
    outputs_dir = nerfstudio_dir / "outputs"
    export_dir = nerfstudio_dir / "export"
    
    data_dir.mkdir(parents=True, exist_ok=True)
    outputs_dir.mkdir(parents=True, exist_ok=True)
    export_dir.mkdir(parents=True, exist_ok=True)

    sparse_model_dir = _colmap_sparse_model_dir(colmap_dir)
    transforms_path = data_dir / "transforms.json"

    if sparse_model_dir is None or not (sparse_model_dir / "cameras.bin").exists():
        class MissingColmapResult:
            returncode = 1
            stderr = f"COLMAP sparse model is missing under {colmap_dir / 'sparse'}"

        return MissingColmapResult()

    # Step 1: ns-process-data
    cmd_process = _ns_cmd([
        "ns-process-data", "images",
        "--data", str(frames_dir),
        "--output-dir", str(data_dir),
        "--colmap-model-path", str(sparse_model_dir),
        "--skip-colmap"
    ])
    
    ns_env = _ns_env()
    print(f"Running command: {' '.join(cmd_process)}")
    result_proc = subprocess.run(cmd_process, capture_output=True, encoding='utf-8', errors='replace', check=False, env=ns_env)
    print(f"STDOUT:\n{result_proc.stdout}\nSTDERR:\n{result_proc.stderr}")
    if result_proc.returncode != 0:
        return result_proc
    if not transforms_path.exists():
        class MissingTransformsResult:
            returncode = 1
            stderr = (
                f"ns-process-data completed without creating {transforms_path}. "
                f"Verify the COLMAP model path {sparse_model_dir} is valid for Nerfstudio import."
            )

        return MissingTransformsResult()

    # Step 2: ns-train splatfacto
    training_iterations = _selected_training_iterations()
    cmd_train = _ns_cmd([
        "ns-train", "splatfacto",
        "--data", str(data_dir),
        "--output-dir", str(outputs_dir),
        "--vis", "tensorboard",
        "--max-num-iterations", str(training_iterations),
        "--pipeline.model.camera-optimizer.mode", "SO3xR3",
    ])

    print(f"Running command: {' '.join(cmd_train)}")
    result_train = subprocess.run(cmd_train, capture_output=True, encoding='utf-8', errors='replace', check=False, env=ns_env)
    print(f"STDOUT:\n{result_train.stdout}\nSTDERR:\n{result_train.stderr}")
    if result_train.returncode != 0:
        return result_train

    # Step 3: find config.yml and export
    config_paths = list(outputs_dir.rglob("config.yml"))
    if not config_paths:
        class FakeResult:
            returncode = 1
            stderr = "config.yml not found after training. Dense output missing."
        return FakeResult()
        
    config_path = config_paths[0]

    cmd_export = _ns_cmd([
        "ns-export", "gaussian-splat",
        "--load-config", str(config_path),
        "--output-dir", str(export_dir)
    ])
    
    print(f"Running command: {' '.join(cmd_export)}")
    result_export = subprocess.run(cmd_export, capture_output=True, encoding='utf-8', errors='replace', check=False, env=ns_env)
    print(f"STDOUT:\n{result_export.stdout}\nSTDERR:\n{result_export.stderr}")
    
    # Check if a splat ply was generated
    splat_generated = list(export_dir.glob("*.ply"))
    if not splat_generated:
        class FakeExportResult:
            returncode = 1
            stderr = "Splat ply artifact was not generated during ns-export."
        return FakeExportResult()
    
    return result_export


def validate_colmap_sparse(colmap_dir: Path, total_frames: int = 0) -> tuple[bool, str, dict]:
    """Validate COLMAP sparse output and return registration metrics.

    Returns (ok, error_message, metrics_dict).
    """
    empty_metrics: dict = {
        "total_images": total_frames,
        "registered_images": 0,
        "registration_ratio": 0.0,
        "num_3d_points": 0,
        "camera_position_spread": 0.0,
        "sparse_point_spread": 0.0,
        "dense_cluster_ratio": 0.0,
        "dense_central_cluster": False,
    }

    sparse_model_dir = _colmap_sparse_model_dir(colmap_dir)
    text_dir = colmap_dir / "text"

    for f in ["cameras.bin", "images.bin", "points3D.bin"]:
        if sparse_model_dir is None or not (sparse_model_dir / f).exists():
            return False, f"Missing {f} in COLMAP sparse model", empty_metrics

    for f in ["cameras.txt", "images.txt", "points3D.txt"]:
        if not (text_dir / f).exists():
            return False, f"Missing {f} in text", empty_metrics

    cameras_txt = text_dir / "cameras.txt"
    images_txt = text_dir / "images.txt"
    points_txt = text_dir / "points3D.txt"

    num_cameras = 0
    num_images = 0
    num_points = 0

    try:
        with open(cameras_txt, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.startswith('#') and line.strip():
                    num_cameras += 1

        with open(images_txt, 'r', encoding='utf-8') as f:
            is_image_line = True
            for line in f:
                if line.startswith('#'):
                    continue
                if not line.strip():
                    continue
                if is_image_line:
                    num_images += 1
                    is_image_line = False
                else:
                    is_image_line = True

        with open(points_txt, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.startswith('#') and line.strip():
                    num_points += 1
    except Exception as e:
        return False, f"Error parsing TXT files: {e}", empty_metrics

    total = total_frames if total_frames > 0 else num_images
    ratio = round(num_images / total, 3) if total > 0 else 0.0
    metrics = {
        "total_images": total,
        "registered_images": num_images,
        "registration_ratio": ratio,
        "num_3d_points": num_points,
        "camera_position_spread": 0.0,
        "sparse_point_spread": 0.0,
        "dense_cluster_ratio": 0.0,
        "dense_central_cluster": False,
    }

    print(f"COLMAP Validation: {num_cameras} cameras, {num_images}/{total} images registered ({ratio:.0%}), {num_points} 3D points")

    if num_points == 0:
        return False, "Sparse reconstruction produced zero 3D points", metrics

    return True, "", metrics


def _compute_quality_assessment(metrics: dict) -> str:
    """Return 'excellent', 'usable', or 'weak' from registration and geometry.

    Inputs (all optional with safe defaults):
        registration_ratio  – fraction of frames with poses
        num_3d_points       – sparse point count
        camera_spread       – std of camera XZ positions (0 = not computed)
        point_compactness   – inlier-point fraction (1 = not computed)
    """
    ratio = metrics.get("registration_ratio", 0.0)
    points = metrics.get("num_3d_points", 0)
    camera_spread = metrics.get(
        "camera_position_spread",
        metrics.get("camera_spread", 0.0),
    )
    point_spread = metrics.get("sparse_point_spread", 0.0)
    dense_cluster_ratio = metrics.get(
        "dense_cluster_ratio",
        metrics.get("point_compactness", 0.0),
    )
    dense_central_cluster = metrics.get("dense_central_cluster", False)
    coverage_ratio = (
        float(camera_spread) / max(float(point_spread), 1e-6)
        if float(point_spread) > 0.0
        else 0.0
    )

    if ratio < 0.55 or points < 750 or point_spread <= 0.0:
        return "weak"

    if (
        ratio >= QUALITY_EXCELLENT_RATIO
        and points >= QUALITY_EXCELLENT_POINTS
        and coverage_ratio >= 0.10
        and dense_central_cluster
        and dense_cluster_ratio >= 0.10
    ):
        return "excellent"
    if (
        ratio >= QUALITY_USABLE_RATIO
        and points >= QUALITY_USABLE_POINTS
        and coverage_ratio >= 0.05
    ):
        return "usable"
    return "weak"


def _fail_job(job_id: str, room_id: str, error_msg: str) -> None:
    """Helper to mark both the job and room as failed."""
    print(f"Job {job_id} failed: {error_msg}")
    if job_id in jobs:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["processing_stage"] = "failed"
        jobs[job_id]["message"] = error_msg
        jobs[job_id]["error"] = error_msg
    if room_id in rooms:
        rooms[room_id]["status"] = "failed"
        rooms[room_id]["processing_stage"] = "failed"
        rooms[room_id]["error_message"] = error_msg
        rooms[room_id]["error"] = error_msg
        summary = rooms[room_id].setdefault("processing_summary", {})
        summary["stitch_success"] = False


def _set_stage(job_id: str, room_id: str, stage: str, progress: int, message: str) -> None:
    """Update both job and room stage/progress in a consistent way."""
    if job_id in jobs:
        jobs[job_id]["status"] = stage
        jobs[job_id]["processing_stage"] = stage
        jobs[job_id]["progress"] = progress
        jobs[job_id]["message"] = message
    if room_id in rooms:
        rooms[room_id]["status"] = "processing"
        rooms[room_id]["processing_stage"] = stage


# ---------------------------------------------------------------------------
# Background Pipeline
# ---------------------------------------------------------------------------

async def run_panorama_processing(job_id: str, room_id: str) -> None:
    """Validate and optimize a directly uploaded panorama image."""
    room = rooms.get(room_id)
    if not room:
        return

    panorama_input_path = room.get("original_panorama_path") or room.get("file_path")
    if not panorama_input_path or not os.path.exists(panorama_input_path):
        _fail_job(job_id, room_id, "Panorama image not found on disk.")
        return

    room_dir = Path("uploads") / room_id
    panorama_dir = room_dir / "panorama"
    if panorama_dir.exists():
        shutil.rmtree(panorama_dir)
    panorama_dir.mkdir(parents=True, exist_ok=True)

    _set_stage(job_id, room_id, "validating_panorama", 25, "Validating uploaded panorama")
    try:
        panorama_image = await asyncio.to_thread(load_panorama_image, panorama_input_path)
        analysis = await asyncio.to_thread(analyze_panorama_input, panorama_image)
    except Exception as e:
        _fail_job(job_id, room_id, f"Panorama validation failed: {e}")
        return

    viewer_type, classification_reason = classify_panorama_input(analysis)

    processing_summary = room.setdefault("processing_summary", {})
    processing_summary.update(
        {
            "input_type": "panorama",
            "input_resolution": [analysis["input_width"], analysis["input_height"]],
            "input_aspect_ratio": analysis["input_aspect_ratio"],
            "input_black_ratio": analysis["input_black_ratio"],
            "estimated_horizontal_fov_deg": analysis["estimated_horizontal_fov_deg"],
            "is_large_enough": analysis["is_large_enough"],
            "is_360_compatible": analysis["is_360_compatible"],
            "is_partial_candidate": analysis["is_partial_candidate"],
            "classification_reason": classification_reason,
            "stitch_success": False,
        }
    )

    _set_stage(job_id, room_id, "optimizing_panorama", 65, "Optimizing panorama for viewer delivery")
    try:
        optimized_image, optimization_meta = await asyncio.to_thread(
            optimize_panorama_image,
            panorama_image,
            viewer_type,
        )
        seam_meta = {"seam_fix_applied": False, "seam_blend_width_px": 0}
        if viewer_type == "panorama_360":
            optimized_image, seam_meta = await asyncio.to_thread(maybe_fix_horizontal_seam, optimized_image)
        viewer_config = build_partial_panorama_viewer_config(
            viewer_type,
            optimized_image.width,
            optimized_image.height,
            horizontal_fov_deg=analysis["estimated_horizontal_fov_deg"],
            canvas_resolution=tuple(optimization_meta["canvas_resolution"]),
            content_resolution=tuple(optimization_meta["content_resolution"]),
            padding=(
                optimization_meta["canvas_padding_left_px"],
                optimization_meta["canvas_padding_right_px"],
                optimization_meta["canvas_padding_top_px"],
                optimization_meta["canvas_padding_bottom_px"],
            ),
        )
    except Exception as e:
        _fail_job(job_id, room_id, f"Panorama optimization failed: {e}")
        return

    _set_stage(job_id, room_id, "generating_outputs", 90, "Generating panorama outputs")
    try:
        output_meta = await asyncio.to_thread(save_panorama_outputs, optimized_image, panorama_dir)
    except Exception as e:
        _fail_job(job_id, room_id, f"Panorama output generation failed: {e}")
        return

    panorama_full_path = output_meta["panorama_path"]
    panorama_web_path = output_meta["panorama_web_path"]
    preview_path = output_meta["preview_path"]
    output_resolution = output_meta["output_resolution"]

    # Upload processed outputs to Supabase Storage for persistent CDN hosting
    try:
        panorama_url = await asyncio.to_thread(upload_panorama_output, panorama_web_path, room_id)
        preview_url = await asyncio.to_thread(upload_panorama_output, preview_path, room_id)
    except Exception as e:
        _fail_job(job_id, room_id, f"Failed to upload panorama to cloud storage: {e}")
        return

    human_summary = (
        "Uploaded panorama was validated and prepared for immersive 360 viewing."
        if viewer_type == "panorama_360"
        else (
            "Uploaded panorama was validated and prepared for bounded immersive viewing."
            if viewer_type == "panorama_partial"
            else "Uploaded panorama was validated and prepared as a flat panoramic view."
        )
    )

    rooms[room_id]["status"] = "complete"
    rooms[room_id]["processing_stage"] = "complete"
    rooms[room_id]["viewer_type"] = viewer_type
    rooms[room_id]["panorama_path"] = str(panorama_full_path)
    rooms[room_id]["panorama_url"] = panorama_url
    rooms[room_id]["preview_path"] = str(preview_path)
    rooms[room_id]["preview_url"] = preview_url
    rooms[room_id]["scene_url"] = panorama_url
    rooms[room_id]["thumbnail"] = preview_url
    rooms[room_id]["pointcloud_url"] = None
    rooms[room_id]["dense_view_url"] = None
    rooms[room_id]["viewer_config"] = viewer_config
    rooms[room_id]["quality_assessment"] = "excellent" if viewer_type == "panorama_360" else "usable"
    rooms[room_id]["error"] = None
    rooms[room_id]["error_message"] = None

    processing_summary.update(
        {
            "viewer_type": viewer_type,
            "wrap_enabled": viewer_config["wrap_enabled"],
            "projection_type": viewer_config["projection_type"],
            "hide_padding": viewer_config["hide_padding"],
            "strict_bounds": viewer_config["strict_bounds"],
            "allow_pitch_beyond_content": viewer_config["allow_pitch_beyond_content"],
            "allow_zoom_out_to_padding": viewer_config["allow_zoom_out_to_padding"],
            "horizontal_fov_deg": viewer_config["horizontal_fov_deg"],
            "vertical_fov_deg": viewer_config["vertical_fov_deg"],
            "recommended_hfov_deg": viewer_config["recommended_hfov_deg"],
            "min_hfov_deg": viewer_config["min_hfov_deg"],
            "max_hfov_deg": viewer_config["max_hfov_deg"],
            "content_yaw_min_deg": viewer_config["content_yaw_min_deg"],
            "content_yaw_max_deg": viewer_config["content_yaw_max_deg"],
            "yaw_min_deg": viewer_config["yaw_min_deg"],
            "yaw_max_deg": viewer_config["yaw_max_deg"],
            "content_pitch_min_deg": viewer_config["content_pitch_min_deg"],
            "content_pitch_max_deg": viewer_config["content_pitch_max_deg"],
            "pitch_min_deg": viewer_config["pitch_min_deg"],
            "pitch_max_deg": viewer_config["pitch_max_deg"],
            "initial_yaw_deg": viewer_config["initial_yaw_deg"],
            "initial_pitch_deg": viewer_config["initial_pitch_deg"],
            "content_left_norm": viewer_config["content_left_norm"],
            "content_right_norm": viewer_config["content_right_norm"],
            "content_top_norm": viewer_config["content_top_norm"],
            "content_bottom_norm": viewer_config["content_bottom_norm"],
            "human_summary": human_summary,
            "output_resolution": f"{output_resolution[0]}x{output_resolution[1]}",
            "optimized_resolution": optimization_meta["optimized_resolution"],
            "crop_to_360_applied": optimization_meta["crop_to_360_applied"],
            "partial_vertical_trim_applied": optimization_meta["partial_vertical_trim_applied"],
            "vertical_trim_px": optimization_meta["vertical_trim_px"],
            "partial_canvas_applied": optimization_meta["partial_canvas_applied"],
            "canvas_resolution": optimization_meta["canvas_resolution"],
            "content_resolution": optimization_meta["content_resolution"],
            "canvas_padding_left_px": optimization_meta["canvas_padding_left_px"],
            "canvas_padding_right_px": optimization_meta["canvas_padding_right_px"],
            "canvas_padding_top_px": optimization_meta["canvas_padding_top_px"],
            "canvas_padding_bottom_px": optimization_meta["canvas_padding_bottom_px"],
            "seam_fix_applied": seam_meta["seam_fix_applied"],
            "seam_blend_width_px": seam_meta["seam_blend_width_px"],
            "panorama_web_path": str(panorama_web_path),
            "preview_resolution": output_meta["preview_resolution"],
            "web_resolution": output_meta["web_resolution"],
            "stitch_success": True,
        }
    )
    rooms[room_id]["processing_summary"] = processing_summary
    rooms[room_id]["metrics"] = processing_summary.copy()

    # Persist completed room state to Supabase DB
    save_room(room_id)

    if job_id in jobs:
        jobs[job_id]["status"] = "complete"
        jobs[job_id]["processing_stage"] = "complete"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["message"] = (
            "Immersive 360 panorama ready"
            if viewer_type == "panorama_360"
            else (
                "Bounded immersive panorama ready"
                if viewer_type == "panorama_partial"
                else "Panoramic image ready"
            )
        )
        jobs[job_id]["error"] = None

    print(
        f"\n=== PANORAMA UPLOAD SUMMARY [{room_id}] ===\n"
        f"  Input resolution        : {analysis['input_width']}x{analysis['input_height']}\n"
        f"  Input aspect ratio      : {analysis['input_aspect_ratio']}\n"
        f"  Estimated horizontal FOV: {viewer_config['horizontal_fov_deg']} deg\n"
        f"  Estimated vertical FOV  : {viewer_config['vertical_fov_deg']} deg\n"
        f"  Viewer type             : {viewer_type}\n"
        f"  Projection type         : {viewer_config['projection_type']}\n"
        f"  Wrap enabled            : {viewer_config['wrap_enabled']}\n"
        f"  Yaw range               : {viewer_config['yaw_min_deg']} to {viewer_config['yaw_max_deg']}\n"
        f"  Pitch range             : {viewer_config['pitch_min_deg']} to {viewer_config['pitch_max_deg']}\n"
        f"  Recommended HFOV        : {viewer_config['recommended_hfov_deg']} deg\n"
        f"  Partial canvas applied  : {optimization_meta['partial_canvas_applied']}\n"
        f"  Canvas / Content        : {optimization_meta['canvas_resolution']} / {optimization_meta['content_resolution']}\n"
        f"  Canvas padding (LRTB)   : {optimization_meta['canvas_padding_left_px']}, {optimization_meta['canvas_padding_right_px']}, {optimization_meta['canvas_padding_top_px']}, {optimization_meta['canvas_padding_bottom_px']}\n"
        f"  Full output             : {panorama_full_path}\n"
        f"  Web output              : {panorama_web_path}\n"
        f"  Preview output          : {preview_path}\n"
        f"  Output resolution       : {output_resolution[0]}x{output_resolution[1]}\n"
        f"====================================="
    )


async def run_reconstruction(job_id: str, room_id: str) -> None:
    """
    Advance a room-processing job through the panorama-first pipeline.
    """
    room = rooms.get(room_id)
    if not room:
        return

    _set_stage(job_id, room_id, "extracting_frames", 20, "Extracting candidate frames")

    deps_ok, deps_error = check_panorama_dependencies()
    if not deps_ok:
        _fail_job(job_id, room_id, deps_error)
        return

    video_path = room.get("original_video_path") or room.get("file_path")
    if not video_path or not os.path.exists(video_path):
        _fail_job(job_id, room_id, "Video file not found on disk.")
        return

    room_dir = Path("uploads") / room_id
    frames_dir = room_dir / "frames"
    selected_frames_dir = room_dir / "selected_frames"
    panorama_dir = room_dir / "panorama"

    for stage_dir in (frames_dir, selected_frames_dir, panorama_dir):
        if stage_dir.exists():
            shutil.rmtree(stage_dir)
        stage_dir.mkdir(parents=True, exist_ok=True)

    try:
        result = await asyncio.to_thread(run_panorama_ffmpeg_extract, video_path, frames_dir)
    except FileNotFoundError as e:
        _fail_job(job_id, room_id, f"FFmpeg executable not found: {e!r}")
        return
    except Exception as e:
        _fail_job(job_id, room_id, f"Subprocess exception: {e!r}")
        return

    if result.returncode != 0:
        error_msg = f"FFmpeg failed with exit code {result.returncode}:\n{result.stderr}"
        print(error_msg)
        _fail_job(job_id, room_id, error_msg)
        return

    extracted_frames = list(frames_dir.glob("*.png"))
    if not extracted_frames:
        _fail_job(job_id, room_id, "FFmpeg succeeded but zero frames were produced.")
        return

    _set_stage(job_id, room_id, "selecting_frames", 45, "Selecting the best panorama frames")
    try:
        selection = await asyncio.to_thread(select_panorama_frames, frames_dir, selected_frames_dir)
    except Exception as e:
        _fail_job(job_id, room_id, f"Frame selection failed: {e!r}")
        return

    processing_summary = room.setdefault("processing_summary", {})
    processing_summary.update(
        {
            "extracted_frame_count": selection["candidate_frame_count"],
            "selected_frame_count": selection["selected_frame_count"],
            "usable_frame_count": selection["selected_frame_count"],
            "blur_removed_count": selection["blur_removed_count"],
            "contrast_removed_count": selection.get("contrast_removed_count", 0),
            "similarity_removed_count": selection["similarity_removed_count"],
            "exposure_removed_count": selection.get("exposure_removed_count", 0),
            "selection_quality_score_stats": selection.get("quality_score_stats"),
            "stitch_success": False,
            "selected_frame_resolution": (
                list(selection["selected_resolution"])
                if selection["selected_resolution"] is not None
                else None
            ),
        }
    )

    if selection["selected_frame_count"] < PANORAMA_MIN_STITCH_FRAMES:
        _fail_job(
            job_id,
            room_id,
            f"Too few usable frames for panorama stitching ({selection['selected_frame_count']} remain).",
        )
        return

    _set_stage(
        job_id,
        room_id,
        "stitching_panorama",
        75,
        "Analyzing rotational sweep and composing 360 panorama",
    )
    try:
        stitch_result = await asyncio.to_thread(
            stitch_panorama,
            selection["selected_frame_paths"],
            panorama_dir,
        )
    except Exception as e:
        _fail_job(job_id, room_id, f"Panorama stitching failed: {e}")
        return

    _set_stage(job_id, room_id, "generating_outputs", 90, "Generating panorama web outputs")

    panorama_full_path = stitch_result["panorama_path"]
    panorama_web_path = stitch_result["panorama_web_path"]
    preview_path = stitch_result["preview_path"]
    output_resolution = stitch_result["output_resolution"]
    viewer_type = stitch_result.get("viewer_type", "panorama_flat")
    used_frame_count = stitch_result.get("used_frame_count", selection["selected_frame_count"])

    # Upload processed outputs to Supabase Storage for persistent CDN hosting
    try:
        panorama_url = await asyncio.to_thread(upload_panorama_output, panorama_web_path, room_id)
        preview_url = await asyncio.to_thread(upload_panorama_output, preview_path, room_id)
    except Exception as e:
        _fail_job(job_id, room_id, f"Failed to upload panorama to cloud storage: {e}")
        return

    if viewer_type == "panorama_360":
        human_summary = (
            f"{used_frame_count} frames stitched successfully into an immersive 360 panorama."
        )
        job_message = "Immersive 360 panorama ready"
    else:
        human_summary = (
            f"{used_frame_count} frames stitched successfully into a panoramic preview. "
            f"360 wrapping was disabled because {stitch_result.get('classification_reason', 'the final panorama was not reliable enough')}."
        )
        job_message = "Panoramic preview ready"

    rooms[room_id]["status"] = "complete"
    rooms[room_id]["processing_stage"] = "complete"
    rooms[room_id]["viewer_type"] = viewer_type
    rooms[room_id]["panorama_path"] = str(panorama_full_path)
    rooms[room_id]["panorama_url"] = panorama_url
    rooms[room_id]["preview_path"] = str(preview_path)
    rooms[room_id]["preview_url"] = preview_url
    rooms[room_id]["scene_url"] = panorama_url
    rooms[room_id]["thumbnail"] = preview_url
    rooms[room_id]["pointcloud_url"] = None
    rooms[room_id]["dense_view_url"] = None
    rooms[room_id]["viewer_config"] = {"viewer_type": viewer_type}
    processing_summary.update(
        {
            "stitch_success": True,
            "viewer_type": viewer_type,
            "human_summary": human_summary,
            "quality_score_stats": stitch_result.get("quality_score_stats"),
            "output_resolution": f"{output_resolution[0]}x{output_resolution[1]}",
            "stitched_native_resolution": (
                list(stitch_result["stitched_native_resolution"])
                if stitch_result.get("stitched_native_resolution") is not None
                else None
            ),
            "stitch_attempt_number": stitch_result.get("attempt_number"),
            "used_frame_count": used_frame_count,
            "final_frame_count_used": stitch_result.get("final_frame_count_used", used_frame_count),
            "composition_method": stitch_result.get("composition_method"),
            "normalization_method": stitch_result.get("normalization_method"),
            "fallback_used": stitch_result.get("fallback_used", False),
            "average_horizontal_shift_px": stitch_result.get("average_horizontal_shift"),
            "dominant_sweep_direction": stitch_result.get("dominant_direction"),
            "pair_shifts_px": stitch_result.get("pair_shifts_px"),
            "effective_pair_shifts_px": stitch_result.get("effective_pair_shifts_px"),
            "cumulative_offsets_px": stitch_result.get("cumulative_offsets_px"),
            "cumulative_y_offsets_px": stitch_result.get("cumulative_y_offsets_px"),
            "cleaned_pair_shifts": stitch_result.get("cleaned_pair_shifts"),
            "cleaned_cumulative_offsets": stitch_result.get("cleaned_cumulative_offsets"),
            "total_sweep_px": stitch_result.get("total_sweep_px"),
            "median_shift_px": stitch_result.get("median_shift_px"),
            "monotonicity_score": stitch_result.get("monotonicity_score"),
            "bad_shift_ratio": stitch_result.get("bad_shift_ratio"),
            "cleaned_shift_median": stitch_result.get("cleaned_shift_median"),
            "cleaned_monotonicity_score": stitch_result.get("cleaned_monotonicity_score"),
            "cleaned_bad_shift_ratio": stitch_result.get("cleaned_bad_shift_ratio"),
            "dominant_direction": stitch_result.get("dominant_direction"),
            "accepted_pair_count": stitch_result.get("accepted_pair_count"),
            "rejected_pair_count": stitch_result.get("rejected_pair_count"),
            "strip_width_px": stitch_result.get("strip_width_px"),
            "canvas_size": stitch_result.get("canvas_size"),
            "filled_coverage_ratio": stitch_result.get("filled_coverage_ratio"),
            "normalized_canvas_size": stitch_result.get("normalized_canvas_size"),
            "pre_normalization_resolution": stitch_result.get("pre_normalization_resolution"),
            "post_normalization_resolution": stitch_result.get("post_normalization_resolution"),
            "vertical_trim_px": stitch_result.get("vertical_trim_px"),
            "fill_ratio": stitch_result.get("fill_ratio"),
            "black_ratio": stitch_result.get("black_ratio"),
            "aspect_ratio": stitch_result.get("aspect_ratio"),
            "seam_cut_x_px": stitch_result.get("seam_cut_x_px"),
            "seam_vertical_offset_px": stitch_result.get("seam_vertical_offset_px"),
            "seam_blend_width_px": stitch_result.get("seam_blend_width_px"),
            "seam_quality_score": stitch_result.get("seam_quality_score"),
            "pair_shift_confidences": stitch_result.get("pair_shift_confidences"),
            "pair_shift_methods": stitch_result.get("pair_shift_methods"),
            "pair_acceptance_flags": stitch_result.get("pair_acceptance_flags"),
            "clarity_enhancement_applied": stitch_result.get("clarity_enhancement_applied", False),
            "classification_reason": stitch_result.get("classification_reason"),
            "panorama_web_path": str(panorama_web_path),
        }
    )
    rooms[room_id]["processing_summary"] = processing_summary
    rooms[room_id]["metrics"] = processing_summary.copy()
    rooms[room_id]["quality_assessment"] = "excellent" if viewer_type == "panorama_360" else "usable"
    rooms[room_id]["error"] = None
    rooms[room_id]["error_message"] = None

    # Persist completed room state to Supabase DB
    save_room(room_id)

    if job_id in jobs:
        jobs[job_id]["status"] = "complete"
        jobs[job_id]["processing_stage"] = "complete"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["message"] = job_message
        jobs[job_id]["error"] = None

    print(
        f"\n=== PANORAMA PROCESSING SUMMARY [{room_id}] ===\n"
        f"  Candidate frames extracted : {selection['candidate_frame_count']}\n"
        f"  Removed (blur)             : {selection['blur_removed_count']}\n"
        f"  Removed (contrast)         : {selection.get('contrast_removed_count', 0)}\n"
        f"  Removed (exposure)         : {selection.get('exposure_removed_count', 0)}\n"
        f"  Removed (similarity)       : {selection['similarity_removed_count']}\n"
        f"  Final usable frames        : {selection['selected_frame_count']}\n"
        f"  Final frames used          : {stitch_result.get('final_frame_count_used', used_frame_count)}\n"
        f"  Quality score stats        : {stitch_result.get('quality_score_stats')}\n"
        f"  Dominant direction         : {stitch_result.get('dominant_direction')}\n"
        f"  Pair shifts                : {stitch_result.get('pair_shifts_px')}\n"
        f"  Cleaned pair shifts        : {stitch_result.get('cleaned_pair_shifts')}\n"
        f"  Cleaned offsets            : {stitch_result.get('cleaned_cumulative_offsets')}\n"
        f"  Total sweep                : {stitch_result.get('total_sweep_px', 0.0)} px\n"
        f"  Cleaned shift median       : {stitch_result.get('cleaned_shift_median', 0.0)} px\n"
        f"  Accepted / Rejected pairs  : {stitch_result.get('accepted_pair_count', 0)} / {stitch_result.get('rejected_pair_count', 0)}\n"
        f"  Cleaned monotonicity       : {stitch_result.get('cleaned_monotonicity_score', 0.0)}\n"
        f"  Cleaned bad-shift ratio    : {stitch_result.get('cleaned_bad_shift_ratio', 0.0)}\n"
        f"  Strip width                : {stitch_result.get('strip_width_px', 0)} px\n"
        f"  Pre-normalization          : {stitch_result.get('pre_normalization_resolution')}\n"
        f"  Normalized canvas          : {stitch_result.get('normalized_canvas_size')}\n"
        f"  Seam blend width           : {stitch_result.get('seam_blend_width_px', 0)} px\n"
        f"  Seam quality score         : {stitch_result.get('seam_quality_score', 0.0)}\n"
        f"  Fill ratio                 : {stitch_result.get('fill_ratio', 0.0)}\n"
        f"  Black ratio                : {stitch_result.get('black_ratio', 0.0)}\n"
        f"  Clarity enhancement        : {stitch_result.get('clarity_enhancement_applied', False)}\n"
        f"  Stitch success             : True\n"
        f"  Output panorama            : {panorama_full_path}\n"
        f"  Output resolution          : {output_resolution[0]}x{output_resolution[1]}\n"
        f"  Viewer type                : {viewer_type}\n"
        f"  Composition method         : {stitch_result.get('composition_method')}\n"
        f"  Normalization method       : {stitch_result.get('normalization_method')}\n"
        f"  Classification reason      : {stitch_result.get('classification_reason')}\n"
        f"  Summary                    : {human_summary}\n"
        f"============================================"
    )
