"""
config.py - Central tunable constants for the TourGuide AI backend.

The active MVP path is panorama-first:
video -> extracted frames -> selected frames -> stitched panorama.
Legacy reconstruction constants are kept only for compatibility with older code.
"""

# ---------------------------------------------------------------------------
# Panorama frame extraction and selection
# ---------------------------------------------------------------------------

FFMPEG_FPS: int = 3
"""Frames per second to extract from uploaded room video."""

BLUR_THRESHOLD: float = 85.0
"""Laplacian variance below this value means the frame is too blurry."""

SIMILARITY_MAD_THRESHOLD: float = 10.0
"""Mean absolute thumbnail difference below this value counts as redundant."""

EXPOSURE_MEAN_MIN: float = 35.0
"""Reject frames darker than this average grayscale value."""

EXPOSURE_MEAN_MAX: float = 220.0
"""Reject frames brighter than this average grayscale value."""

EXPOSURE_STD_MIN: float = 18.0
"""Reject very flat frames with too little tonal variation."""

PANORAMA_MIN_SELECTED_FRAMES: int = 8
"""Preferred lower bound for final panorama frame selection."""

PANORAMA_MAX_SELECTED_FRAMES: int = 20
"""Preferred upper bound for final panorama frame selection."""

PANORAMA_MIN_STITCH_FRAMES: int = 4
"""Hard minimum usable frames required to attempt panorama stitching."""

PANORAMA_STITCH_LONG_SIDE: int = 1600
"""Resize selected frames to this long side before stitching."""

PANORAMA_FALLBACK_MAX_FRAMES: int = 12
"""Fallback stitch retry uses at most this many evenly sampled frames."""

# ---------------------------------------------------------------------------
# Panorama output generation
# ---------------------------------------------------------------------------

PANORAMA_UPLOAD_FULL_MAX_WIDTH: int = 8192
"""Maximum width preserved for direct uploaded panorama masters."""

PANORAMA_UPLOAD_MIN_WIDTH: int = 2000
"""Minimum width for a direct upload to qualify as a solid 360 panorama."""

PANORAMA_UPLOAD_360_ASPECT_TOLERANCE: float = 0.12
"""Allowed absolute deviation from 2:1 for direct panorama uploads."""

PANORAMA_PARTIAL_MIN_WIDTH: int = 1400
"""Minimum width for a non-360 panorama to still be immersive enough for bounded drag viewing."""

PANORAMA_PARTIAL_MIN_ASPECT_RATIO: float = 1.15
"""Minimum aspect ratio for a direct upload to qualify as a partial immersive panorama."""

PANORAMA_PARTIAL_MIN_HORIZONTAL_FOV_DEG: float = 140.0
"""Minimum estimated horizontal field of view required for partial immersive panorama mode."""

PANORAMA_PARTIAL_DEFAULT_HFOV_DEG: float = 60.0
"""Recommended starting horizontal field of view for bounded partial panoramas."""

PANORAMA_PARTIAL_MAX_HFOV_DEG: float = 72.0
"""Maximum horizontal field of view allowed before padding risks becoming visible."""

PANORAMA_PARTIAL_SAFE_YAW_MARGIN_DEG: float = 8.0
"""Extra yaw guard band inside the captured sweep so users cannot see the cut seam."""

PANORAMA_PARTIAL_SAFE_PITCH_MARGIN_DEG: float = 6.0
"""Extra pitch guard band to keep the viewer away from distorted vertical extremes."""

PANORAMA_PARTIAL_EDGE_FILL_BAND_RATIO: float = 0.035
"""Width ratio of the edge band sampled when filling partial-panorama side padding."""

PANORAMA_PARTIAL_EDGE_FILL_BLUR_RADIUS: float = 28.0
"""Blur radius used when extending partial-panorama side padding away from the captured image."""


PANORAMA_FULL_QUALITY: int = 95
"""JPEG quality for the full panorama output."""

PANORAMA_WEB_QUALITY: int = 84
"""JPEG quality for the web-optimized panorama output."""

PANORAMA_WEB_MAX_WIDTH: int = 4096
"""Maximum width for the web panorama served to the frontend viewer."""

PANORAMA_PREVIEW_MAX_WIDTH: int = 1200
"""Maximum width for the preview thumbnail."""

PANORAMA_PREVIEW_MAX_HEIGHT: int = 675
"""Maximum height for the preview thumbnail."""

PANORAMA_CONFIDENCE_THRESHOLD: float = 0.55
"""OpenCV stitcher pano confidence threshold when supported."""

# ---------------------------------------------------------------------------
# Panorama 360 classification thresholds
# ---------------------------------------------------------------------------

PANORAMA_360_ASPECT_MIN: float = 1.85
"""Minimum width-to-height ratio to qualify as a sphere-ready 360 panorama."""

PANORAMA_360_ASPECT_MAX: float = 2.15
"""Maximum width-to-height ratio to qualify as a sphere-ready 360 panorama."""

PANORAMA_360_MIN_WIDTH: int = 2500
"""Minimum pixel width to qualify as a sphere-ready 360 panorama."""

PANORAMA_360_MAX_BLACK_RATIO: float = 0.08
"""Maximum fraction of near-black pixels allowed in a sphere-ready panorama."""

PANORAMA_360_MIN_FILL_RATIO: float = 0.85
"""Minimum filled-pixel coverage ratio required for a sphere-ready panorama."""

PANORAMA_360_FORCE_MIN_FILL_RATIO: float = 0.70
"""Pragmatic minimum fill ratio for accepting a generated 2:1 360 canvas."""

PANORAMA_360_MIN_SPAN_RATIO: float = 1.10
"""Minimum horizontal span relative to source frame width for 360 classification."""

PANORAMA_TARGET_HEIGHT: int = 1600
"""Preferred final panorama height before web/preview derivative generation."""

PANORAMA_TARGET_ASPECT_RATIO: float = 2.0
"""Final immersive panorama canvas aspect ratio."""

PANORAMA_STRIP_WIDTH_RATIO: float = 0.18
"""Relative width of the central strip extracted from each frame."""

PANORAMA_STRIP_MIN_WIDTH: int = 40
"""Hard minimum width in pixels for each extracted center strip."""

PANORAMA_STRIP_MIN_SHIFT_PX: int = 10
"""Minimum practical horizontal shift between adjacent usable frames."""

PANORAMA_STRIP_MAX_SHIFT_RATIO: float = 1.0
"""Maximum effective shift as a multiple of strip width."""

PANORAMA_STRIP_BLEND_EDGE_RATIO: float = 0.20
"""Fraction of strip width used for feather blending at both edges."""

PANORAMA_STRIP_FALLBACK_FILL_RATIO: float = 0.30
"""Fallback to OpenCV Stitcher when strip composition coverage falls below this."""

PANORAMA_SEAM_BLEND_RATIO: float = 0.06
"""Width of the wrap seam blend region as a fraction of final panorama width."""

PANORAMA_EDGE_SAMPLE_WIDTH_RATIO: float = 0.04
"""Width of left/right edge bands used when choosing and aligning the wrap seam."""

PANORAMA_MIN_MONOTONICITY_SCORE: float = 0.55
"""Minimum sweep-direction consistency expected from a usable rotational capture."""

PANORAMA_PARTIAL_SWEEP_STRETCH_ENABLED: bool = True
"""Stretch partial sweeps across the 360 canvas instead of dropping to flat early."""

PANORAMA_VERTICAL_TRIM_RATIO: float = 0.06
"""Trim this much from top and bottom before vertical re-normalization."""

PANORAMA_MAX_ALLOWED_BAD_SHIFT_RATIO: float = 0.45
"""Maximum per-pair horizontal shift as a fraction of frame width before correction."""

PANORAMA_MIN_BLUR_SCORE: float = 135.0
"""Minimum blur score for a frame to remain in the preferred panorama candidate pool."""

PANORAMA_MIN_CONTRAST_SCORE: float = 24.0
"""Minimum local contrast score for a frame to remain in the preferred panorama candidate pool."""

PANORAMA_MAX_EXPOSURE_CLIP_RATIO: float = 0.22
"""Maximum fraction of very dark or very bright pixels allowed in a good frame."""

PANORAMA_MAX_FRAME_COUNT_STRICT: int = 10
"""Target maximum frame count when motion quality is mixed and ghosting risk is high."""

PANORAMA_MAX_FRAME_COUNT_RELAXED: int = 14
"""Target maximum frame count when motion quality is strong and consistent."""

PANORAMA_MIN_PAIR_CONFIDENCE: float = 0.10
"""Minimum adjacent-pair confidence for a shift estimate to be trusted directly."""

PANORAMA_MAX_SHIFT_DEVIATION_RATIO: float = 0.35
"""Maximum allowed deviation from the cleaned median shift before a pair is rejected."""

PANORAMA_MIN_MONOTONICITY_AFTER_CLEANUP: float = 0.82
"""Minimum motion consistency score expected after rejecting bad pair alignments."""

PANORAMA_MAX_BAD_SHIFT_RATIO_AFTER_CLEANUP: float = 0.20
"""Maximum tolerated rejected-pair ratio for a confident 360 panorama classification."""

PANORAMA_STRIP_WIDTH_RATIO_NARROW: float = 0.12
"""Narrower strip width used for cleaner foreground-safe panorama composition."""

PANORAMA_ALIGNMENT_BAND_TOP_RATIO: float = 0.20
"""Top crop ratio for the vertical band used during alignment estimation."""

PANORAMA_ALIGNMENT_BAND_BOTTOM_RATIO: float = 0.78
"""Bottom crop ratio for the vertical band used during alignment estimation."""

PANORAMA_FOREGROUND_DOWNWEIGHT_BOTTOM_RATIO: float = 0.72
"""Rows below this ratio are downweighted to reduce bed/chair foreground ghosting."""

PANORAMA_SHARPEN_AMOUNT: float = 0.18
"""Mild unsharp-mask strength applied to the final panorama."""

PANORAMA_LOCAL_CONTRAST_AMOUNT: float = 0.14
"""Mild local contrast enhancement applied before final panorama export."""

# ---------------------------------------------------------------------------
# Legacy reconstruction settings kept for compatibility
# ---------------------------------------------------------------------------

MIN_SHARP_FRAMES: int = PANORAMA_MIN_STITCH_FRAMES
TARGET_FRAME_MIN: int = PANORAMA_MIN_SELECTED_FRAMES
TARGET_FRAME_MAX: int = PANORAMA_MAX_SELECTED_FRAMES
RECONSTRUCTION_LONG_SIDE: int = PANORAMA_STITCH_LONG_SIDE

SPLATFACTO_ITERATIONS: int = 6000
SPLATFACTO_MAX_ITERATIONS: int = 15000

QUALITY_EXCELLENT_RATIO: float = 0.90
QUALITY_EXCELLENT_POINTS: int = 5_000
QUALITY_USABLE_RATIO: float = 0.70
QUALITY_USABLE_POINTS: int = 1_000
