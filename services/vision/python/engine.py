from __future__ import annotations

import csv
import os
import sys
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np
import onnxruntime
from PIL import Image


MODEL_NAME = os.environ.get("WD_TAGGER_MODEL_ID", "wd-swinv2-tagger-v3").strip() or "wd-swinv2-tagger-v3"
MODEL_SHA256 = os.environ.get(
    "WD_TAGGER_MODEL_SHA256",
    "e6774bff34d43bd49f75a47db4ef217dce701c9847b546523eb85ff6dbba1db1",
).strip().lower()
MIN_OUTPUT_CONFIDENCE = 0.05


class WdTaggerVisionEngine:
    def __init__(self, model_directory: str | Path | None = None) -> None:
        directory = Path(model_directory) if model_directory else default_model_directory()
        model_path = directory / "model.onnx"
        tags_path = directory / "selected_tags.csv"
        if not model_path.is_file() or not tags_path.is_file():
            raise FileNotFoundError(f"WD Tagger model files are missing: {directory}")

        self._tags = load_general_tags(tags_path)
        self._session = create_inference_session(model_path)
        self.execution_provider = self._session.get_providers()[0]
        model_input = self._session.get_inputs()[0]
        _, height, width, channels = model_input.shape
        if height != width or channels != 3 or not isinstance(height, int):
            raise ValueError(f"Unexpected WD Tagger input shape: {model_input.shape}")
        self._target_size = height
        self._input_name = model_input.name
        self._output_name = self._session.get_outputs()[0].name

    def health(self) -> dict[str, Any]:
        return {
            "status": "ready",
            "engine": MODEL_NAME,
            "engineVersion": f"v3/{MODEL_SHA256[:12]}/ort-{onnxruntime.__version__}",
            "executionProvider": self.execution_provider,
        }

    def classify(self, image_path: str) -> dict[str, Any]:
        started_at = perf_counter()
        path = Path(image_path)
        if not path.is_file():
            raise FileNotFoundError(f"Image does not exist: {path}")

        with Image.open(path) as image:
            input_tensor = prepare_image(image, self._target_size)
        probabilities = self._session.run(
            [self._output_name], {self._input_name: input_tensor}
        )[0][0]
        labels = select_general_labels(
            probabilities, self._tags, minimum_confidence=MIN_OUTPUT_CONFIDENCE
        )
        return {
            "status": "complete",
            "engine": MODEL_NAME,
            "engineVersion": f"v3/{MODEL_SHA256[:12]}/ort-{onnxruntime.__version__}",
            "executionProvider": self.execution_provider,
            "labels": labels,
            "elapsedMs": max(1, round((perf_counter() - started_at) * 1000)),
        }


def create_inference_session(model_path: Path) -> onnxruntime.InferenceSession:
    requested = os.environ.get("SANCTUARY_ONNX_PROVIDER", "cpu").strip().lower()
    if requested == "cuda":
        try:
            if hasattr(onnxruntime, "preload_dlls"):
                onnxruntime.preload_dlls(directory="")
            if "CUDAExecutionProvider" not in onnxruntime.get_available_providers():
                raise RuntimeError("CUDAExecutionProvider is unavailable")
            return onnxruntime.InferenceSession(
                str(model_path),
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
            )
        except Exception as error:
            print(
                f"[vision] CUDA initialization failed; falling back to CPU: {error}",
                file=sys.stderr,
                flush=True,
            )
    return onnxruntime.InferenceSession(
        str(model_path), providers=["CPUExecutionProvider"]
    )


def default_model_directory() -> Path:
    configured = os.environ.get("WD_TAGGER_MODEL_DIR")
    if configured:
        return Path(configured)
    project_root = Path(__file__).resolve().parents[3]
    return project_root / "models" / MODEL_NAME


def load_general_tags(tags_path: Path) -> list[tuple[int, str]]:
    tags: list[tuple[int, str]] = []
    with tags_path.open("r", encoding="utf-8", newline="") as stream:
        for index, row in enumerate(csv.DictReader(stream)):
            if row.get("category") == "0":
                tags.append((index, row["name"]))
    if not tags:
        raise ValueError(f"No general tags found in {tags_path}")
    return tags


def prepare_image(image: Image.Image, target_size: int) -> np.ndarray:
    rgba = image.convert("RGBA")
    canvas = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    canvas.alpha_composite(rgba)
    rgb = canvas.convert("RGB")

    max_dimension = max(rgb.size)
    pad_left = (max_dimension - rgb.size[0]) // 2
    pad_top = (max_dimension - rgb.size[1]) // 2
    padded = Image.new("RGB", (max_dimension, max_dimension), (255, 255, 255))
    padded.paste(rgb, (pad_left, pad_top))
    if max_dimension != target_size:
        padded = padded.resize((target_size, target_size), Image.Resampling.BICUBIC)

    rgb_array = np.asarray(padded, dtype=np.float32)
    bgr_array = rgb_array[:, :, ::-1]
    return np.expand_dims(bgr_array, axis=0)


def select_general_labels(
    probabilities: np.ndarray,
    general_tags: list[tuple[int, str]],
    minimum_confidence: float,
) -> dict[str, float]:
    labels: dict[str, float] = {}
    for index, name in general_tags:
        confidence = float(probabilities[index])
        if confidence >= minimum_confidence:
            labels[name] = confidence
    return labels
