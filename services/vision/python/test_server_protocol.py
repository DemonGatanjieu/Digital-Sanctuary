from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from engine import MODEL_NAME, default_model_directory


@unittest.skipUnless(
    (default_model_directory() / "model.onnx").is_file(), "WD Tagger model is not installed"
)
class VisionServerProtocolTests(unittest.TestCase):
    def test_reports_ready_before_serving_classification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "startup-probe.png"
            Image.new("RGB", (1, 1), color=(255, 255, 255)).save(image_path)
            requests = [
                {
                    "version": 1,
                    "id": "health",
                    "type": "health-check",
                    "payload": {},
                },
                {
                    "version": 1,
                    "id": "classify",
                    "type": "classify-image",
                    "payload": {"imagePath": str(image_path)},
                },
            ]
            process = subprocess.Popen(
                [sys.executable, str(Path(__file__).with_name("server.py"))],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
            )
            stdout, stderr = process.communicate(
                "\n".join(json.dumps(request) for request in requests) + "\n",
                timeout=60,
            )

        self.assertEqual(process.returncode, 0, stderr)
        responses = [json.loads(line) for line in stdout.splitlines() if line.strip()]
        self.assertEqual(responses[0]["type"], "health-check-result")
        self.assertEqual(responses[0]["payload"]["status"], "ready")
        self.assertEqual(responses[0]["payload"]["engine"], MODEL_NAME)
        self.assertEqual(responses[1]["type"], "classify-image-result")
        self.assertEqual(responses[1]["payload"]["status"], "complete")


class VisionServerUtf8ProtocolTests(unittest.TestCase):
    def test_technical_profile_labels_round_trip_as_utf8(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "彩色测试.png"
            Image.new("RGB", (8, 8), color=(120, 80, 200)).save(image_path)
            request = {
                "version": 1,
                "id": "technical-utf8",
                "type": "compute-technical-profile",
                "payload": {"imagePath": str(image_path)},
            }
            process = subprocess.Popen(
                [sys.executable, str(Path(__file__).with_name("server.py"))],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="strict",
            )
            stdout, stderr = process.communicate(
                json.dumps(request, ensure_ascii=False) + "\n",
                timeout=30,
            )

        self.assertEqual(process.returncode, 0, stderr)
        response = json.loads(stdout.strip())
        self.assertEqual(response["type"], "compute-technical-profile-result")
        self.assertEqual(
            [dimension["label"] for dimension in response["payload"]["dimensions"]],
            ["色彩丰富度", "明暗跨度", "亮度均衡度", "边缘密度", "清晰度代理值", "空间分布平衡"],
        )


if __name__ == "__main__":
    unittest.main()
