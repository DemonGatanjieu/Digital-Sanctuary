from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import median
from time import perf_counter

import numpy as np
import onnxruntime

from engine import default_model_directory


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def run_benchmark(
    session: onnxruntime.InferenceSession,
    input_tensor: np.ndarray,
    warmups: int,
    runs: int,
) -> tuple[np.ndarray, dict[str, float]]:
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    for _ in range(warmups):
        session.run([output_name], {input_name: input_tensor})

    elapsed: list[float] = []
    output: np.ndarray | None = None
    for _ in range(runs):
        started = perf_counter()
        output = session.run([output_name], {input_name: input_tensor})[0]
        elapsed.append((perf_counter() - started) * 1000)
    assert output is not None
    return output, {
        "minimumMs": round(min(elapsed), 2),
        "medianMs": round(median(elapsed), 2),
        "p95Ms": round(percentile(elapsed, 0.95), 2),
        "maximumMs": round(max(elapsed), 2),
    }


def create_input(model_path: Path) -> np.ndarray:
    inspection = onnxruntime.InferenceSession(
        str(model_path), providers=["CPUExecutionProvider"]
    )
    _, height, width, channels = inspection.get_inputs()[0].shape
    if not all(isinstance(value, int) for value in (height, width, channels)):
        raise ValueError("Model input shape must be static")
    generator = np.random.default_rng(20260811)
    return generator.uniform(0, 255, (1, height, width, channels)).astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--warmups", type=int, default=2)
    arguments = parser.parse_args()
    if arguments.runs < 1 or arguments.warmups < 0:
        raise ValueError("runs must be positive and warmups cannot be negative")

    if hasattr(onnxruntime, "preload_dlls"):
        onnxruntime.preload_dlls(directory="")
    model_path = default_model_directory() / "model.onnx"
    input_tensor = create_input(model_path)

    cpu_session = onnxruntime.InferenceSession(
        str(model_path), providers=["CPUExecutionProvider"]
    )
    cpu_output, cpu_metrics = run_benchmark(
        cpu_session, input_tensor, arguments.warmups, arguments.runs
    )

    available = onnxruntime.get_available_providers()
    if "CUDAExecutionProvider" not in available:
        raise RuntimeError(f"CUDAExecutionProvider is unavailable: {available}")
    cuda_session = onnxruntime.InferenceSession(
        str(model_path), providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    cuda_output, cuda_metrics = run_benchmark(
        cuda_session, input_tensor, arguments.warmups, arguments.runs
    )

    absolute_delta = np.abs(cpu_output.astype(np.float64) - cuda_output.astype(np.float64))
    result = {
        "onnxruntimeVersion": onnxruntime.__version__,
        "availableProviders": available,
        "cpuSessionProviders": cpu_session.get_providers(),
        "cudaSessionProviders": cuda_session.get_providers(),
        "runs": arguments.runs,
        "warmups": arguments.warmups,
        "cpu": cpu_metrics,
        "cuda": cuda_metrics,
        "speedupByMedian": round(cpu_metrics["medianMs"] / cuda_metrics["medianMs"], 2),
        "maximumAbsoluteOutputDelta": float(absolute_delta.max()),
        "meanAbsoluteOutputDelta": float(absolute_delta.mean()),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
