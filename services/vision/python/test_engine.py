from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from engine import (
    MODEL_NAME,
    WdTaggerVisionEngine,
    default_model_directory,
    prepare_image,
    select_general_labels,
)


class WdTaggerPreprocessingTests(unittest.TestCase):
    def test_prepares_nhwc_bgr_tensor(self) -> None:
        image = Image.new("RGB", (20, 10), color=(10, 20, 30))
        tensor = prepare_image(image, 32)
        self.assertEqual(tensor.shape, (1, 32, 32, 3))
        self.assertEqual(tensor.dtype, np.float32)

    def test_returns_general_tags_only_above_floor(self) -> None:
        probabilities = np.asarray([0.01, 0.92, 0.34], dtype=np.float32)
        labels = select_general_labels(
            probabilities,
            [(0, "rating_general"), (1, "guro"), (2, "blood")],
            minimum_confidence=0.35,
        )
        self.assertEqual(list(labels), ["guro"])


@unittest.skipUnless(
    (default_model_directory() / "model.onnx").is_file(), "WD Tagger model is not installed"
)
class WdTaggerRuntimeTests(unittest.TestCase):
    def test_model_runs_on_a_plain_rgb_image(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "plain.png"
            Image.new("RGB", (64, 64), color=(24, 28, 40)).save(image_path)
            result = WdTaggerVisionEngine().classify(str(image_path))

        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["engine"], MODEL_NAME)
        self.assertIn(
            result["executionProvider"],
            ["CPUExecutionProvider", "CUDAExecutionProvider"],
        )
        self.assertNotIn("explicit", result["labels"])


if __name__ == "__main__":
    unittest.main()
