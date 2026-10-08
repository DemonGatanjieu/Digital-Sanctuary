"""Offline image + Chinese query probe; synthetic fixtures, never the user's library."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"

parser = argparse.ArgumentParser()
parser.add_argument("--model", default="models/embeddinggemma-2")
parser.add_argument("--output", default=".tmp/semantic-smoke/result.json")
parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
args = parser.parse_args()
model_path = Path(args.model).resolve()
manifest = json.loads((model_path / "sanctuary.manifest.json").read_text(encoding="utf-8"))
assert manifest["revision"] == "914f7f89142e33e77833254d9c9b90c3cef7303b"
for entry in manifest["files"]:
    file = (model_path / entry["path"]).resolve()
    assert file.is_relative_to(model_path) and file.stat().st_size == entry["size"]
    with file.open("rb") as stream:
        assert hashlib.file_digest(stream, "sha256").hexdigest() == entry["sha256"], file.name
print(f"Snapshot verified; loading offline {args.device} model", flush=True)

import numpy as np
from PIL import Image, ImageDraw
import torch
import transformers
import sentence_transformers
from sentence_transformers import SentenceTransformer

torch.set_num_threads(min(4, os.cpu_count() or 4))
if args.device == "cuda" and not torch.cuda.is_available():
    raise RuntimeError("CUDA is unavailable; no silent CPU fallback in the GPU probe")
dtype = torch.bfloat16 if args.device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
started = time.perf_counter()
model = SentenceTransformer(str(model_path), device=args.device, local_files_only=True, trust_remote_code=False,
    config_kwargs={"audio_config": None}, model_kwargs={"torch_dtype": dtype},
    processor_kwargs={"backend": "torchvision"})
load_ms = round((time.perf_counter() - started) * 1000)

day = Image.new("RGB", (384, 384), "skyblue")
draw = ImageDraw.Draw(day); draw.ellipse((260, 30, 340, 110), fill="yellow"); draw.rectangle((0, 290, 384, 384), fill="green")
night = Image.new("RGB", (384, 384), "#071126")
draw = ImageDraw.Draw(night); draw.ellipse((255, 30, 335, 110), fill="white"); draw.ellipse((275, 20, 345, 95), fill="#071126")
for x, y in [(30, 40), (130, 80), (210, 150), (40, 190), (180, 30), (325, 230)]: draw.ellipse((x, y, x + 4, y + 4), fill="white")
red = Image.new("RGB", (384, 384), "white")
draw = ImageDraw.Draw(red); draw.rectangle((60, 60, 324, 324), fill="red")
images = [day, night, red]
names = ["blue-sky-and-sun", "night-moon-and-stars", "red-square"]
output = Path(args.output).resolve(); output.parent.mkdir(parents=True, exist_ok=True)
for name, image in zip(names, images): image.save(output.parent / f"{name}.png")

started = time.perf_counter()
image_vectors = model.encode([{"image": image} for image in images], batch_size=1, normalize_embeddings=True, show_progress_bar=False)
image_vectors = image_vectors.astype(np.float32)
image_vectors /= np.linalg.norm(image_vectors, axis=1, keepdims=True)
image_ms = round((time.perf_counter() - started) * 1000)
queries = ["蓝天白云，太阳照着绿色草地", "夜晚，月亮和星星", "白色背景上的红色正方形"]
started = time.perf_counter()
query_vectors = model.encode(queries, prompt_name="SearchQuery", batch_size=1, normalize_embeddings=True, show_progress_bar=False)
query_vectors = query_vectors.astype(np.float32)
query_vectors /= np.linalg.norm(query_vectors, axis=1, keepdims=True)
query_ms = round((time.perf_counter() - started) * 1000)
assert image_vectors.shape == query_vectors.shape == (3, 768)
assert np.isfinite(image_vectors).all() and np.isfinite(query_vectors).all()
assert np.allclose(np.linalg.norm(image_vectors, axis=1), 1, atol=1e-5)
assert np.allclose(np.linalg.norm(query_vectors, axis=1), 1, atol=1e-5)
assert not np.allclose(image_vectors[0], image_vectors[1]), "Image inputs produced the same vector"
scores = query_vectors @ image_vectors.T
assert scores.argmax(axis=1).tolist() == [0, 1, 2], "Synthetic Chinese queries did not retrieve their matching image"
rankings = [{"query": query, "top": names[int(row.argmax())], "scores": [round(float(score), 4) for score in row]}
    for query, row in zip(queries, scores)]
result = {"status": "passed", "offline": True, "remoteCode": False, "device": args.device, "dtype": str(dtype),
    "revision": manifest["revision"], "dimensions": 768, "activeParameters": sum(parameter.numel() for parameter in model.parameters()),
    "versions": {"torch": torch.__version__, "transformers": transformers.__version__, "sentenceTransformers": sentence_transformers.__version__},
    "loadMs": load_ms, "threeImagesMs": image_ms, "threeQueriesMs": query_ms, "rankings": rankings,
    "gpuPeakAllocatedMb": round(torch.cuda.max_memory_allocated() / 1024**2) if args.device == "cuda" else None,
    "limitation": "Synthetic fixtures validate offline inference, not anime retrieval quality or a production search UI."}
output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
