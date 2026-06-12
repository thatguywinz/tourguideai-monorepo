"""
panorama.py - Rotational 360 panorama helpers for TourGuide AI.

Primary pipeline:
  video -> extract frames -> blur/redundancy filtering -> cumulative sweep estimate
        -> cylindrical strip composition -> 2:1 normalization
        -> seam alignment + wrap blending -> full/web/preview outputs

OpenCV Stitcher is retained only as an optional fallback when strip composition
fails badly. Even fallback outputs are normalized onto a 2:1 immersive canvas.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps

from config import (
    BLUR_THRESHOLD,
    EXPOSURE_MEAN_MAX,
    EXPOSURE_MEAN_MIN,
    EXPOSURE_STD_MIN,
    FFMPEG_FPS,
    PANORAMA_UPLOAD_360_ASPECT_TOLERANCE,
    PANORAMA_UPLOAD_FULL_MAX_WIDTH,
    PANORAMA_UPLOAD_MIN_WIDTH,
    PANORAMA_PARTIAL_MIN_ASPECT_RATIO,
    PANORAMA_PARTIAL_ASSUMED_VFOV_DEG,
    PANORAMA_PARTIAL_DEFAULT_HFOV_DEG,
    PANORAMA_PARTIAL_EDGE_FILL_BAND_RATIO,
    PANORAMA_PARTIAL_EDGE_FILL_BLUR_RADIUS,
    PANORAMA_PARTIAL_MAX_HFOV_DEG,
    PANORAMA_PARTIAL_MIN_HORIZONTAL_FOV_DEG,
    PANORAMA_PARTIAL_MIN_WIDTH,
    PANORAMA_PARTIAL_SAFE_PITCH_MARGIN_DEG,
    PANORAMA_PARTIAL_SAFE_YAW_MARGIN_DEG,
    PANORAMA_360_FORCE_MIN_FILL_RATIO,
    PANORAMA_360_MAX_BLACK_RATIO,
    PANORAMA_360_MIN_WIDTH,
    PANORAMA_ALIGNMENT_BAND_BOTTOM_RATIO,
    PANORAMA_ALIGNMENT_BAND_TOP_RATIO,
    PANORAMA_CONFIDENCE_THRESHOLD,
    PANORAMA_EDGE_SAMPLE_WIDTH_RATIO,
    PANORAMA_FALLBACK_MAX_FRAMES,
    PANORAMA_FOREGROUND_DOWNWEIGHT_BOTTOM_RATIO,
    PANORAMA_FULL_QUALITY,
    PANORAMA_MAX_ALLOWED_BAD_SHIFT_RATIO,
    PANORAMA_MAX_BAD_SHIFT_RATIO_AFTER_CLEANUP,
    PANORAMA_MAX_EXPOSURE_CLIP_RATIO,
    PANORAMA_MAX_FRAME_COUNT_RELAXED,
    PANORAMA_MAX_FRAME_COUNT_STRICT,
    PANORAMA_MAX_SHIFT_DEVIATION_RATIO,
    PANORAMA_MIN_BLUR_SCORE,
    PANORAMA_MIN_CONTRAST_SCORE,
    PANORAMA_MAX_SELECTED_FRAMES,
    PANORAMA_MIN_PAIR_CONFIDENCE,
    PANORAMA_MIN_MONOTONICITY_SCORE,
    PANORAMA_MIN_MONOTONICITY_AFTER_CLEANUP,
    PANORAMA_MIN_SELECTED_FRAMES,
    PANORAMA_MIN_STITCH_FRAMES,
    PANORAMA_LOCAL_CONTRAST_AMOUNT,
    PANORAMA_PARTIAL_SWEEP_STRETCH_ENABLED,
    PANORAMA_PREVIEW_MAX_HEIGHT,
    PANORAMA_PREVIEW_MAX_WIDTH,
    PANORAMA_SEAM_BLEND_RATIO,
    PANORAMA_SHARPEN_AMOUNT,
    PANORAMA_STITCH_LONG_SIDE,
    PANORAMA_STRIP_BLEND_EDGE_RATIO,
    PANORAMA_STRIP_FALLBACK_FILL_RATIO,
    PANORAMA_STRIP_MIN_SHIFT_PX,
    PANORAMA_STRIP_MIN_WIDTH,
    PANORAMA_STRIP_WIDTH_RATIO_NARROW,
    PANORAMA_STRIP_WIDTH_RATIO,
    PANORAMA_TARGET_ASPECT_RATIO,
    PANORAMA_TARGET_HEIGHT,
    PANORAMA_VERTICAL_TRIM_RATIO,
    PANORAMA_WEB_MAX_WIDTH,
    PANORAMA_WEB_QUALITY,
    SIMILARITY_MAD_THRESHOLD,
)

try:
    import cv2  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - runtime dependency check
    cv2 = None


def check_panorama_dependencies() -> tuple[bool, str]:
    """Return whether panorama-processing dependencies are available."""
    if cv2 is None:
        return (
            False,
            "OpenCV is required for panorama generation. Install 'opencv-python-headless' in the backend venv.",
        )
    return True, ""


def auto_orient_panorama(image: Image.Image) -> Image.Image:
    """Apply EXIF orientation and return an RGB panorama image."""
    return ImageOps.exif_transpose(image).convert("RGB")


def load_panorama_image(image_path: str | Path) -> Image.Image:
    """Load a panorama image from disk with EXIF orientation applied."""
    with Image.open(image_path) as src:
        return auto_orient_panorama(src)


def analyze_panorama_input(image: Image.Image) -> dict:
    """Inspect an uploaded panorama image before optimization."""
    width, height = image.size
    aspect_ratio = float(width) / float(height) if height else 0.0
    black_ratio = _compute_black_ratio(image)
    is_large_enough = width >= PANORAMA_UPLOAD_MIN_WIDTH and height >= max(600, PANORAMA_UPLOAD_MIN_WIDTH // 4)
    estimated_horizontal_fov_deg = estimate_panorama_horizontal_fov(width, height)
    is_360_compatible = (
        is_large_enough
        and abs(aspect_ratio - PANORAMA_TARGET_ASPECT_RATIO) <= PANORAMA_UPLOAD_360_ASPECT_TOLERANCE
    )
    is_partial_candidate = (
        width >= PANORAMA_PARTIAL_MIN_WIDTH
        and aspect_ratio >= PANORAMA_PARTIAL_MIN_ASPECT_RATIO
        and estimated_horizontal_fov_deg >= PANORAMA_PARTIAL_MIN_HORIZONTAL_FOV_DEG
    )
    return {
        "input_width": width,
        "input_height": height,
        "input_aspect_ratio": round(aspect_ratio, 4),
        "input_black_ratio": round(black_ratio, 4),
        "estimated_horizontal_fov_deg": round(estimated_horizontal_fov_deg, 2),
        "is_large_enough": is_large_enough,
        "is_360_compatible": is_360_compatible,
        "is_partial_candidate": is_partial_candidate,
    }


def classify_panorama_input(analysis: dict) -> tuple[str, str]:
    """Classify a direct panorama upload for viewer rendering."""
    if analysis["is_360_compatible"]:
        return "panorama_360", "input aspect ratio and resolution are suitable for immersive 360 viewing"
    if analysis["is_partial_candidate"]:
        return "panorama_partial", "input panorama is wide enough for bounded immersive viewing but not full 360"
    if not analysis["is_large_enough"]:
        return "panorama_flat", "input panorama is readable but too small for reliable 360 viewing"
    return "panorama_flat", "input panorama is not wide enough for immersive viewing"


def estimate_panorama_horizontal_fov(width: int, height: int) -> float:
    """Estimate the horizontal sweep covered by a panorama from its aspect ratio.

    Handheld sweep panoramas cover roughly PANORAMA_PARTIAL_ASSUMED_VFOV_DEG
    vertically, so the horizontal sweep scales with the aspect ratio from there.
    """
    if width <= 0 or height <= 0:
        return 0.0
    return float(
        min(360.0, PANORAMA_PARTIAL_ASSUMED_VFOV_DEG * (float(width) / float(height)))
    )


def build_partial_panorama_viewer_config(
    viewer_type: str,
    width: int,
    height: int,
    *,
    horizontal_fov_deg: float | None = None,
    canvas_resolution: tuple[int, int] | None = None,
    content_resolution: tuple[int, int] | None = None,
    padding: tuple[int, int, int, int] | None = None,
) -> dict:
    """Build viewer metadata so the frontend can clamp yaw and hide uncaptured space."""
    if viewer_type == "panorama_360":
        return {
            "viewer_type": viewer_type,
            "projection_type": "equirectangular",
            "wrap_enabled": True,
            "hide_padding": False,
            "horizontal_fov_deg": 360.0,
            "vertical_fov_deg": 180.0,
            "recommended_hfov_deg": 75.0,
            "min_hfov_deg": 35.0,
            "max_hfov_deg": 110.0,
            "yaw_min_deg": -180.0,
            "yaw_max_deg": 180.0,
            "pitch_min_deg": -90.0,
            "pitch_max_deg": 90.0,
            "initial_yaw_deg": 0.0,
            "initial_pitch_deg": 0.0,
        }

    if horizontal_fov_deg is None:
        horizontal_fov_deg = estimate_panorama_horizontal_fov(width, height)
    horizontal_fov_deg = round(float(horizontal_fov_deg), 2)

    # Vertical coverage follows from the captured pixels' aspect ratio so the
    # texture maps onto the sphere without stretching. Prefer the true content
    # resolution (the canvas may include padding).
    if content_resolution and content_resolution[1] > 0:
        content_aspect = float(content_resolution[0]) / float(content_resolution[1])
    else:
        content_aspect = float(width) / float(height) if height else 1.0
    vertical_fov_deg = round(
        min(90.0, max(30.0, horizontal_fov_deg / max(content_aspect, 0.1))), 2
    )
    half_span = round(horizontal_fov_deg / 2.0, 2)
    half_pitch = round(vertical_fov_deg / 2.0, 2)
    recommended_hfov_deg = round(
        min(
            PANORAMA_PARTIAL_DEFAULT_HFOV_DEG,
            max(45.0, horizontal_fov_deg * 0.4),
            horizontal_fov_deg * 0.85,
        ),
        2,
    )
    max_hfov_deg = round(
        max(recommended_hfov_deg, min(PANORAMA_PARTIAL_MAX_HFOV_DEG, horizontal_fov_deg * 0.9)),
        2,
    )
    min_hfov_deg = 30.0

    # Keep these margins small: the viewer clamps the camera center by half the
    # camera FOV against these bounds, so large margins double-clamp and can
    # freeze the camera entirely.
    safe_yaw_min = round(min(0.0, -half_span + PANORAMA_PARTIAL_SAFE_YAW_MARGIN_DEG), 2)
    safe_yaw_max = round(max(0.0, half_span - PANORAMA_PARTIAL_SAFE_YAW_MARGIN_DEG), 2)
    if safe_yaw_min > safe_yaw_max:
        safe_yaw_min = safe_yaw_max = 0.0

    safe_pitch_min = round(min(0.0, -half_pitch + PANORAMA_PARTIAL_SAFE_PITCH_MARGIN_DEG), 2)
    safe_pitch_max = round(max(0.0, half_pitch - PANORAMA_PARTIAL_SAFE_PITCH_MARGIN_DEG), 2)
    if safe_pitch_min > safe_pitch_max:
        safe_pitch_min = safe_pitch_max = 0.0

    content_left_norm = 0.0
    content_right_norm = 1.0
    content_top_norm = 0.0
    content_bottom_norm = 1.0
    if canvas_resolution and content_resolution and padding:
        canvas_w, canvas_h = canvas_resolution
        content_w, content_h = content_resolution
        pad_left, pad_right, pad_top, pad_bottom = padding
        if canvas_w > 0 and canvas_h > 0:
            content_left_norm = round(pad_left / canvas_w, 4)
            content_right_norm = round((pad_left + content_w) / canvas_w, 4)
            content_top_norm = round(pad_top / canvas_h, 4)
            content_bottom_norm = round((pad_top + content_h) / canvas_h, 4)
    return {
        "viewer_type": viewer_type,
        "projection_type": "cylindrical" if viewer_type == "panorama_partial" else "flat",
        "wrap_enabled": False,
        "hide_padding": viewer_type == "panorama_partial",
        "strict_bounds": viewer_type == "panorama_partial",
        "allow_pitch_beyond_content": False,
        "allow_zoom_out_to_padding": False,
        "horizontal_fov_deg": horizontal_fov_deg,
        "vertical_fov_deg": vertical_fov_deg,
        "recommended_hfov_deg": recommended_hfov_deg,
        "min_hfov_deg": min_hfov_deg,
        "max_hfov_deg": max_hfov_deg,
        "content_yaw_min_deg": -half_span,
        "content_yaw_max_deg": half_span,
        "yaw_min_deg": safe_yaw_min,
        "yaw_max_deg": safe_yaw_max,
        "content_pitch_min_deg": -half_pitch,
        "content_pitch_max_deg": half_pitch,
        "pitch_min_deg": safe_pitch_min,
        "pitch_max_deg": safe_pitch_max,
        "initial_yaw_deg": 0.0,
        "initial_pitch_deg": 0.0,
        "content_left_norm": content_left_norm,
        "content_right_norm": content_right_norm,
        "content_top_norm": content_top_norm,
        "content_bottom_norm": content_bottom_norm,
    }


def _center_crop_to_aspect(
    image: Image.Image,
    aspect_ratio: float,
    *,
    vertical_focus: float = 0.5,
) -> Image.Image:
    """Crop an image to the requested aspect ratio without stretching."""
    width, height = image.size
    if width <= 0 or height <= 0:
        return image

    current_aspect = float(width) / float(height)
    if abs(current_aspect - aspect_ratio) < 1e-4:
        return image

    if current_aspect > aspect_ratio:
        target_width = max(1, int(round(height * aspect_ratio)))
        left = max(0, (width - target_width) // 2)
        return image.crop((left, 0, left + target_width, height))

    target_height = max(1, int(round(width / aspect_ratio)))
    focus_y = float(np.clip(vertical_focus, 0.0, 1.0)) * height
    top = int(round(focus_y - target_height / 2.0))
    top = max(0, min(top, height - target_height))
    return image.crop((0, top, width, top + target_height))


def embed_partial_panorama_on_360_canvas(image: Image.Image) -> tuple[Image.Image, dict]:
    """Place a partial panorama on a black 2:1 canvas without stretching source pixels."""
    width, height = image.size
    if width <= 0 or height <= 0:
        return image, {
            "partial_canvas_applied": False,
            "canvas_resolution": list(image.size),
            "content_resolution": list(image.size),
            "canvas_padding_left_px": 0,
            "canvas_padding_right_px": 0,
            "canvas_padding_top_px": 0,
            "canvas_padding_bottom_px": 0,
        }

    canvas_height = max(height, int(np.ceil(width / PANORAMA_TARGET_ASPECT_RATIO)))
    canvas_width = int(round(canvas_height * PANORAMA_TARGET_ASPECT_RATIO))
    if canvas_width < width:
        canvas_width = width
        if canvas_width % 2 != 0:
            canvas_width += 1
        canvas_height = max(height, canvas_width // 2)
        canvas_width = canvas_height * 2

    offset_x = max(0, (canvas_width - width) // 2)
    offset_y = max(0, (canvas_height - height) // 2)

    if canvas_width == width and canvas_height == height:
        return image, {
            "partial_canvas_applied": False,
            "canvas_resolution": [canvas_width, canvas_height],
            "content_resolution": [width, height],
            "canvas_padding_left_px": 0,
            "canvas_padding_right_px": 0,
            "canvas_padding_top_px": 0,
            "canvas_padding_bottom_px": 0,
        }

    canvas = Image.new("RGB", (canvas_width, canvas_height), color=(0, 0, 0))
    edge_band_width = max(8, int(round(width * PANORAMA_PARTIAL_EDGE_FILL_BAND_RATIO)))
    edge_band_width = min(edge_band_width, max(8, width // 4))
    if offset_x > 0 and edge_band_width > 0:
        left_band = image.crop((0, 0, edge_band_width, height))
        left_fill = left_band.resize((offset_x, height), Image.LANCZOS).filter(
            ImageFilter.GaussianBlur(radius=PANORAMA_PARTIAL_EDGE_FILL_BLUR_RADIUS)
        )
        canvas.paste(left_fill, (0, offset_y))

        right_band = image.crop((width - edge_band_width, 0, width, height))
        right_fill = right_band.resize((offset_x, height), Image.LANCZOS).filter(
            ImageFilter.GaussianBlur(radius=PANORAMA_PARTIAL_EDGE_FILL_BLUR_RADIUS)
        )
        canvas.paste(right_fill, (offset_x + width, offset_y))

    canvas.paste(image, (offset_x, offset_y))
    return canvas, {
        "partial_canvas_applied": True,
        "canvas_resolution": [canvas_width, canvas_height],
        "content_resolution": [width, height],
        "canvas_padding_left_px": offset_x,
        "canvas_padding_right_px": canvas_width - width - offset_x,
        "canvas_padding_top_px": offset_y,
        "canvas_padding_bottom_px": canvas_height - height - offset_y,
    }


def optimize_panorama_image(image: Image.Image, viewer_type: str) -> tuple[Image.Image, dict]:
    """Resize and minimally normalize an uploaded panorama while preserving detail."""
    optimized = image.copy()
    optimized = _resize_long_side(optimized, PANORAMA_UPLOAD_FULL_MAX_WIDTH)

    before_crop_size = optimized.size
    partial_canvas_meta = {
        "partial_canvas_applied": False,
        "canvas_resolution": list(optimized.size),
        "content_resolution": list(optimized.size),
        "canvas_padding_left_px": 0,
        "canvas_padding_right_px": 0,
        "canvas_padding_top_px": 0,
        "canvas_padding_bottom_px": 0,
    }
    if viewer_type == "panorama_360":
        optimized = _center_crop_to_aspect(optimized, PANORAMA_TARGET_ASPECT_RATIO)
    elif viewer_type == "panorama_partial":
        optimized, partial_canvas_meta = embed_partial_panorama_on_360_canvas(optimized)

    return optimized, {
        "optimized_resolution": list(optimized.size),
        "crop_to_360_applied": viewer_type == "panorama_360" and optimized.size != before_crop_size,
        "partial_vertical_trim_applied": False,
        "vertical_trim_px": 0,
        **partial_canvas_meta,
    }


def maybe_fix_horizontal_seam(image: Image.Image, blend_ratio: float = PANORAMA_SEAM_BLEND_RATIO) -> tuple[Image.Image, dict]:
    """Lightly blend the left/right edges of a 360 panorama to reduce seam visibility."""
    width, height = image.size
    blend_width = max(8, int(round(width * blend_ratio)))
    if width <= blend_width * 2 or height <= 0:
        return image, {"seam_fix_applied": False, "seam_blend_width_px": 0}

    canvas = np.array(image.convert("RGB"), dtype=np.float32)
    left = canvas[:, :blend_width, :]
    right = canvas[:, -blend_width:, :]
    seam_target = (left + right) * 0.5

    alpha = np.linspace(0.0, 1.0, blend_width, dtype=np.float32)[None, :, None]
    canvas[:, :blend_width, :] = left * (1.0 - alpha) + seam_target * alpha
    canvas[:, -blend_width:, :] = seam_target * (1.0 - alpha) + right * alpha

    return (
        Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), mode="RGB"),
        {
            "seam_fix_applied": True,
            "seam_blend_width_px": blend_width,
        },
    )


def save_panorama_outputs(image: Image.Image, output_dir: str | Path) -> dict:
    """Save full, web, and preview derivatives for a processed panorama upload."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    panorama_full_path = output_dir / "panorama_full.jpg"
    panorama_web_path = output_dir / "panorama_web.jpg"
    preview_path = output_dir / "preview.jpg"

    image.save(panorama_full_path, format="JPEG", quality=PANORAMA_FULL_QUALITY, optimize=True)

    web_image = image.copy()
    if web_image.width > PANORAMA_WEB_MAX_WIDTH:
        web_height = max(1, int(round(web_image.height * (PANORAMA_WEB_MAX_WIDTH / web_image.width))))
        web_image = web_image.resize((PANORAMA_WEB_MAX_WIDTH, web_height), Image.LANCZOS)
    web_image.save(panorama_web_path, format="JPEG", quality=PANORAMA_WEB_QUALITY, optimize=True)

    preview_image = image.copy()
    preview_image.thumbnail((PANORAMA_PREVIEW_MAX_WIDTH, PANORAMA_PREVIEW_MAX_HEIGHT), Image.LANCZOS)
    preview_image.save(preview_path, format="JPEG", quality=PANORAMA_WEB_QUALITY, optimize=True)

    return {
        "panorama_path": panorama_full_path,
        "panorama_web_path": panorama_web_path,
        "preview_path": preview_path,
        "output_resolution": list(image.size),
        "web_resolution": list(web_image.size),
        "preview_resolution": list(preview_image.size),
    }


def process_uploaded_panorama(image_path: str | Path, output_dir: str | Path) -> dict:
    """Validate, optimize, and export a directly uploaded panorama image."""
    image = load_panorama_image(image_path)
    analysis = analyze_panorama_input(image)
    viewer_type, classification_reason = classify_panorama_input(analysis)
    optimized, optimization_meta = optimize_panorama_image(image, viewer_type)

    seam_meta = {"seam_fix_applied": False, "seam_blend_width_px": 0}
    final_image = optimized
    if viewer_type == "panorama_360":
        final_image, seam_meta = maybe_fix_horizontal_seam(optimized)

    outputs = save_panorama_outputs(final_image, output_dir)
    viewer_config = build_partial_panorama_viewer_config(
        viewer_type,
        final_image.width,
        final_image.height,
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
    return {
        **analysis,
        **optimization_meta,
        **seam_meta,
        **outputs,
        "viewer_type": viewer_type,
        "viewer_config": viewer_config,
        "classification_reason": classification_reason,
        "stitch_success": True,
    }


def _ensure_clean_dir(path: Path) -> None:
    """Create an empty directory, removing prior contents if needed."""
    if path.exists():
        import shutil

        for child in path.iterdir():
            if child.is_file():
                child.unlink()
            else:
                shutil.rmtree(child)
    path.mkdir(parents=True, exist_ok=True)


def _resize_long_side(image: Image.Image, long_side: int) -> Image.Image:
    """Resize so the long side equals long_side; return as-is if already smaller."""
    width, height = image.size
    current_long = max(width, height)
    if current_long <= long_side:
        return image
    scale = long_side / current_long
    new_size = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
    return image.resize(new_size, Image.LANCZOS)


def _evenly_spaced_indices(total: int, target: int) -> list[int]:
    """Return target evenly spaced indices into a sequence of length total."""
    if total <= 0:
        return []
    if target >= total:
        return list(range(total))
    raw = np.linspace(0, total - 1, num=target)
    indices = sorted({int(round(value)) for value in raw})
    for idx in range(total):
        if len(indices) >= target:
            break
        if idx not in indices:
            indices.append(idx)
    return sorted(indices[:target])


def _laplacian_variance(gray_array: np.ndarray) -> float:
    """Return Laplacian variance; higher values mean sharper images."""
    if cv2 is not None:
        lap = cv2.Laplacian(gray_array, cv2.CV_32F)
    else:  # pragma: no cover - dependency is checked earlier
        lap = (
            gray_array[:-2, 1:-1]
            + gray_array[2:, 1:-1]
            + gray_array[1:-1, :-2]
            + gray_array[1:-1, 2:]
            - 4 * gray_array[1:-1, 1:-1]
        )
    return float(np.var(lap))


def _mad(fp_a: np.ndarray, fp_b: np.ndarray) -> float:
    """Return mean absolute difference between two grayscale fingerprints."""
    return float(np.mean(np.abs(fp_a - fp_b)))


def _compute_black_ratio(image: Image.Image | np.ndarray) -> float:
    """Return fraction of near-black pixels."""
    if isinstance(image, Image.Image):
        gray = np.array(image.convert("L"), dtype=np.uint8)
    else:
        if cv2 is None:  # pragma: no cover - dependency is checked earlier
            gray = np.mean(image, axis=2).astype(np.uint8)
        else:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if gray.size == 0:
        return 1.0
    return float(np.sum(gray <= 5)) / float(gray.size)


def _compute_fill_ratio(image_bgr: np.ndarray) -> float:
    """Approximate content coverage from non-black image content."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        return 0.0
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    if gray.size == 0:
        return 0.0
    return float(np.count_nonzero(gray > 5)) / float(gray.size)


def run_ffmpeg_extract(video_path: str, frames_dir: Path, fps: int = FFMPEG_FPS):
    """Extract candidate frames from the uploaded room video."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video_path),
        "-vf",
        f"fps={fps}",
        "-vsync",
        "vfr",
        "-y",
        str(frames_dir / "frame_%05d.png"),
    ]
    print(f"Running command: {' '.join(cmd)}")
    return subprocess.run(
        cmd,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def score_blur(image: Image.Image | np.ndarray) -> float:
    """Return blur score for a PIL image or OpenCV array."""
    if isinstance(image, Image.Image):
        gray = np.array(image.convert("L").resize((320, 240), Image.LANCZOS), dtype=np.float32)
    else:
        if cv2 is None:  # pragma: no cover - dependency is checked earlier
            raise RuntimeError("OpenCV is required for blur scoring.")
        gray = image
        if gray.ndim == 3:
            gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (320, 240), interpolation=cv2.INTER_AREA).astype(np.float32)
    return _laplacian_variance(gray)


def score_contrast(image: Image.Image | np.ndarray) -> float:
    """Return a local-contrast score that rewards spatial detail."""
    if isinstance(image, Image.Image):
        gray = np.array(image.convert("L").resize((320, 240), Image.LANCZOS), dtype=np.uint8)
    else:
        if cv2 is None:  # pragma: no cover - dependency is checked earlier
            raise RuntimeError("OpenCV is required for contrast scoring.")
        gray = image
        if gray.ndim == 3:
            gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (320, 240), interpolation=cv2.INTER_AREA).astype(np.uint8)
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        return float(np.std(gray))
    blurred = cv2.GaussianBlur(gray, (0, 0), sigmaX=3.0)
    highpass = cv2.absdiff(gray, blurred)
    return float(0.65 * np.std(gray) + 1.6 * np.std(highpass))


def score_exposure(image: Image.Image | np.ndarray) -> dict:
    """Return exposure sanity metrics and a normalized score."""
    if isinstance(image, Image.Image):
        gray = np.array(image.convert("L").resize((320, 240), Image.LANCZOS), dtype=np.uint8)
    else:
        if cv2 is None:  # pragma: no cover - dependency is checked earlier
            raise RuntimeError("OpenCV is required for exposure scoring.")
        gray = image
        if gray.ndim == 3:
            gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (320, 240), interpolation=cv2.INTER_AREA).astype(np.uint8)

    mean_value = float(np.mean(gray))
    std_value = float(np.std(gray))
    dark_clip = float(np.mean(gray <= 12))
    bright_clip = float(np.mean(gray >= 243))
    clip_ratio = dark_clip + bright_clip
    mean_score = 1.0 - min(1.0, abs(mean_value - 128.0) / 96.0)
    clip_score = 1.0 - min(1.0, clip_ratio / max(PANORAMA_MAX_EXPOSURE_CLIP_RATIO, 1e-6))
    spread_score = min(1.0, std_value / max(float(EXPOSURE_STD_MIN), 1.0))
    exposure_score = 100.0 * (0.45 * mean_score + 0.35 * clip_score + 0.20 * spread_score)
    return {
        "exposure_score": float(np.clip(exposure_score, 0.0, 100.0)),
        "mean": mean_value,
        "std": std_value,
        "clip_ratio": clip_ratio,
        "dark_clip_ratio": dark_clip,
        "bright_clip_ratio": bright_clip,
    }


def score_frame_quality(
    *,
    blur_score: float,
    contrast_score: float,
    exposure_score: float,
    motion_consistency_score: float = 1.0,
) -> float:
    """Combine frame metrics into a single quality score."""
    blur_component = np.clip(
        (blur_score - PANORAMA_MIN_BLUR_SCORE) / max(PANORAMA_MIN_BLUR_SCORE * 2.2, 1.0),
        0.0,
        1.0,
    )
    contrast_component = np.clip(
        (contrast_score - PANORAMA_MIN_CONTRAST_SCORE) / max(PANORAMA_MIN_CONTRAST_SCORE * 1.2, 1.0),
        0.0,
        1.0,
    )
    exposure_component = np.clip(exposure_score / 100.0, 0.0, 1.0)
    motion_component = np.clip(motion_consistency_score, 0.0, 1.0)
    return float(
        100.0
        * (
            0.44 * blur_component
            + 0.21 * contrast_component
            + 0.20 * exposure_component
            + 0.15 * motion_component
        )
    )


def _motion_consistency_scores(frame_records: list[dict]) -> list[float]:
    """Score whether a frame's visual change versus neighbors is stable."""
    if len(frame_records) <= 2:
        return [1.0] * len(frame_records)
    deltas: list[float] = []
    for idx in range(1, len(frame_records)):
        deltas.append(_mad(frame_records[idx]["fingerprint"], frame_records[idx - 1]["fingerprint"]))
    if not deltas:
        return [1.0] * len(frame_records)
    delta_arr = np.array(deltas, dtype=np.float32)
    median_delta = float(np.median(delta_arr))
    mad_delta = float(np.median(np.abs(delta_arr - median_delta)))
    allowed = max(mad_delta * 2.5, median_delta * 0.35, 1.0)
    scores: list[float] = [1.0]
    for idx in range(1, len(frame_records) - 1):
        prev_delta = deltas[idx - 1]
        next_delta = deltas[idx]
        deviation = max(abs(prev_delta - median_delta), abs(next_delta - median_delta))
        score = 1.0 - min(1.0, deviation / allowed)
        scores.append(float(np.clip(score, 0.0, 1.0)))
    scores.append(1.0)
    return scores


def filter_blurry_frames(frame_records: list[dict]) -> tuple[list[dict], int]:
    """Remove frames that are too blurry for reliable strip composition."""
    min_blur = max(float(BLUR_THRESHOLD), float(PANORAMA_MIN_BLUR_SCORE))
    sharp_records = [record for record in frame_records if record["blur_score"] >= min_blur]
    return sharp_records, len(frame_records) - len(sharp_records)


def _filter_similar_frames(frame_records: list[dict]) -> tuple[list[dict], int]:
    """Remove near-duplicate frames while preserving chronological order."""
    kept: list[dict] = []
    removed = 0
    prev_fp: np.ndarray | None = None
    for record in frame_records:
        if prev_fp is not None and _mad(record["fingerprint"], prev_fp) < SIMILARITY_MAD_THRESHOLD:
            removed += 1
            continue
        kept.append(record)
        prev_fp = record["fingerprint"]
    return kept, removed


def select_panorama_frames(candidate_frames_dir: Path, selected_frames_dir: Path) -> dict:
    """Select chronological, sharp, non-redundant frames for the panorama sweep."""
    _ensure_clean_dir(selected_frames_dir)

    candidate_paths = sorted(candidate_frames_dir.glob("*.png"))
    frame_records: list[dict] = []
    for index, frame_path in enumerate(candidate_paths):
        try:
            with Image.open(frame_path) as src:
                rgb = ImageOps.exif_transpose(src).convert("RGB")
                gray = rgb.convert("L")
                exposure = score_exposure(gray)
                frame_records.append(
                    {
                        "index": index,
                        "path": frame_path,
                        "blur_score": score_blur(gray),
                        "contrast_score": score_contrast(gray),
                        "exposure_score": exposure["exposure_score"],
                        "exposure_clip_ratio": exposure["clip_ratio"],
                        "exposure_mean": exposure["mean"],
                        "exposure_std": exposure["std"],
                        "fingerprint": np.array(
                            gray.resize((160, 90), Image.LANCZOS), dtype=np.float32
                        ),
                    }
                )
        except Exception as exc:
            print(f"  Skipping unreadable frame {frame_path.name}: {exc}")

    candidate_count = len(frame_records)
    if candidate_count == 0:
        return {
            "candidate_frame_count": 0,
            "blur_removed_count": 0,
            "contrast_removed_count": 0,
            "similarity_removed_count": 0,
            "exposure_removed_count": 0,
            "selected_frame_count": 0,
            "selected_frame_paths": [],
            "selected_resolution": None,
            "quality_score_stats": {"min": 0.0, "mean": 0.0, "max": 0.0},
        }

    sharp_records, blur_removed = filter_blurry_frames(frame_records)
    if len(sharp_records) < PANORAMA_MIN_STITCH_FRAMES and candidate_count >= PANORAMA_MIN_STITCH_FRAMES:
        sharp_records = sorted(
            frame_records,
            key=lambda record: record["blur_score"],
            reverse=True,
        )[:PANORAMA_MIN_STITCH_FRAMES]
        sharp_records = sorted(sharp_records, key=lambda record: record["index"])
        blur_removed = candidate_count - len(sharp_records)

    contrast_filtered = [
        record
        for record in sharp_records
        if record["contrast_score"] >= PANORAMA_MIN_CONTRAST_SCORE
    ]
    contrast_removed = len(sharp_records) - len(contrast_filtered)
    if len(contrast_filtered) < PANORAMA_MIN_STITCH_FRAMES and len(sharp_records) >= PANORAMA_MIN_STITCH_FRAMES:
        contrast_filtered = sharp_records
        contrast_removed = 0

    exposure_filtered = [
        record
        for record in contrast_filtered
        if (
            record["exposure_clip_ratio"] <= PANORAMA_MAX_EXPOSURE_CLIP_RATIO
            and EXPOSURE_MEAN_MIN <= record["exposure_mean"] <= EXPOSURE_MEAN_MAX
            and record["exposure_std"] >= EXPOSURE_STD_MIN
            and record["exposure_score"] >= 42.0
        )
    ]
    exposure_removed = len(contrast_filtered) - len(exposure_filtered)
    if len(exposure_filtered) < PANORAMA_MIN_STITCH_FRAMES and len(contrast_filtered) >= PANORAMA_MIN_STITCH_FRAMES:
        exposure_filtered = contrast_filtered
        exposure_removed = 0

    usable_records, similarity_removed = _filter_similar_frames(exposure_filtered)
    if len(usable_records) < PANORAMA_MIN_STITCH_FRAMES and len(exposure_filtered) >= PANORAMA_MIN_STITCH_FRAMES:
        usable_records = exposure_filtered
        similarity_removed = 0

    motion_scores = _motion_consistency_scores(usable_records)
    for record, motion_score in zip(usable_records, motion_scores):
        record["motion_consistency_score"] = motion_score
        record["quality_score"] = score_frame_quality(
            blur_score=record["blur_score"],
            contrast_score=record["contrast_score"],
            exposure_score=record["exposure_score"],
            motion_consistency_score=motion_score,
        )

    if len(usable_records) > PANORAMA_MAX_SELECTED_FRAMES:
        bucket_size = len(usable_records) / max(PANORAMA_MAX_SELECTED_FRAMES, 1)
        chosen_indices: list[int] = []
        for bucket in range(PANORAMA_MAX_SELECTED_FRAMES):
            start = int(bucket * bucket_size)
            end = min(len(usable_records), int(np.ceil((bucket + 1) * bucket_size)))
            if start >= end:
                end = min(len(usable_records), start + 1)
            best_idx = start
            best_score = -1.0
            for idx in range(start, end):
                quality_score = float(usable_records[idx]["quality_score"])
                if quality_score > best_score:
                    best_score = quality_score
                    best_idx = idx
            chosen_indices.append(best_idx)
        usable_records = [usable_records[idx] for idx in sorted(set(chosen_indices))]

    selected_paths: list[Path] = []
    selected_resolution: tuple[int, int] | None = None
    for seq, record in enumerate(usable_records, start=1):
        with Image.open(record["path"]) as src:
            rgb = ImageOps.exif_transpose(src).convert("RGB")
            resized = _resize_long_side(rgb, PANORAMA_STITCH_LONG_SIDE)
            out_path = selected_frames_dir / f"selected_{seq:04d}.png"
            resized.save(out_path, format="PNG")
            selected_paths.append(out_path)
            selected_resolution = resized.size

    quality_scores = [float(record.get("quality_score", 0.0)) for record in usable_records]
    quality_stats = {
        "min": round(min(quality_scores), 2) if quality_scores else 0.0,
        "mean": round(float(np.mean(quality_scores)), 2) if quality_scores else 0.0,
        "max": round(max(quality_scores), 2) if quality_scores else 0.0,
    }

    print(
        f"Frame quality filtering: extracted={candidate_count}, "
        f"blur_removed={blur_removed}, contrast_removed={contrast_removed}, "
        f"exposure_removed={exposure_removed}, similarity_removed={similarity_removed}, "
        f"usable={len(selected_paths)}"
    )

    return {
        "candidate_frame_count": candidate_count,
        "blur_removed_count": blur_removed,
        "contrast_removed_count": contrast_removed,
        "similarity_removed_count": similarity_removed,
        "exposure_removed_count": exposure_removed,
        "selected_frame_count": len(selected_paths),
        "selected_frame_paths": selected_paths,
        "selected_resolution": selected_resolution,
        "quality_score_stats": quality_stats,
    }


def _normalize_image_sizes(images: list[np.ndarray]) -> list[np.ndarray]:
    """Resize all images to match the first frame."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        return images
    if not images:
        return []
    base_h, base_w = images[0].shape[:2]
    normalized: list[np.ndarray] = []
    for image in images:
        if image.shape[:2] == (base_h, base_w):
            normalized.append(image)
        else:
            normalized.append(cv2.resize(image, (base_w, base_h), interpolation=cv2.INTER_LINEAR))
    return normalized


def infer_dominant_sweep_direction(pair_dxs: list[float] | np.ndarray) -> tuple[str, float]:
    """Infer whether the dominant sweep is left-to-right or right-to-left."""
    if len(pair_dxs) == 0:
        return "left_to_right", 1.0
    dxs = np.array(pair_dxs, dtype=np.float32)
    strong = dxs[np.abs(dxs) >= PANORAMA_STRIP_MIN_SHIFT_PX * 0.35]
    if len(strong) == 0:
        strong = dxs
    dominant_sign = 1.0 if float(np.median(strong)) >= 0.0 else -1.0
    direction = "left_to_right" if dominant_sign >= 0.0 else "right_to_left"
    return direction, dominant_sign


def recompute_cumulative_offsets(
    accepted_pairs: list[dict],
    dominant_sign: float,
    frame_width: int,
    frame_height: int,
) -> dict:
    """Rebuild cleaned pair shifts and cumulative offsets from accepted pairs."""
    if not accepted_pairs:
        fallback_shift = max(float(PANORAMA_STRIP_MIN_SHIFT_PX), float(frame_width) * 0.08)
        return {
            "cleaned_pair_shifts": [],
            "cleaned_pair_shift_confidences": [],
            "cleaned_pair_shift_methods": [],
            "cleaned_cumulative_offsets": [0.0],
            "cleaned_cumulative_y_offsets": [0.0],
            "cleaned_shift_median": round(fallback_shift, 2),
            "cleaned_monotonicity_score": 0.0,
            "cleaned_bad_shift_ratio": 1.0,
            "accepted_pair_count": 0,
            "rejected_pair_count": 0,
            "accepted_pair_mask": [],
        }

    cleaned_shifts = [
        float(np.clip(pair["dx"] * dominant_sign, PANORAMA_STRIP_MIN_SHIFT_PX, frame_width * PANORAMA_MAX_ALLOWED_BAD_SHIFT_RATIO))
        for pair in accepted_pairs
    ]
    cleaned_y_shifts = [
        float(np.clip(pair["dy"], -frame_height * 0.02, frame_height * 0.02))
        for pair in accepted_pairs
    ]
    cumulative_offsets = [0.0]
    cumulative_y_offsets = [0.0]
    for dx, dy in zip(cleaned_shifts, cleaned_y_shifts):
        cumulative_offsets.append(round(cumulative_offsets[-1] + dx, 2))
        cumulative_y_offsets.append(round(cumulative_y_offsets[-1] + dy, 2))

    monotonicity = float(
        np.mean([1.0 if dx >= PANORAMA_STRIP_MIN_SHIFT_PX else 0.0 for dx in cleaned_shifts])
    ) if cleaned_shifts else 0.0
    return {
        "cleaned_pair_shifts": [round(dx, 2) for dx in cleaned_shifts],
        "cleaned_pair_shift_confidences": [round(float(pair["confidence"]), 4) for pair in accepted_pairs],
        "cleaned_pair_shift_methods": [pair["method"] for pair in accepted_pairs],
        "cleaned_cumulative_offsets": cumulative_offsets,
        "cleaned_cumulative_y_offsets": cumulative_y_offsets,
        "cleaned_shift_median": round(float(np.median(np.array(cleaned_shifts, dtype=np.float32))), 2),
        "cleaned_monotonicity_score": round(monotonicity, 4),
        "cleaned_bad_shift_ratio": 0.0,
        "accepted_pair_count": len(accepted_pairs),
        "rejected_pair_count": 0,
    }


def _evaluate_motion_pairs(
    raw_pairs: list[dict],
    dominant_sign: float,
    dominant_direction: str,
    frame_width: int,
    frame_height: int,
) -> tuple[list[bool], list[int], dict]:
    """Evaluate pair acceptance and compute cleaned motion metrics."""
    oriented_dxs = np.array([float(pair["dx"]) * dominant_sign for pair in raw_pairs], dtype=np.float32)
    confidences = np.array([float(pair["confidence"]) for pair in raw_pairs], dtype=np.float32)
    confident = oriented_dxs[
        (oriented_dxs >= PANORAMA_STRIP_MIN_SHIFT_PX * 0.35)
        & (confidences >= PANORAMA_MIN_PAIR_CONFIDENCE)
    ]
    if len(confident) == 0:
        confident = oriented_dxs[np.abs(oriented_dxs) >= PANORAMA_STRIP_MIN_SHIFT_PX * 0.35]
    cleaned_median = (
        float(np.median(confident))
        if len(confident)
        else max(float(PANORAMA_STRIP_MIN_SHIFT_PX), frame_width * 0.10)
    )
    cleaned_median = float(
        np.clip(
            cleaned_median,
            PANORAMA_STRIP_MIN_SHIFT_PX,
            frame_width * PANORAMA_MAX_ALLOWED_BAD_SHIFT_RATIO,
        )
    )
    allowed_deviation = max(
        cleaned_median * PANORAMA_MAX_SHIFT_DEVIATION_RATIO,
        float(PANORAMA_STRIP_MIN_SHIFT_PX),
    )

    accepted_mask: list[bool] = []
    bad_pair_indices: list[int] = []
    accepted_pairs: list[dict] = []
    for pair_idx, pair in enumerate(raw_pairs):
        oriented = float(pair["dx"]) * dominant_sign
        accepted = (
            oriented >= PANORAMA_STRIP_MIN_SHIFT_PX * 0.60
            and oriented <= frame_width * PANORAMA_MAX_ALLOWED_BAD_SHIFT_RATIO
            and abs(oriented - cleaned_median) <= allowed_deviation
            and float(pair["confidence"]) >= PANORAMA_MIN_PAIR_CONFIDENCE
        )
        accepted_mask.append(accepted)
        if accepted:
            accepted_pairs.append(pair)
        else:
            bad_pair_indices.append(pair_idx)

    recomputed = recompute_cumulative_offsets(
        accepted_pairs,
        dominant_sign,
        frame_width,
        frame_height,
    )
    recomputed["dominant_direction"] = dominant_direction
    recomputed["accepted_pair_count"] = len(accepted_pairs)
    recomputed["rejected_pair_count"] = len(bad_pair_indices)
    recomputed["cleaned_bad_shift_ratio"] = round(
        float(len(bad_pair_indices)) / float(max(len(raw_pairs), 1)),
        4,
    )
    recomputed["pair_acceptance_flags"] = accepted_mask
    return accepted_mask, bad_pair_indices, recomputed


def filter_motion_inconsistent_frames(
    images: list[np.ndarray],
    frame_quality_scores: list[float],
    sweep_meta: dict,
) -> tuple[list[np.ndarray], list[float], dict]:
    """Iteratively prune frames causing bad motion pairs while preserving coverage."""
    if not images:
        return images, frame_quality_scores, sweep_meta

    current_images = list(images)
    current_scores = list(frame_quality_scores)
    original_indices = list(range(len(images)))
    latest_meta = dict(sweep_meta)
    latest_clean_meta: dict | None = None

    for _ in range(8):
        raw_pairs = latest_meta.get("raw_pairs", [])
        if not raw_pairs or len(current_images) <= PANORAMA_MIN_STITCH_FRAMES:
            break

        frame_height = int(latest_meta.get("frame_height_px", current_images[0].shape[0]))
        frame_width = int(latest_meta.get("frame_width_px", current_images[0].shape[1]))
        dominant_direction, dominant_sign = infer_dominant_sweep_direction(
            [pair["dx"] for pair in raw_pairs]
        )
        accepted_mask, bad_pair_indices, recomputed = _evaluate_motion_pairs(
            raw_pairs,
            dominant_sign,
            dominant_direction,
            frame_width,
            frame_height,
        )
        recomputed["frame_keep_indices"] = original_indices.copy()
        latest_clean_meta = {**latest_meta, **recomputed}
        cleaned_bad_ratio = float(recomputed["cleaned_bad_shift_ratio"])
        latest_meta = {**latest_meta, **recomputed}

        if (
            len(bad_pair_indices) == 0
            or (
                latest_meta["cleaned_monotonicity_score"] >= PANORAMA_MIN_MONOTONICITY_AFTER_CLEANUP
                and cleaned_bad_ratio <= PANORAMA_MAX_BAD_SHIFT_RATIO_AFTER_CLEANUP
            )
        ):
            return current_images, current_scores, latest_meta

        votes = [0.0] * len(current_images)
        for pair_idx in bad_pair_indices:
            left_idx = pair_idx
            right_idx = pair_idx + 1
            if right_idx >= len(current_images):
                continue
            pair = raw_pairs[pair_idx]
            left_penalty = 100.0 - float(current_scores[left_idx])
            right_penalty = 100.0 - float(current_scores[right_idx])
            if pair_idx > 0 and not accepted_mask[pair_idx - 1]:
                left_penalty += 4.0
            if pair_idx < len(accepted_mask) - 1 and not accepted_mask[pair_idx + 1]:
                right_penalty += 4.0
            if left_penalty >= right_penalty:
                votes[left_idx] += 1.0 + left_penalty / 100.0
            else:
                votes[right_idx] += 1.0 + right_penalty / 100.0

        drop_idx = int(np.argmax(np.array(votes, dtype=np.float32)))
        if (
            len(current_images) - 1 < PANORAMA_MIN_STITCH_FRAMES
            or votes[drop_idx] <= 0.0
        ):
            return current_images, current_scores, latest_meta

        current_images.pop(drop_idx)
        current_scores.pop(drop_idx)
        original_indices.pop(drop_idx)
        latest_meta = estimate_cumulative_sweep(current_images)

    if current_images and latest_meta.get("raw_pairs"):
        frame_height = int(latest_meta.get("frame_height_px", current_images[0].shape[0]))
        frame_width = int(latest_meta.get("frame_width_px", current_images[0].shape[1]))
        dominant_direction, dominant_sign = infer_dominant_sweep_direction(
            [pair["dx"] for pair in latest_meta.get("raw_pairs", [])]
        )
        _, _, recomputed = _evaluate_motion_pairs(
            latest_meta.get("raw_pairs", []),
            dominant_sign,
            dominant_direction,
            frame_width,
            frame_height,
        )
        recomputed["frame_keep_indices"] = original_indices.copy()
        latest_meta = {**latest_meta, **recomputed}
        latest_clean_meta = latest_meta

    return current_images, current_scores, (latest_clean_meta or latest_meta)


def downselect_panorama_frames(
    images: list[np.ndarray],
    frame_quality_scores: list[float],
    sweep_meta: dict,
) -> tuple[list[np.ndarray], list[float], dict]:
    """Reduce frame count aggressively when motion is mixed to limit ghosting."""
    frame_count = len(images)
    if frame_count <= PANORAMA_MIN_SELECTED_FRAMES:
        return images, frame_quality_scores, sweep_meta

    cleaned_monotonicity = float(sweep_meta.get("cleaned_monotonicity_score", sweep_meta.get("monotonicity_score", 0.0)))
    cleaned_bad_shift_ratio = float(sweep_meta.get("cleaned_bad_shift_ratio", sweep_meta.get("bad_shift_ratio", 1.0)))
    if (
        cleaned_monotonicity >= 0.90
        and cleaned_bad_shift_ratio <= 0.10
        and frame_count > PANORAMA_MAX_FRAME_COUNT_RELAXED
    ):
        target_count = PANORAMA_MAX_FRAME_COUNT_RELAXED
    elif frame_count > PANORAMA_MAX_FRAME_COUNT_STRICT:
        target_count = PANORAMA_MAX_FRAME_COUNT_STRICT
    else:
        target_count = frame_count

    if target_count >= frame_count:
        return images, frame_quality_scores, sweep_meta

    chosen_indices: list[int] = []
    bucket_size = frame_count / max(target_count, 1)
    for bucket in range(target_count):
        start = int(bucket * bucket_size)
        end = min(frame_count, int(np.ceil((bucket + 1) * bucket_size)))
        if start >= end:
            end = min(frame_count, start + 1)
        best_idx = start
        best_score = -1.0
        for idx in range(start, end):
            score = float(frame_quality_scores[idx])
            if score > best_score:
                best_score = score
                best_idx = idx
        chosen_indices.append(best_idx)

    chosen_indices = sorted(set(chosen_indices))
    downselected_images = [images[idx] for idx in chosen_indices]
    downselected_scores = [frame_quality_scores[idx] for idx in chosen_indices]
    downselected_meta = estimate_cumulative_sweep(downselected_images)
    downselected_meta["downselected_frame_indices"] = chosen_indices
    downselected_meta["final_frame_count_used"] = len(downselected_images)
    return downselected_images, downselected_scores, downselected_meta


def _prepare_shift_image(image_bgr: np.ndarray) -> np.ndarray:
    """Prepare a stable grayscale crop for pairwise shift estimation."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        raise RuntimeError("OpenCV is required for shift estimation.")
    band = extract_alignment_band(image_bgr)
    gray = cv2.cvtColor(band, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape[:2]
    y1 = max(0, int(round(height * 0.04)))
    y2 = min(height, int(round(height * 0.96)))
    x1 = max(0, int(round(width * 0.20)))
    x2 = min(width, int(round(width * 0.80)))
    cropped = gray[y1:y2, x1:x2]
    return cv2.GaussianBlur(cropped, (5, 5), 0)


def _estimate_template_shift(gray1: np.ndarray, gray2: np.ndarray) -> dict:
    """Estimate shift by matching the center of gray1 inside gray2."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        raise RuntimeError("OpenCV is required for shift estimation.")

    height, width = gray1.shape[:2]
    scale = min(1.0, 640.0 / max(height, width))
    if scale < 1.0:
        resized1 = cv2.resize(gray1, (int(round(width * scale)), int(round(height * scale))))
        resized2 = cv2.resize(gray2, (int(round(width * scale)), int(round(height * scale))))
    else:
        resized1 = gray1
        resized2 = gray2
    small_h, small_w = resized1.shape[:2]

    tpl_w = max(48, int(round(small_w * 0.34)))
    tpl_h = max(48, int(round(small_h * 0.62)))
    search_margin_x = max(32, int(round(small_w * 0.22)))
    search_margin_y = max(8, int(round(small_h * 0.06)))

    x1 = max(0, (small_w - tpl_w) // 2)
    y1 = max(0, (small_h - tpl_h) // 2)
    template = resized1[y1 : y1 + tpl_h, x1 : x1 + tpl_w]
    sx1 = max(0, x1 - search_margin_x)
    sx2 = min(small_w, x1 + tpl_w + search_margin_x)
    sy1 = max(0, y1 - search_margin_y)
    sy2 = min(small_h, y1 + tpl_h + search_margin_y)
    search = resized2[sy1:sy2, sx1:sx2]

    if search.shape[0] < template.shape[0] or search.shape[1] < template.shape[1]:
        return {"dx": 0.0, "dy": 0.0, "score": 0.0}

    result = cv2.matchTemplate(search, template, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(result)
    dx = (sx1 + max_loc[0]) - x1
    dy = (sy1 + max_loc[1]) - y1
    inv_scale = 1.0 / max(scale, 1e-6)
    return {
        "dx": float(dx * inv_scale),
        "dy": float(dy * inv_scale),
        "score": float(max_val),
    }


def _estimate_pair_shift(img1: np.ndarray, img2: np.ndarray) -> dict:
    """Estimate adjacent-frame shift with phase correlation and template fallback."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        raise RuntimeError("OpenCV is required for shift estimation.")

    gray1 = _prepare_shift_image(img1)
    gray2 = _prepare_shift_image(img2)
    (phase_dx, phase_dy), phase_response = cv2.phaseCorrelate(
        np.float32(gray1),
        np.float32(gray2),
    )
    template = _estimate_template_shift(gray1, gray2)

    width = gray1.shape[1]
    height = gray1.shape[0]
    phase_ok = (
        np.isfinite(phase_dx)
        and np.isfinite(phase_dy)
        and abs(float(phase_dx)) <= width * PANORAMA_MAX_ALLOWED_BAD_SHIFT_RATIO * 1.6
        and abs(float(phase_dy)) <= height * 0.12
    )

    if (not phase_ok) or float(phase_response) < 0.03 or abs(float(phase_dx)) < PANORAMA_STRIP_MIN_SHIFT_PX * 0.35:
        chosen_dx = float(template["dx"])
        chosen_dy = float(template["dy"])
        method = "template"
        confidence = float(max(template["score"], 0.0))
    elif float(template["score"]) >= 0.12:
        chosen_dx = float(0.65 * phase_dx + 0.35 * template["dx"])
        chosen_dy = float(0.65 * phase_dy + 0.35 * template["dy"])
        method = "hybrid"
        confidence = float(max(phase_response, template["score"]))
    else:
        chosen_dx = float(phase_dx)
        chosen_dy = float(phase_dy)
        method = "phase"
        confidence = float(max(phase_response, 0.0))

    return {
        "dx": chosen_dx,
        "dy": chosen_dy,
        "phase_dx": float(phase_dx),
        "phase_dy": float(phase_dy),
        "phase_response": float(phase_response),
        "template_dx": float(template["dx"]),
        "template_dy": float(template["dy"]),
        "template_score": float(template["score"]),
        "confidence": float(np.clip(confidence, 0.0, 1.0)),
        "method": method,
    }


def estimate_horizontal_shift(img1: np.ndarray, img2: np.ndarray) -> tuple[float, float]:
    """Return horizontal and vertical motion estimate between adjacent frames."""
    pair = _estimate_pair_shift(img1, img2)
    return pair["dx"], pair["dy"]


def estimate_cumulative_sweep(images: list[np.ndarray]) -> dict:
    """Estimate cumulative horizontal sweep from chronologically ordered frames."""
    normalized_images = _normalize_image_sizes(images)
    if not normalized_images:
        return {
            "raw_pairs": [],
            "pair_shifts_px": [],
            "effective_pair_shifts_px": [],
            "cumulative_offsets_px": [0.0],
            "cumulative_y_offsets_px": [0.0],
            "total_sweep_px": 0.0,
            "median_shift_px": 0.0,
            "monotonicity_score": 0.0,
            "bad_shift_ratio": 1.0,
            "frame_width_px": 0,
            "frame_height_px": 0,
            "sweep_span_ratio": 0.0,
            "pair_shift_confidences": [],
            "pair_shift_methods": [],
            "dominant_direction": "left_to_right",
        }

    frame_height, frame_width = normalized_images[0].shape[:2]
    raw_pairs = [
        _estimate_pair_shift(normalized_images[idx - 1], normalized_images[idx])
        for idx in range(1, len(normalized_images))
    ]
    if not raw_pairs:
        return {
            "raw_pairs": [],
            "pair_shifts_px": [],
            "effective_pair_shifts_px": [],
            "cumulative_offsets_px": [0.0],
            "cumulative_y_offsets_px": [0.0],
            "total_sweep_px": 0.0,
            "median_shift_px": float(max(PANORAMA_STRIP_MIN_SHIFT_PX, frame_width * 0.08)),
            "monotonicity_score": 1.0,
            "bad_shift_ratio": 0.0,
            "frame_width_px": int(frame_width),
            "frame_height_px": int(frame_height),
            "sweep_span_ratio": 0.0,
            "pair_shift_confidences": [],
            "pair_shift_methods": [],
            "dominant_direction": "left_to_right",
        }

    raw_dxs = np.array([pair["dx"] for pair in raw_pairs], dtype=np.float32)
    dominant_direction, dominant_sign = infer_dominant_sweep_direction(raw_dxs)
    oriented_dx = raw_dxs * dominant_sign
    max_reasonable_shift = max(float(PANORAMA_STRIP_MIN_SHIFT_PX), float(frame_width) * PANORAMA_MAX_ALLOWED_BAD_SHIFT_RATIO)
    valid_oriented = oriented_dx[
        (oriented_dx >= PANORAMA_STRIP_MIN_SHIFT_PX * 0.35)
        & (oriented_dx <= max_reasonable_shift)
    ]
    fallback_shift = max(float(PANORAMA_STRIP_MIN_SHIFT_PX), float(frame_width) * 0.10)
    median_shift = float(np.median(valid_oriented)) if len(valid_oriented) else fallback_shift
    median_shift = float(np.clip(median_shift, PANORAMA_STRIP_MIN_SHIFT_PX, max_reasonable_shift))

    pair_shifts_px: list[float] = []
    effective_pair_shifts_px: list[float] = []
    cumulative_offsets_px: list[float] = [0.0]
    cumulative_y_offsets_px: list[float] = [0.0]
    pair_shift_confidences: list[float] = []
    pair_shift_methods: list[str] = []
    monotonic_good = 0
    bad_shift_count = 0

    for pair in raw_pairs:
        raw_oriented = float(pair["dx"] * dominant_sign)
        raw_dy = float(pair["dy"])
        pair_shifts_px.append(round(float(pair["dx"]), 2))
        pair_shift_confidences.append(round(float(pair["confidence"]), 4))
        pair_shift_methods.append(pair["method"])

        if raw_oriented >= PANORAMA_STRIP_MIN_SHIFT_PX * 0.35:
            monotonic_good += 1

        is_bad = (
            raw_oriented < PANORAMA_STRIP_MIN_SHIFT_PX * 0.35
            or raw_oriented > max_reasonable_shift
            or float(pair["confidence"]) < PANORAMA_MIN_PAIR_CONFIDENCE
        )
        if is_bad:
            effective_shift = median_shift
            bad_shift_count += 1
        else:
            effective_shift = raw_oriented
        effective_shift = float(
            np.clip(effective_shift, PANORAMA_STRIP_MIN_SHIFT_PX, max_reasonable_shift)
        )
        effective_pair_shifts_px.append(round(effective_shift, 2))
        cumulative_offsets_px.append(round(cumulative_offsets_px[-1] + effective_shift, 2))

        effective_dy = float(np.clip(raw_dy, -frame_height * 0.02, frame_height * 0.02))
        cumulative_y_offsets_px.append(round(cumulative_y_offsets_px[-1] + effective_dy, 2))

    total_sweep_px = float(cumulative_offsets_px[-1])
    monotonicity_score = (
        float(monotonic_good) / float(len(raw_pairs))
        if raw_pairs
        else 0.0
    )
    bad_shift_ratio = (
        float(bad_shift_count) / float(len(raw_pairs))
        if raw_pairs
        else 0.0
    )
    sweep_span_ratio = total_sweep_px / max(float(frame_width), 1.0)

    return {
        "raw_pairs": raw_pairs,
        "pair_shifts_px": pair_shifts_px,
        "effective_pair_shifts_px": effective_pair_shifts_px,
        "cumulative_offsets_px": cumulative_offsets_px,
        "cumulative_y_offsets_px": cumulative_y_offsets_px,
        "total_sweep_px": round(total_sweep_px, 2),
        "median_shift_px": round(median_shift, 2),
        "monotonicity_score": round(monotonicity_score, 4),
        "bad_shift_ratio": round(bad_shift_ratio, 4),
        "frame_width_px": int(frame_width),
        "frame_height_px": int(frame_height),
        "sweep_span_ratio": round(sweep_span_ratio, 4),
        "pair_shift_confidences": pair_shift_confidences,
        "pair_shift_methods": pair_shift_methods,
        "dominant_direction": dominant_direction,
    }


def extract_center_strip(
    image_bgr: np.ndarray,
    strip_width_ratio: float = PANORAMA_STRIP_WIDTH_RATIO_NARROW,
    strip_width_px: int | None = None,
) -> tuple[np.ndarray, int]:
    """Extract a central vertical strip from a frame."""
    height, width = image_bgr.shape[:2]
    if strip_width_px is None:
        strip_width = max(PANORAMA_STRIP_MIN_WIDTH, int(round(width * strip_width_ratio)))
    else:
        strip_width = int(strip_width_px)
    strip_width = min(strip_width, width)
    x1 = max(0, (width - strip_width) // 2)
    x2 = x1 + strip_width
    return image_bgr[:, x1:x2].copy(), strip_width


def extract_alignment_band(image_bgr: np.ndarray) -> np.ndarray:
    """Extract the vertically stable band used for shift estimation."""
    height = image_bgr.shape[0]
    y1 = max(0, int(round(height * PANORAMA_ALIGNMENT_BAND_TOP_RATIO)))
    y2 = min(height, int(round(height * PANORAMA_ALIGNMENT_BAND_BOTTOM_RATIO)))
    if y2 <= y1:
        return image_bgr
    return image_bgr[y1:y2, :, :]


def apply_center_weight_mask(height: int, width: int) -> np.ndarray:
    """Return a center-heavy mask that downweights edges and the lower foreground."""
    horizontal_axis = np.linspace(-1.0, 1.0, width, dtype=np.float32)
    horizontal = 1.0 - np.abs(horizontal_axis) ** 1.6
    horizontal = 0.25 + 0.75 * np.clip(horizontal, 0.0, 1.0)

    vertical_axis = np.linspace(0.0, 1.0, height, dtype=np.float32)
    vertical = 0.82 + 0.18 * (1.0 - np.abs((vertical_axis - 0.5) * 2.0))
    bottom_start = int(round(height * PANORAMA_FOREGROUND_DOWNWEIGHT_BOTTOM_RATIO))
    if bottom_start < height:
        bottom_weights = np.linspace(1.0, 0.45, height - bottom_start, dtype=np.float32)
        vertical[bottom_start:] *= bottom_weights

    return (vertical.reshape(height, 1) * horizontal.reshape(1, width))[:, :, None]


def _build_strip_weight_mask(height: int, strip_width: int) -> np.ndarray:
    """Return a feathering mask for strip overlap blending."""
    edge_width = int(round(strip_width * PANORAMA_STRIP_BLEND_EDGE_RATIO))
    horizontal = np.ones(strip_width, dtype=np.float32)
    if edge_width > 0 and edge_width * 2 < strip_width:
        ramp = np.linspace(0.25, 1.0, edge_width, endpoint=False, dtype=np.float32)
        horizontal[:edge_width] = ramp
        horizontal[-edge_width:] = ramp[::-1]
    elif strip_width > 1:
        axis = np.linspace(0.0, 1.0, strip_width, dtype=np.float32)
        horizontal = np.maximum(0.25, 1.0 - np.abs(axis - 0.5) * 2.0)

    center_mask = apply_center_weight_mask(height, strip_width)[:, :, 0]
    return (center_mask * horizontal.reshape(1, strip_width))[:, :, None]


def crop_black_borders(
    image_bgr: np.ndarray,
    coverage_mask: np.ndarray | None = None,
) -> np.ndarray:
    """Crop invalid empty borders around a panorama canvas."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        return image_bgr
    if coverage_mask is None:
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, 2, 255, cv2.THRESH_BINARY)
    else:
        mask = np.where(coverage_mask, 255, 0).astype(np.uint8)
    coords = cv2.findNonZero(mask)
    if coords is None:
        return image_bgr
    x, y, width, height = cv2.boundingRect(coords)
    if width <= 0 or height <= 0:
        return image_bgr
    return image_bgr[y : y + height, x : x + width]


def compose_cylindrical_panorama(
    images: list[np.ndarray],
    sweep_meta: dict,
    frame_quality_scores: list[float] | None = None,
) -> tuple[np.ndarray, dict]:
    """Compose a cylindrical panorama by blending central strips in sweep order."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        raise RuntimeError("OpenCV is required for panorama composition.")
    if not images:
        raise ValueError("No images provided for cylindrical panorama composition.")

    normalized_images = _normalize_image_sizes(images)
    frame_height, frame_width = normalized_images[0].shape[:2]
    if frame_quality_scores is None or len(frame_quality_scores) != len(normalized_images):
        frame_quality_scores = [70.0] * len(normalized_images)

    median_shift_px = float(
        sweep_meta.get(
            "cleaned_shift_median",
            sweep_meta.get("median_shift_px", frame_width * PANORAMA_STRIP_WIDTH_RATIO_NARROW),
        )
    )
    strip_width_px = int(
        np.clip(
            max(frame_width * PANORAMA_STRIP_WIDTH_RATIO_NARROW, median_shift_px * 1.15),
            PANORAMA_STRIP_MIN_WIDTH,
            frame_width * 0.18,
        )
    )

    cumulative_offsets = np.array(
        sweep_meta.get(
            "cleaned_cumulative_offsets",
            sweep_meta.get("cumulative_offsets_px", [0.0] * len(normalized_images)),
        ),
        dtype=np.float32,
    )
    if len(cumulative_offsets) != len(normalized_images):
        cumulative_offsets = np.linspace(
            0.0,
            max(float(sweep_meta.get("total_sweep_px", 0.0)), 0.0),
            num=len(normalized_images),
            dtype=np.float32,
        )

    cumulative_y_offsets = np.array(
        sweep_meta.get(
            "cleaned_cumulative_y_offsets",
            sweep_meta.get("cumulative_y_offsets_px", [0.0] * len(normalized_images)),
        ),
        dtype=np.float32,
    )
    if len(cumulative_y_offsets) != len(normalized_images):
        cumulative_y_offsets = np.zeros(len(normalized_images), dtype=np.float32)
    centered_y_offsets = cumulative_y_offsets - float(np.median(cumulative_y_offsets))
    centered_y_offsets = np.clip(centered_y_offsets, -frame_height * 0.06, frame_height * 0.06)

    y_padding = int(np.ceil(np.max(np.abs(centered_y_offsets)))) + 6
    canvas_width = max(
        int(np.ceil(float(cumulative_offsets[-1]) + strip_width_px + 6)),
        strip_width_px * 2,
    )
    canvas_height = frame_height + y_padding * 2
    base_y = y_padding

    accum = np.zeros((canvas_height, canvas_width, 3), dtype=np.float32)
    weight_accum = np.zeros((canvas_height, canvas_width, 1), dtype=np.float32)
    strip_mask = _build_strip_weight_mask(frame_height, strip_width_px)

    accepted_pairs = int(sweep_meta.get("accepted_pair_count", max(0, len(normalized_images) - 1)))
    rejected_pairs = int(sweep_meta.get("rejected_pair_count", 0))
    normalized_quality = np.array(frame_quality_scores, dtype=np.float32)
    if normalized_quality.size:
        quality_min = float(np.min(normalized_quality))
        quality_span = max(float(np.max(normalized_quality) - quality_min), 1.0)
    else:
        quality_min = 0.0
        quality_span = 1.0

    for idx, image in enumerate(normalized_images):
        strip, strip_width = extract_center_strip(image, strip_width_px=strip_width_px)
        x1 = int(round(float(cumulative_offsets[idx])))
        y1 = int(round(base_y + float(centered_y_offsets[idx])))
        x2 = min(canvas_width, x1 + strip_width)
        y2 = min(canvas_height, y1 + frame_height)
        if x2 <= x1 or y2 <= y1:
            continue

        strip_crop = strip[: y2 - y1, : x2 - x1].astype(np.float32)
        quality_weight = 0.75 + 0.5 * (
            (float(frame_quality_scores[idx]) - quality_min) / quality_span
            if quality_span > 0.0
            else 0.0
        )
        mask_crop = strip_mask[: y2 - y1, : x2 - x1, :] * quality_weight
        accum[y1:y2, x1:x2, :] += strip_crop * mask_crop
        weight_accum[y1:y2, x1:x2, :] += mask_crop

    blended = accum / np.maximum(weight_accum, 1e-6)
    canvas = np.clip(blended, 0, 255).astype(np.uint8)
    filled_mask = weight_accum[:, :, 0] > 1e-6
    cropped = crop_black_borders(canvas, coverage_mask=filled_mask)
    composition_fill_ratio = _compute_fill_ratio(cropped)

    return cropped, {
        "composition_method": "cylindrical_strip_sweep",
        "pre_normalization_resolution": [int(cropped.shape[1]), int(cropped.shape[0])],
        "canvas_size": [int(canvas_width), int(canvas_height)],
        "strip_width_px": int(strip_width_px),
        "average_horizontal_shift": float(sweep_meta.get("cleaned_shift_median", sweep_meta.get("median_shift_px", 0.0))),
        "filled_coverage_ratio": round(composition_fill_ratio, 4),
        "accepted_pair_count": accepted_pairs,
        "rejected_pair_count": rejected_pairs,
    }


def _apply_vertical_normalization(image_bgr: np.ndarray) -> tuple[np.ndarray, dict]:
    """Trim a small top/bottom margin and resize back to reduce indoor bowing."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        return image_bgr, {"vertical_trim_px": 0}
    height, width = image_bgr.shape[:2]
    trim_px = int(round(height * PANORAMA_VERTICAL_TRIM_RATIO))
    if trim_px <= 0 or trim_px * 2 >= height - 8:
        return image_bgr, {"vertical_trim_px": 0}
    trimmed = image_bgr[trim_px : height - trim_px, :]
    renormalized = cv2.resize(trimmed, (width, height), interpolation=cv2.INTER_LINEAR)
    return renormalized, {"vertical_trim_px": int(trim_px)}


def normalize_rotational_panorama_to_360(
    image_bgr: np.ndarray,
    sweep_meta: dict,
) -> tuple[np.ndarray, dict]:
    """Normalize a cylindrical panorama onto an immersive 2:1 canvas."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        raise RuntimeError("OpenCV is required for panorama normalization.")

    working = crop_black_borders(image_bgr)
    if working.size == 0:
        raise RuntimeError("Cylindrical panorama collapsed before 360 normalization.")

    working, vertical_meta = _apply_vertical_normalization(working)
    source_height, source_width = working.shape[:2]
    if source_height <= 0 or source_width <= 0:
        raise RuntimeError("Invalid panorama dimensions before 360 normalization.")

    preferred_height = min(PANORAMA_TARGET_HEIGHT, source_height)
    preferred_width = int(round(preferred_height * PANORAMA_TARGET_ASPECT_RATIO))
    max_sharp_width = max(int(round(source_width * 1.08)), min(source_width, 1400))
    target_width = min(preferred_width, max_sharp_width)
    target_width = max(target_width, min(source_width, 960))
    target_height = max(1, int(round(target_width / PANORAMA_TARGET_ASPECT_RATIO)))

    source_extended = working
    edge_pad = max(8, int(round(source_width * PANORAMA_EDGE_SAMPLE_WIDTH_RATIO)))
    if edge_pad * 2 < source_width:
        source_extended = np.concatenate(
            [working[:, -edge_pad:], working, working[:, :edge_pad]],
            axis=1,
        )

    sweep_span_ratio = float(sweep_meta.get("sweep_span_ratio", 0.0))
    monotonicity_score = float(
        sweep_meta.get("cleaned_monotonicity_score", sweep_meta.get("monotonicity_score", 0.0))
    )
    if sweep_span_ratio >= 1.55 and monotonicity_score >= PANORAMA_MIN_MONOTONICITY_SCORE:
        normalization_method = "near_full_turn_resample"
        x_curve = np.linspace(0.0, 1.0, target_width, dtype=np.float32)
    elif PANORAMA_PARTIAL_SWEEP_STRETCH_ENABLED:
        normalization_method = "partial_sweep_stretch"
        x_linear = np.linspace(0.0, 1.0, target_width, dtype=np.float32)
        x_curve = 0.5 - 0.5 * np.cos(np.pi * x_linear)
    else:
        normalization_method = "centered_projection"
        x_curve = np.linspace(0.0, 1.0, target_width, dtype=np.float32)

    x_source = edge_pad + x_curve * max(source_width - 1, 1)
    y_source = np.linspace(0.0, source_height - 1, target_height, dtype=np.float32)
    map_x = np.repeat(x_source.reshape(1, target_width), target_height, axis=0).astype(np.float32)
    map_y = np.repeat(y_source.reshape(target_height, 1), target_width, axis=1).astype(np.float32)
    normalized = cv2.remap(
        source_extended,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT,
    )

    return normalized, {
        "normalization_method": normalization_method,
        "normalized_canvas_size": [int(target_width), int(target_height)],
        "pre_normalization_resolution": [int(source_width), int(source_height)],
        "post_normalization_resolution": [int(target_width), int(target_height)],
        "vertical_trim_px": int(vertical_meta["vertical_trim_px"]),
    }


def enhance_panorama_clarity(image_bgr: np.ndarray) -> tuple[np.ndarray, dict]:
    """Apply mild local-contrast enhancement and unsharp masking."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        return image_bgr, {"clarity_enhancement_applied": False}

    enhanced = image_bgr.copy()
    lab = cv2.cvtColor(enhanced, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l_channel)
    l_blended = cv2.addWeighted(
        l_channel,
        1.0 - PANORAMA_LOCAL_CONTRAST_AMOUNT,
        l_enhanced,
        PANORAMA_LOCAL_CONTRAST_AMOUNT,
        0.0,
    )
    enhanced = cv2.cvtColor(cv2.merge((l_blended, a_channel, b_channel)), cv2.COLOR_LAB2BGR)

    gaussian = cv2.GaussianBlur(enhanced, (0, 0), sigmaX=1.2)
    sharpened = cv2.addWeighted(
        enhanced,
        1.0 + PANORAMA_SHARPEN_AMOUNT,
        gaussian,
        -PANORAMA_SHARPEN_AMOUNT,
        0.0,
    )
    return np.clip(sharpened, 0, 255).astype(np.uint8), {
        "clarity_enhancement_applied": True,
        "local_contrast_amount": float(PANORAMA_LOCAL_CONTRAST_AMOUNT),
        "sharpen_amount": float(PANORAMA_SHARPEN_AMOUNT),
    }


def _band_overlap_by_shift(
    left_gray: np.ndarray,
    right_gray: np.ndarray,
    shift_y: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Return vertically overlapped grayscale bands for a candidate shift."""
    if shift_y > 0:
        return left_gray[shift_y:, :], right_gray[:-shift_y, :]
    if shift_y < 0:
        return left_gray[:shift_y, :], right_gray[-shift_y:, :]
    return left_gray, right_gray


def _estimate_edge_alignment(
    left_band: np.ndarray,
    right_band: np.ndarray,
) -> tuple[int, float]:
    """Estimate vertical offset and continuity quality between wrap edges."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        return 0, 0.0

    left_gray = cv2.cvtColor(left_band, cv2.COLOR_BGR2GRAY)
    right_gray = cv2.cvtColor(right_band, cv2.COLOR_BGR2GRAY)

    height = left_gray.shape[0]
    scale = min(1.0, 256.0 / max(height, 1))
    if scale < 1.0:
        resized_h = max(32, int(round(height * scale)))
        resized_w = max(12, int(round(left_gray.shape[1] * scale)))
        left_gray = cv2.resize(left_gray, (resized_w, resized_h), interpolation=cv2.INTER_AREA)
        right_gray = cv2.resize(right_gray, (resized_w, resized_h), interpolation=cv2.INTER_AREA)
    else:
        resized_h = height

    max_shift = max(1, int(round(resized_h * 0.05)))
    best_shift = 0
    best_error = float("inf")
    for shift_y in range(-max_shift, max_shift + 1):
        overlap_left, overlap_right = _band_overlap_by_shift(left_gray, right_gray, shift_y)
        if overlap_left.size == 0 or overlap_right.size == 0:
            continue
        error = float(np.mean(np.abs(overlap_left.astype(np.float32) - overlap_right.astype(np.float32))))
        if error < best_error:
            best_error = error
            best_shift = shift_y

    inv_scale = 1.0 / max(scale, 1e-6)
    quality = float(np.clip(1.0 - best_error / 90.0, 0.0, 1.0))
    return int(round(best_shift * inv_scale)), quality


def align_and_blend_panorama_seam(image_bgr: np.ndarray) -> tuple[np.ndarray, dict]:
    """Choose a seam cut, align the wrap edges, and blend the seam region."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        raise RuntimeError("OpenCV is required for seam alignment.")

    height, width = image_bgr.shape[:2]
    if height <= 0 or width <= 0:
        raise RuntimeError("Invalid panorama dimensions during seam alignment.")

    sample_width = max(24, int(round(width * PANORAMA_EDGE_SAMPLE_WIDTH_RATIO)))
    blend_width = max(sample_width, int(round(width * PANORAMA_SEAM_BLEND_RATIO)))
    best_offset = 0
    best_shift_y = 0
    best_quality = -1.0
    step = max(1, width // 36)

    for offset in range(0, width, step):
        shifted = np.roll(image_bgr, -offset, axis=1)
        left_band = shifted[:, :sample_width, :]
        right_band = shifted[:, -sample_width:, :]
        shift_y, quality = _estimate_edge_alignment(left_band, right_band)
        if quality > best_quality:
            best_quality = quality
            best_offset = offset
            best_shift_y = shift_y

    shifted = np.roll(image_bgr, -best_offset, axis=1).copy()
    left_region = shifted[:, :blend_width, :].astype(np.float32)
    right_region = np.roll(shifted[:, -blend_width:, :], shift=best_shift_y, axis=0).astype(np.float32)
    seam_target = 0.5 * left_region + 0.5 * right_region

    left_alpha = np.linspace(1.0, 0.0, blend_width, dtype=np.float32).reshape(1, blend_width, 1)
    right_alpha = np.linspace(0.0, 1.0, blend_width, dtype=np.float32).reshape(1, blend_width, 1)
    shifted[:, :blend_width, :] = np.clip(
        seam_target * left_alpha + left_region * (1.0 - left_alpha),
        0,
        255,
    ).astype(np.uint8)
    shifted[:, -blend_width:, :] = np.clip(
        seam_target * right_alpha + shifted[:, -blend_width:, :].astype(np.float32) * (1.0 - right_alpha),
        0,
        255,
    ).astype(np.uint8)

    final_left = shifted[:, :sample_width, :]
    final_right = shifted[:, -sample_width:, :]
    _, seam_quality_score = _estimate_edge_alignment(final_left, final_right)

    return shifted, {
        "seam_cut_x_px": int(best_offset),
        "seam_vertical_offset_px": int(best_shift_y),
        "seam_blend_width_px": int(blend_width),
        "seam_quality_score": round(float(seam_quality_score), 4),
    }


def classify_panorama_output(
    image: Image.Image | np.ndarray,
    *,
    fill_ratio: float | None = None,
    black_ratio: float | None = None,
    seam_quality_score: float | None = None,
    normalization_method: str | None = None,
    monotonicity_score: float | None = None,
    bad_shift_ratio: float | None = None,
    accepted_pair_count: int | None = None,
    rejected_pair_count: int | None = None,
    final_frame_count_used: int | None = None,
    quality_score_mean: float | None = None,
) -> str:
    """Prefer panorama_360 once a valid 2:1 immersive canvas exists."""
    if isinstance(image, Image.Image):
        width, height = image.size
        if cv2 is None:  # pragma: no cover - dependency is checked earlier
            image_bgr = np.array(image.convert("RGB"))[:, :, ::-1].copy()
        else:
            image_bgr = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    else:
        height, width = image.shape[:2]
        image_bgr = image

    if height <= 0 or width <= 0:
        return "panorama_flat"

    aspect_ratio = width / max(height, 1)
    aspect_error = abs(aspect_ratio - PANORAMA_TARGET_ASPECT_RATIO)
    if fill_ratio is None:
        fill_ratio = _compute_fill_ratio(image_bgr)
    if black_ratio is None:
        black_ratio = _compute_black_ratio(image_bgr)
    if seam_quality_score is None:
        seam_quality_score = 0.0
    if monotonicity_score is None:
        monotonicity_score = 0.0
    if bad_shift_ratio is None:
        bad_shift_ratio = 1.0
    if accepted_pair_count is None:
        accepted_pair_count = 0
    if rejected_pair_count is None:
        rejected_pair_count = 0
    if final_frame_count_used is None:
        final_frame_count_used = 0
    if quality_score_mean is None:
        quality_score_mean = 0.0

    severe_failure = (
        width < height
        or fill_ratio < 0.45
        or black_ratio > 0.35
    )
    if severe_failure:
        return "panorama_flat"

    if not normalization_method:
        return "panorama_flat"

    if (
        aspect_error <= 0.12
        and fill_ratio >= PANORAMA_360_FORCE_MIN_FILL_RATIO
        and black_ratio <= PANORAMA_360_MAX_BLACK_RATIO * 2.2
        and monotonicity_score >= PANORAMA_MIN_MONOTONICITY_AFTER_CLEANUP
        and bad_shift_ratio <= PANORAMA_MAX_BAD_SHIFT_RATIO_AFTER_CLEANUP
        and accepted_pair_count >= max(4, PANORAMA_MIN_STITCH_FRAMES - 1)
        and final_frame_count_used >= PANORAMA_MIN_STITCH_FRAMES
        and seam_quality_score >= 0.22
        and quality_score_mean >= 42.0
    ):
        return "panorama_360"

    if (
        aspect_error <= 0.08
        and fill_ratio >= 0.78
        and black_ratio <= PANORAMA_360_MAX_BLACK_RATIO * 1.8
        and monotonicity_score >= PANORAMA_MIN_MONOTONICITY_AFTER_CLEANUP * 0.94
        and bad_shift_ratio <= PANORAMA_MAX_BAD_SHIFT_RATIO_AFTER_CLEANUP * 1.1
        and accepted_pair_count >= max(5, PANORAMA_MIN_STITCH_FRAMES)
        and rejected_pair_count <= 2
        and seam_quality_score >= 0.18
    ):
        return "panorama_360"

    return "panorama_flat"


def _create_stitcher():
    """Create an OpenCV panorama stitcher for optional fallback use."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        raise RuntimeError("OpenCV is not available for fallback stitching.")
    stitcher = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)
    if hasattr(stitcher, "setPanoConfidenceThresh"):
        stitcher.setPanoConfidenceThresh(PANORAMA_CONFIDENCE_THRESHOLD)
    return stitcher


def _stitch_with_opencv(selected_frame_paths: list[Path]) -> tuple[np.ndarray, dict]:
    """Optional fallback path using OpenCV Stitcher."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        raise RuntimeError("OpenCV is not available for fallback stitching.")

    attempts: list[list[Path]] = [selected_frame_paths]
    fallback_target = min(
        PANORAMA_FALLBACK_MAX_FRAMES,
        max(PANORAMA_MIN_STITCH_FRAMES, len(selected_frame_paths) // 2),
    )
    fallback_paths = [
        selected_frame_paths[idx]
        for idx in _evenly_spaced_indices(len(selected_frame_paths), fallback_target)
    ]
    if PANORAMA_MIN_STITCH_FRAMES <= len(fallback_paths) < len(selected_frame_paths):
        attempts.append(fallback_paths)

    errors: list[str] = []
    for attempt_number, frame_paths in enumerate(attempts, start=1):
        images: list[np.ndarray] = []
        for frame_path in frame_paths:
            image = cv2.imread(str(frame_path))
            if image is None:
                raise RuntimeError(f"Failed to read selected frame '{frame_path.name}' for fallback stitching.")
            images.append(image)

        stitcher = _create_stitcher()
        status, panorama_bgr = stitcher.stitch(images)
        if status == cv2.Stitcher_OK and panorama_bgr is not None:
            return crop_black_borders(panorama_bgr), {
                "composition_method": "opencv_stitcher_fallback",
                "attempt_number": attempt_number,
                "fallback_used": True,
                "used_frame_count": len(frame_paths),
            }

        errors.append(f"attempt {attempt_number}: status={status}")
        print(f"OpenCV Stitcher fallback attempt {attempt_number} failed with status {status}.")

    raise RuntimeError(
        "OpenCV Stitcher fallback failed. "
        + ("; ".join(errors) if errors else "No additional stitch diagnostics available.")
    )


def _save_panorama_outputs(
    panorama_bgr: np.ndarray,
    output_dir: Path,
    meta: dict,
) -> dict:
    """Save full, web, and preview panorama outputs and return metadata."""
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        raise RuntimeError("OpenCV is required for panorama output generation.")
    output_dir.mkdir(parents=True, exist_ok=True)

    fill_ratio = float(meta.get("fill_ratio", _compute_fill_ratio(panorama_bgr)))
    black_ratio = float(meta.get("black_ratio", _compute_black_ratio(panorama_bgr)))
    seam_quality_score = float(meta.get("seam_quality_score", 0.0))
    normalization_method = meta.get("normalization_method")
    monotonicity_score = float(
        meta.get("cleaned_monotonicity_score", meta.get("monotonicity_score", 0.0))
    )
    bad_shift_ratio = float(
        meta.get("cleaned_bad_shift_ratio", meta.get("bad_shift_ratio", 1.0))
    )
    quality_stats = meta.get("quality_score_stats", {}) or {}
    quality_score_mean = float(quality_stats.get("mean", 0.0))
    accepted_pair_count = int(meta.get("accepted_pair_count", 0))
    rejected_pair_count = int(meta.get("rejected_pair_count", 0))
    final_frame_count_used = int(meta.get("final_frame_count_used", meta.get("used_frame_count", 0)))

    viewer_type = classify_panorama_output(
        panorama_bgr,
        fill_ratio=fill_ratio,
        black_ratio=black_ratio,
        seam_quality_score=seam_quality_score,
        normalization_method=normalization_method,
        monotonicity_score=monotonicity_score,
        bad_shift_ratio=bad_shift_ratio,
        accepted_pair_count=accepted_pair_count,
        rejected_pair_count=rejected_pair_count,
        final_frame_count_used=final_frame_count_used,
        quality_score_mean=quality_score_mean,
    )
    if viewer_type == "panorama_360":
        classification_reason = "cleaned motion consistency, fill, seam, and frame quality all passed 360 thresholds"
    elif fill_ratio < 0.45 or black_ratio > 0.35:
        classification_reason = "output fill quality was too poor after normalization"
    elif monotonicity_score < PANORAMA_MIN_MONOTONICITY_AFTER_CLEANUP:
        classification_reason = "cleaned sweep monotonicity remained too unstable"
    elif bad_shift_ratio > PANORAMA_MAX_BAD_SHIFT_RATIO_AFTER_CLEANUP:
        classification_reason = "too many adjacent pairs were rejected during motion cleanup"
    else:
        classification_reason = "final 2:1 panorama did not meet the stricter 360 quality gate"

    panorama_rgb = cv2.cvtColor(panorama_bgr, cv2.COLOR_BGR2RGB)
    panorama_image = Image.fromarray(panorama_rgb)
    full_path = output_dir / "panorama_full.jpg"
    panorama_image.save(full_path, format="JPEG", quality=PANORAMA_FULL_QUALITY, optimize=True)

    web_image = panorama_image.copy()
    if web_image.width > PANORAMA_WEB_MAX_WIDTH:
        web_height = max(1, int(round(web_image.height * PANORAMA_WEB_MAX_WIDTH / web_image.width)))
        web_image = web_image.resize((PANORAMA_WEB_MAX_WIDTH, web_height), Image.LANCZOS)
    web_path = output_dir / "panorama_web.jpg"
    web_image.save(web_path, format="JPEG", quality=PANORAMA_WEB_QUALITY, optimize=True)

    preview_image = web_image.copy()
    preview_image.thumbnail((PANORAMA_PREVIEW_MAX_WIDTH, PANORAMA_PREVIEW_MAX_HEIGHT), Image.LANCZOS)
    preview_path = output_dir / "preview.jpg"
    preview_image.save(preview_path, format="JPEG", quality=78, optimize=True)

    return {
        "panorama_path": full_path,
        "panorama_web_path": web_path,
        "preview_path": preview_path,
        "output_resolution": panorama_image.size,
        "stitched_native_resolution": tuple(meta.get("pre_normalization_resolution", panorama_image.size)),
        "viewer_type": viewer_type,
        "fill_ratio": round(fill_ratio, 4),
        "black_ratio": round(black_ratio, 4),
        "aspect_ratio": round(panorama_image.width / max(panorama_image.height, 1), 4),
        "classification_reason": classification_reason,
    }


def stitch_panorama(selected_frame_paths: list[Path], output_dir: Path) -> dict:
    """Build a sweep-aware immersive panorama and normalize it to a 2:1 canvas."""
    ok, error_msg = check_panorama_dependencies()
    if not ok:
        raise RuntimeError(error_msg)
    if len(selected_frame_paths) < PANORAMA_MIN_STITCH_FRAMES:
        raise RuntimeError("Too few selected frames to compose a panorama.")
    if cv2 is None:  # pragma: no cover - dependency is checked earlier
        raise RuntimeError("OpenCV is required for panorama generation.")

    images: list[np.ndarray] = []
    frame_quality_scores: list[float] = []
    for frame_path in selected_frame_paths:
        image = cv2.imread(str(frame_path))
        if image is None:
            raise RuntimeError(f"Failed to read selected frame '{frame_path.name}' for panorama generation.")
        images.append(image)
        blur_score = score_blur(image)
        contrast_score = score_contrast(image)
        exposure = score_exposure(image)
        frame_quality_scores.append(
            score_frame_quality(
                blur_score=blur_score,
                contrast_score=contrast_score,
                exposure_score=exposure["exposure_score"],
                motion_consistency_score=1.0,
            )
        )

    initial_frame_count = len(images)
    raw_sweep_meta = estimate_cumulative_sweep(images)
    print(
        "Sweep diagnostics: "
        f"pair_shifts={raw_sweep_meta['pair_shifts_px']}, "
        f"effective_shifts={raw_sweep_meta['effective_pair_shifts_px']}, "
        f"total_sweep={raw_sweep_meta['total_sweep_px']:.2f}px, "
        f"median_shift={raw_sweep_meta['median_shift_px']:.2f}px, "
        f"monotonicity={raw_sweep_meta['monotonicity_score']:.3f}, "
        f"bad_shift_ratio={raw_sweep_meta['bad_shift_ratio']:.3f}"
    )

    cleaned_images, cleaned_quality_scores, motion_meta = filter_motion_inconsistent_frames(
        images,
        frame_quality_scores,
        raw_sweep_meta,
    )
    if (
        len(cleaned_images) >= PANORAMA_MIN_STITCH_FRAMES
        and int(motion_meta.get("accepted_pair_count", 0)) >= max(1, PANORAMA_MIN_STITCH_FRAMES - 1)
    ):
        images = cleaned_images
        frame_quality_scores = cleaned_quality_scores
        print(
            "Motion cleanup: "
            f"initial_pairs={len(raw_sweep_meta.get('pair_shifts_px', []))}, "
            f"accepted_pairs={motion_meta.get('accepted_pair_count', 0)}, "
            f"rejected_pairs={motion_meta.get('rejected_pair_count', 0)}, "
            f"dominant_direction={motion_meta.get('dominant_direction')}, "
            f"cleaned_monotonicity={motion_meta.get('cleaned_monotonicity_score', 0.0):.3f}"
        )
    else:
        motion_meta = {
            **raw_sweep_meta,
            "accepted_pair_count": 0,
            "rejected_pair_count": len(raw_sweep_meta.get("pair_shifts_px", [])),
            "cleaned_pair_shifts": [],
            "cleaned_cumulative_offsets": [0.0],
            "cleaned_monotonicity_score": 0.0,
            "cleaned_bad_shift_ratio": 1.0,
            "dominant_direction": raw_sweep_meta.get("dominant_direction"),
        }

    if len(images) > PANORAMA_MAX_FRAME_COUNT_STRICT:
        downselected_images, downselected_quality_scores, downselected_meta = downselect_panorama_frames(
            images,
            frame_quality_scores,
            motion_meta,
        )
        if len(downselected_images) >= PANORAMA_MIN_STITCH_FRAMES:
            print(
                f"Downselection: usable={len(images)} -> selected={len(downselected_images)}"
            )
            refreshed_motion_images, refreshed_motion_scores, refreshed_motion_meta = filter_motion_inconsistent_frames(
                downselected_images,
                downselected_quality_scores,
                downselected_meta,
            )
            if (
                len(refreshed_motion_images) >= PANORAMA_MIN_STITCH_FRAMES
                and int(refreshed_motion_meta.get("accepted_pair_count", 0)) >= max(1, PANORAMA_MIN_STITCH_FRAMES - 1)
            ):
                images = refreshed_motion_images
                frame_quality_scores = refreshed_motion_scores
                motion_meta = refreshed_motion_meta

    sweep_meta = estimate_cumulative_sweep(images)
    if motion_meta.get("cleaned_pair_shifts"):
        sweep_meta.update(motion_meta)
    else:
        sweep_meta.setdefault("cleaned_pair_shifts", [])
        sweep_meta.setdefault("cleaned_cumulative_offsets", [0.0])
        sweep_meta.setdefault("cleaned_monotonicity_score", 0.0)
        sweep_meta.setdefault("cleaned_bad_shift_ratio", 1.0)
        sweep_meta.setdefault("accepted_pair_count", 0)
        sweep_meta.setdefault("rejected_pair_count", len(sweep_meta.get("pair_shifts_px", [])))
        sweep_meta.setdefault("pair_acceptance_flags", [])

    quality_score_stats = {
        "min": round(min(frame_quality_scores), 2) if frame_quality_scores else 0.0,
        "mean": round(float(np.mean(frame_quality_scores)), 2) if frame_quality_scores else 0.0,
        "max": round(max(frame_quality_scores), 2) if frame_quality_scores else 0.0,
    }

    primary_error: Exception | None = None
    composition_meta: dict = {
        "composition_method": "cylindrical_strip_sweep",
        "attempt_number": 1,
        "fallback_used": False,
        "used_frame_count": len(images),
        "initial_frame_count": initial_frame_count,
        "final_frame_count_used": len(images),
        "quality_score_stats": quality_score_stats,
    }

    try:
        cylindrical_pano, strip_meta = compose_cylindrical_panorama(
            images,
            sweep_meta,
            frame_quality_scores=frame_quality_scores,
        )
        composition_meta.update(strip_meta)
        if float(strip_meta.get("filled_coverage_ratio", 0.0)) < PANORAMA_STRIP_FALLBACK_FILL_RATIO:
            raise RuntimeError("Strip composition coverage was too low before 360 normalization.")
    except Exception as exc:
        primary_error = exc
        print(f"Primary cylindrical strip composition failed: {exc}")
        cylindrical_pano, fallback_meta = _stitch_with_opencv(selected_frame_paths)
        composition_meta.update(fallback_meta)

    normalized_pano, normalization_meta = normalize_rotational_panorama_to_360(
        cylindrical_pano,
        sweep_meta,
    )
    enhanced_pano, clarity_meta = enhance_panorama_clarity(normalized_pano)
    seam_pano, seam_meta = align_and_blend_panorama_seam(enhanced_pano)

    fill_ratio = _compute_fill_ratio(seam_pano)
    black_ratio = _compute_black_ratio(seam_pano)
    final_meta = {
        **composition_meta,
        **sweep_meta,
        **normalization_meta,
        **clarity_meta,
        **seam_meta,
        "fill_ratio": round(fill_ratio, 4),
        "black_ratio": round(black_ratio, 4),
    }

    print(
        "360 normalization diagnostics: "
        f"pre={normalization_meta['pre_normalization_resolution'][0]}x{normalization_meta['pre_normalization_resolution'][1]}, "
        f"post={normalization_meta['post_normalization_resolution'][0]}x{normalization_meta['post_normalization_resolution'][1]}, "
        f"seam_blend={seam_meta['seam_blend_width_px']}px, "
        f"seam_quality={seam_meta['seam_quality_score']:.3f}, "
        f"fill={fill_ratio:.3f}, black={black_ratio:.3f}"
    )

    outputs = _save_panorama_outputs(seam_pano, output_dir, final_meta)
    outputs.update(final_meta)
    outputs["stitch_success"] = True
    if primary_error is not None:
        outputs["primary_error"] = str(primary_error)
    print(
        f"Final classification: {outputs['viewer_type']} "
        f"({outputs.get('classification_reason', 'no classification reason available')})"
    )
    return outputs
