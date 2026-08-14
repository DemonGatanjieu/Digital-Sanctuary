from __future__ import annotations

import math
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np
from PIL import Image, ImageOps


TECHNICAL_PROFILE_VERSION = "0.1.0"


def compute_technical_profile(image_path: str) -> dict[str, Any]:
    started_at = perf_counter()
    path = Path(image_path)
    if not path.is_file():
        return {
            "status": "error",
            "suiteId": "technical_visual_v1",
            "suiteVersion": 1,
            "evaluatorVersion": TECHNICAL_PROFILE_VERSION,
            "dimensions": [],
            "reasonCode": "file_missing",
            "error": f"Image file not found: {path}",
            "elapsedMs": max(1, round((perf_counter() - started_at) * 1000)),
        }

    try:
        with Image.open(path) as raw_image:
            # Handle EXIF orientation
            image = ImageOps.exif_transpose(raw_image)
            # For multi-frame GIF/WebP, seek to frame 0
            if getattr(image, "is_animated", False):
                image.seek(0)

            # Convert to standard RGB
            rgb_image = image.convert("RGB")
            # Downsample large images for deterministic fast statistic calculations (max long edge 1024)
            width, height = rgb_image.size
            max_edge = max(width, height)
            if max_edge > 1024:
                scale = 1024 / max_edge
                rgb_image = rgb_image.resize(
                    (max(1, int(width * scale)), max(1, int(height * scale))),
                    Image.Resampling.BILINEAR,
                )

            rgb_array = np.asarray(rgb_image, dtype=np.float32)

        dimensions = calculate_technical_dimensions(rgb_array)

        return {
            "status": "success",
            "suiteId": "technical_visual_v1",
            "suiteVersion": 1,
            "evaluatorVersion": TECHNICAL_PROFILE_VERSION,
            "dimensions": dimensions,
            "elapsedMs": max(1, round((perf_counter() - started_at) * 1000)),
        }
    except Exception as error:
        return {
            "status": "error",
            "suiteId": "technical_visual_v1",
            "suiteVersion": 1,
            "evaluatorVersion": TECHNICAL_PROFILE_VERSION,
            "dimensions": [],
            "reasonCode": "file_corrupted",
            "error": str(error),
            "elapsedMs": max(1, round((perf_counter() - started_at) * 1000)),
        }


def calculate_technical_dimensions(rgb: np.ndarray) -> list[dict[str, Any]]:
    r = rgb[:, :, 0]
    g = rgb[:, :, 1]
    b = rgb[:, :, 2]

    # Luminance (ITU-R BT.601)
    lum = 0.299 * r + 0.587 * g + 0.114 * b

    # 1. Colorfulness (Hasler & Süsstrunk metric)
    rg = np.abs(r - g)
    yb = np.abs(0.5 * (r + g) - b)
    std_rg = float(np.std(rg))
    std_yb = float(np.std(yb))
    mean_rg = float(np.mean(rg))
    mean_yb = float(np.mean(yb))
    std_root = math.sqrt(std_rg**2 + std_yb**2)
    mean_root = math.sqrt(mean_rg**2 + mean_yb**2)
    raw_colorfulness = (std_root + 0.3 * mean_root) * 0.7
    score_colorfulness = clamp(raw_colorfulness, 0.0, 100.0)

    # 2. Tonal Range (Dynamic range between 99th and 1st percentile)
    p1, p99 = np.percentile(lum, [1.0, 99.0])
    raw_tonal = (p99 - p1) / 2.55
    score_tonal = clamp(raw_tonal, 0.0, 100.0)

    # 3. Luminance Balance (Balance around midtones, penalizing extreme over/underexposure)
    mean_lum = float(np.mean(lum))
    midpoint_diff = abs(mean_lum - 128.0) / 128.0
    # Standard deviation factor (avoid completely flat image having high balance)
    lum_std = float(np.std(lum))
    std_factor = min(1.0, lum_std / 30.0)
    score_balance = clamp((1.0 - midpoint_diff) * 100.0 * (0.3 + 0.7 * std_factor), 0.0, 100.0)

    # 4. Edge Density (Sobel gradient magnitude)
    gx = np.zeros_like(lum)
    gy = np.zeros_like(lum)
    gx[:, 1:-1] = (lum[:, 2:] - lum[:, :-2]) * 0.5
    gy[1:-1, :] = (lum[2:, :] - lum[:-2, :]) * 0.5
    grad_mag = np.sqrt(gx**2 + gy**2)
    edge_ratio = float(np.mean(grad_mag > 12.0))
    score_edge_density = clamp(edge_ratio * 300.0, 0.0, 100.0)

    # 5. Sharpness Proxy (Laplacian high frequency variance)
    laplacian = np.zeros_like(lum)
    laplacian[1:-1, 1:-1] = (
        lum[:-2, 1:-1]
        + lum[2:, 1:-1]
        + lum[1:-1, :-2]
        + lum[1:-1, 2:]
        - 4.0 * lum[1:-1, 1:-1]
    )
    lap_var = float(np.var(laplacian))
    # Log scale mapping: log10(1 + var) / log10(1 + 8000) * 100
    score_sharpness = clamp(
        (math.log10(1.0 + lap_var) / math.log10(1.0 + 5000.0)) * 100.0, 0.0, 100.0
    )

    # 6. Spatial Balance (Energy symmetry across four quadrants)
    h, w = lum.shape
    mid_h, mid_w = h // 2, w // 2
    if mid_h > 0 and mid_w > 0:
        q_tl = float(np.mean(lum[:mid_h, :mid_w]))
        q_tr = float(np.mean(lum[:mid_h, mid_w:]))
        q_bl = float(np.mean(lum[mid_h:, :mid_w]))
        q_br = float(np.mean(lum[mid_h:, mid_w:]))
        quad_values = [q_tl, q_tr, q_bl, q_br]
        quad_std = float(np.std(quad_values))
        score_spatial = clamp((1.0 - (quad_std / 80.0)) * 100.0, 0.0, 100.0)
    else:
        score_spatial = 50.0

    return [
        {
            "key": "colorfulness",
            "label": "色彩丰富度",
            "score": round(score_colorfulness, 2),
        },
        {
            "key": "tonal_range",
            "label": "明暗跨度",
            "score": round(score_tonal, 2),
        },
        {
            "key": "luminance_balance",
            "label": "亮度均衡度",
            "score": round(score_balance, 2),
        },
        {
            "key": "edge_density",
            "label": "边缘密度",
            "score": round(score_edge_density, 2),
        },
        {
            "key": "sharpness_proxy",
            "label": "清晰度代理值",
            "score": round(score_sharpness, 2),
        },
        {
            "key": "spatial_balance",
            "label": "空间分布平衡",
            "score": round(score_spatial, 2),
        },
    ]


def clamp(val: float, minimum: float, maximum: float) -> float:
    if math.isnan(val) or math.isinf(val):
        return 0.0
    return max(minimum, min(maximum, val))
