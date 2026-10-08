"""Local-only JSON Lines worker. The desktop process owns all file authorization."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import sys
import warnings
import traceback

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")
for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "HF_HUB_DISABLE_PROGRESS_BARS"):
    os.environ[key] = "1"
REVISION = "914f7f89142e33e77833254d9c9b90c3cef7303b"

def emit(value):
    print(json.dumps(value, ensure_ascii=True, allow_nan=False), flush=True)

def normalize(vector):
    vector = vector.astype(np.float32)
    norm = float(np.linalg.norm(vector))
    if vector.shape != (768,) or not np.isfinite(vector).all() or not 0.1 < norm < 10:
        raise ValueError("模型返回了无效向量")
    return (vector / norm).tolist()

try:
    model_path = Path(sys.argv[1]).resolve()
    manifest = json.loads((model_path / "sanctuary.manifest.json").read_text(encoding="utf-8"))
    if manifest["revision"] != REVISION or len(manifest["files"]) != 15:
        raise ValueError("模型版本或文件清单不匹配，请重新准备模型")
    for entry in manifest["files"]:
        file = (model_path / entry["path"]).resolve()
        if not file.is_relative_to(model_path) or file.stat().st_size != entry["size"]:
            raise ValueError("模型文件不完整，请重新准备模型")
        with file.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != entry["sha256"]:
                raise ValueError("模型校验失败，请重新准备模型")
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import torch
        from PIL import Image
        from sentence_transformers import SentenceTransformer
        torch.set_num_threads(min(4, os.cpu_count() or 4))
        Image.MAX_IMAGE_PIXELS = 40_000_000
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        model = SentenceTransformer(str(model_path), device="cpu", local_files_only=True, trust_remote_code=False,
            config_kwargs={"audio_config": None}, model_kwargs={"torch_dtype": torch.float32},
            processor_kwargs={"backend": "torchvision"})
    emit({"ready": True, "revision": REVISION})
    for line in sys.stdin:
        request_id = None
        try:
            if len(line) > 16_384:
                raise ValueError("查询过长")
            request = json.loads(line)
            request_id = request["id"]
            with contextlib.redirect_stdout(sys.stderr):
                if request["kind"] == "image":
                    with Image.open(request["value"]) as original:
                        if original.width * original.height > 40_000_000:
                            raise ValueError("图片超过 4,000 万像素，请缩小副本后分析")
                        image = original.convert("RGB")
                        image.thumbnail((1024, 1024))
                        vector = model.encode([{"image": image}], batch_size=1, normalize_embeddings=True, show_progress_bar=False)[0]
                elif request["kind"] == "query" and isinstance(request["value"], str) and 0 < len(request["value"]) <= 500:
                    vector = model.encode([request["value"]], prompt_name="SearchQuery", batch_size=1, normalize_embeddings=True, show_progress_bar=False)[0]
                else:
                    raise ValueError("无效的找图请求")
            emit({"id": request_id, "vector": normalize(vector)})
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            message = str(error) if isinstance(error, ValueError) else "图片无法分析或模型执行失败，请检查文件后重试"
            emit({"id": request_id, "error": message})
except Exception:
    emit({"error": "本地找图模型启动失败，请检查独立 Python 环境、模型快照和文件校验"})
    sys.exit(1)
