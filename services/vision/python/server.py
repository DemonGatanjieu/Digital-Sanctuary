from __future__ import annotations

import json
import sys
from typing import Any

from technical_profile import compute_technical_profile


PROTOCOL_VERSION = 1


def main() -> None:
    wd_engine = None

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = "unknown"
        try:
            request = json.loads(line)
            validate_request(request)
            request_id = request["id"]
            req_type = request["type"]

            if req_type == "health-check":
                if wd_engine is None:
                    from engine import WdTaggerVisionEngine
                    wd_engine = WdTaggerVisionEngine()
                write_response(
                    {
                        "version": PROTOCOL_VERSION,
                        "id": request_id,
                        "type": "health-check-result",
                        "payload": wd_engine.health(),
                    }
                )
            elif req_type == "classify-image":
                image_path = request["payload"]["imagePath"]
                if wd_engine is None:
                    from engine import WdTaggerVisionEngine
                    wd_engine = WdTaggerVisionEngine()
                assessment = wd_engine.classify(image_path)
                write_response(
                    {
                        "version": PROTOCOL_VERSION,
                        "id": request_id,
                        "type": "classify-image-result",
                        "payload": assessment,
                    }
                )
            elif req_type == "compute-technical-profile":
                image_path = request["payload"]["imagePath"]
                result = compute_technical_profile(image_path)
                write_response(
                    {
                        "version": PROTOCOL_VERSION,
                        "id": request_id,
                        "type": "compute-technical-profile-result",
                        "payload": result,
                    }
                )
            else:
                raise ValueError(f"Unknown vision request type: {req_type}")
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
    req_type = request.get("type")
    if req_type not in ("health-check", "classify-image", "compute-technical-profile"):
        raise ValueError(f"Unsupported vision request type: {req_type}")
    if not isinstance(request.get("id"), str):
        raise ValueError("Vision request id is required")
    payload = request.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("Vision payload is required")
    if req_type != "health-check" and not isinstance(payload.get("imagePath"), str):
        raise ValueError("Vision imagePath is required")


def write_response(response: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
