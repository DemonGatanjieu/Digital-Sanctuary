from __future__ import annotations

import json
import sys
from typing import Any

from engine import WdTaggerVisionEngine


PROTOCOL_VERSION = 1


def main() -> None:
    engine = WdTaggerVisionEngine()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = "unknown"
        try:
            request = json.loads(line)
            validate_request(request)
            request_id = request["id"]
            assessment = engine.classify(request["payload"]["imagePath"])
            write_response(
                {
                    "version": PROTOCOL_VERSION,
                    "id": request_id,
                    "type": "classify-image-result",
                    "payload": assessment,
                }
            )
        except Exception as error:
            write_response(
                {
                    "version": PROTOCOL_VERSION,
                    "id": request_id,
                    "type": "error",
                    "payload": {
                        "code": "VISION_REQUEST_FAILED",
                        "message": str(error),
                    },
                }
            )


def validate_request(request: Any) -> None:
    if not isinstance(request, dict):
        raise ValueError("Vision request must be an object")
    if request.get("version") != PROTOCOL_VERSION:
        raise ValueError("Unsupported vision protocol version")
    if request.get("type") != "classify-image":
        raise ValueError("Unsupported vision request type")
    if not isinstance(request.get("id"), str):
        raise ValueError("Vision request id is required")
    payload = request.get("payload")
    if not isinstance(payload, dict) or not isinstance(payload.get("imagePath"), str):
        raise ValueError("Vision imagePath is required")


def write_response(response: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
