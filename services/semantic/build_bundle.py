"""Freeze server.py into a standalone CPU runtime (build/semantic/sanctuary-semantic).

transformers resolves model, processor and tokenizer classes by name at run time, which PyInstaller
cannot see. The build therefore loads the pinned model once, records every module the real load path
imports, and freezes exactly those as hidden imports.

It then packs the folder as the runtime pack the model center downloads, and prints the size and
SHA-256 that apps/desktop/src/main/model-center/catalog.ts must pin.

Usage: .venv-semantic/Scripts/python.exe services/semantic/build_bundle.py models/embeddinggemma-2
"""
import hashlib
import json
import os
import subprocess
import zipfile
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME_PACK = "sanctuary-semantic-runtime-1.zip"
PACKAGES = ("transformers", "sentence_transformers", "torchvision", "tokenizers", "safetensors", "huggingface_hub")
METADATA = ("transformers", "sentence-transformers", "tokenizers", "safetensors", "huggingface-hub", "torch",
            "torchvision", "numpy", "tqdm", "regex", "pyyaml", "packaging", "filelock", "pillow", "scipy",
            "scikit-learn", "jinja2", "fsspec", "typing-extensions")
# torchvision loads its operator libraries (_C_stable.pyd, image codecs) by path, not by import.
BINARIES = ("torchvision",)
EXCLUDES = ("tkinter", "matplotlib", "IPython", "pytest", "torch.testing._internal.opinfo", "sympy.testing")

PROBE = r"""
import json, os, sys
os.environ["HF_HUB_OFFLINE"] = "1"; os.environ["TRANSFORMERS_OFFLINE"] = "1"
import torch
from PIL import Image
from sentence_transformers import SentenceTransformer
model = SentenceTransformer(sys.argv[1], device="cpu", local_files_only=True, trust_remote_code=False,
    config_kwargs={"audio_config": None}, model_kwargs={"torch_dtype": torch.float32},
    processor_kwargs={"backend": "torchvision"})
model.encode(["probe"], prompt_name="SearchQuery", batch_size=1, normalize_embeddings=True, show_progress_bar=False)
model.encode([{"image": Image.new("RGB", (64, 64), (200, 120, 40))}], batch_size=1, normalize_embeddings=True, show_progress_bar=False)
print(json.dumps(sorted(sys.modules)))
"""


def main() -> None:
    model = Path(sys.argv[1]).resolve()
    probe = subprocess.run([sys.executable, "-I", "-c", PROBE, str(model)], check=True, capture_output=True, text=True)
    loaded = json.loads(probe.stdout.strip().splitlines()[-1])
    hidden = [name for name in loaded if name.split(".")[0] in PACKAGES]
    work = ROOT / ".tmp" / "pyinstaller-semantic"
    args = ["--noconfirm", "--onedir", "--console", "--name", "sanctuary-semantic",
            "--distpath", str(ROOT / "build" / "semantic"), "--workpath", str(work), "--specpath", str(work)]
    for name in hidden:
        args += ["--hidden-import", name]
    for name in METADATA:
        args += ["--copy-metadata", name]
    for name in BINARIES:
        args += ["--collect-binaries", name]
        package = Path(__import__(name).__file__).parent
        for library in package.glob("*.pyd"):
            args += ["--add-binary", f"{library}{os.pathsep}{name}"]
    for name in EXCLUDES:
        args += ["--exclude-module", name]
    args.append(str(ROOT / "services" / "semantic" / "server.py"))
    print(f"freezing with {len(hidden)} recorded modules", flush=True)
    import PyInstaller.__main__
    PyInstaller.__main__.run(args)
    pack(ROOT / "build" / "semantic")


def pack(dist: Path) -> None:
    """Plain ZIP32 with sorted entries and fixed timestamps, which the app's extractor accepts."""
    folder = dist / "sanctuary-semantic"
    archive = dist / RUNTIME_PACK
    files = sorted(path for path in folder.rglob("*") if path.is_file())
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=False) as bundle:
        for path in files:
            info = zipfile.ZipInfo(path.relative_to(dist).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with path.open("rb") as source, bundle.open(info, "w") as target:
                while chunk := source.read(1 << 20):
                    target.write(chunk)
    digest = hashlib.sha256()
    with archive.open("rb") as stream:
        while chunk := stream.read(1 << 20):
            digest.update(chunk)
    print(json.dumps({"pack": str(archive), "files": len(files), "size": archive.stat().st_size, "sha256": digest.hexdigest()}))


if __name__ == "__main__":
    if sys.argv[1:] == ["--pack-only"]:
        pack(ROOT / "build" / "semantic")
    else:
        main()
