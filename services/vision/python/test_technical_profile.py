from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from technical_profile import compute_technical_profile, TECHNICAL_PROFILE_VERSION


class TechnicalProfileTests(unittest.TestCase):
    def test_computes_deterministic_metrics_for_solid_white(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "white.png"
            Image.new("RGB", (64, 64), color=(255, 255, 255)).save(image_path)

            result = compute_technical_profile(str(image_path))
            self.assertEqual(result["status"], "success")
            self.assertEqual(result["suiteId"], "technical_visual_v1")
            self.assertEqual(result["suiteVersion"], 1)
            self.assertEqual(result["evaluatorVersion"], TECHNICAL_PROFILE_VERSION)

            dim_map = {d["key"]: d["score"] for d in result["dimensions"]}
            self.assertEqual(len(dim_map), 6)
            self.assertEqual(dim_map["colorfulness"], 0.0)
            self.assertEqual(dim_map["edge_density"], 0.0)
            self.assertEqual(dim_map["sharpness_proxy"], 0.0)
            for key, score in dim_map.items():
                self.assertTrue(0.0 <= score <= 100.0, f"Score for {key} out of bounds: {score}")

    def test_computes_high_contrast_for_checkerboard(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "checker.png"
            # 64x64 checkerboard
            arr = np.zeros((64, 64, 3), dtype=np.uint8)
            for y in range(64):
                for x in range(64):
                    if ((x // 8) + (y // 8)) % 2 == 0:
                        arr[y, x] = [255, 255, 255]
            Image.fromarray(arr).save(image_path)

            result = compute_technical_profile(str(image_path))
            self.assertEqual(result["status"], "success")
            dim_map = {d["key"]: d["score"] for d in result["dimensions"]}
            self.assertGreater(dim_map["edge_density"], 30.0)
            self.assertGreater(dim_map["sharpness_proxy"], 40.0)
            self.assertGreater(dim_map["tonal_range"], 90.0)

    def test_handles_corrupted_and_missing_images_gracefully(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            corrupt_path = Path(temp_dir) / "corrupt.png"
            corrupt_path.write_bytes(b"INVALID_IMAGE_PAYLOAD_BYTES")

            res_corrupt = compute_technical_profile(str(corrupt_path))
            self.assertEqual(res_corrupt["status"], "error")
            self.assertEqual(res_corrupt["reasonCode"], "file_corrupted")

            missing_path = Path(temp_dir) / "does_not_exist.png"
            res_missing = compute_technical_profile(str(missing_path))
            self.assertEqual(res_missing["status"], "error")
            self.assertEqual(res_missing["reasonCode"], "file_missing")

    def test_repeated_runs_yield_identical_scores(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "gradient.png"
            arr = np.zeros((64, 64, 3), dtype=np.uint8)
            for y in range(64):
                for x in range(64):
                    arr[y, x] = [x * 4, y * 4, 255 - x * 4]
            Image.fromarray(arr).save(image_path)

            run1 = compute_technical_profile(str(image_path))
            run2 = compute_technical_profile(str(image_path))

            self.assertEqual(run1["dimensions"], run2["dimensions"])


if __name__ == "__main__":
    unittest.main()
