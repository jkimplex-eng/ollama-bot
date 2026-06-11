from __future__ import annotations

import argparse
import base64
import json
import time
from pathlib import Path
from urllib import error, request

from .capture import capture_state
from .config import CaptureConfig


def post_json(url: str, payload: dict, worker_secret: str) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Worker-Secret": worker_secret,
        },
        method="POST",
    )
    with request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def read_artifact_payload(meta: dict) -> dict:
    artifacts = meta.get("artifacts", {})
    screenshot_path = artifacts.get("screenshot", "")
    html_path = artifacts.get("html", "")

    screenshot_base64 = ""
    if screenshot_path and Path(screenshot_path).exists():
        screenshot_base64 = base64.b64encode(Path(screenshot_path).read_bytes()).decode("ascii")

    html_content = ""
    if html_path and Path(html_path).exists():
        html_content = Path(html_path).read_text(encoding="utf-8")

    return {
        "meta": meta,
        "screenshotBase64": screenshot_base64,
        "htmlContent": html_content,
    }


def run_worker_once(args: argparse.Namespace) -> bool:
    claim = post_json(
        args.server_url.rstrip("/") + "/api/ozon-capture/claim",
        {},
        args.worker_secret,
    )
    job = claim.get("job")
    if not job:
        return False

    try:
        meta = capture_state(
            CaptureConfig(
                user_data_dir=Path(args.user_data_dir),
                browser_channel=args.browser_channel,
                profile_directory=args.profile_directory,
                output_root=Path(args.output_root),
                headless=bool(args.headless),
                connection_mode=args.connection_mode,
                cdp_url=args.cdp_url,
                target_section=job.get("targetSection", "auto"),
            )
        )
        post_json(
            args.server_url.rstrip("/") + f"/api/ozon-capture/{job['id']}/complete",
            read_artifact_payload(meta),
            args.worker_secret,
        )
    except Exception as exc:  # pragma: no cover - runtime dependent
        post_json(
            args.server_url.rstrip("/") + f"/api/ozon-capture/{job['id']}/fail",
            {"error": str(exc)},
            args.worker_secret,
        )
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Poll VPS capture jobs and execute Ozon browser captures locally.")
    parser.add_argument("--server-url", required=True, help="Base URL of the VPS bot server, e.g. https://bot.example.com")
    parser.add_argument("--worker-secret", required=True, help="Shared secret for worker auth")
    parser.add_argument("--user-data-dir", required=True, help="Path to the existing browser user-data directory")
    parser.add_argument("--browser-channel", default="msedge")
    parser.add_argument("--profile-directory", default="Default")
    parser.add_argument("--output-root", required=True, help="Local raw output root for worker captures")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--connection-mode", choices=["persistent", "cdp"], default="cdp")
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument("--poll-interval", type=int, default=15, help="Seconds between polling attempts")
    parser.add_argument("--once", action="store_true", help="Claim and process at most one job, then exit")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    while True:
        try:
            had_job = run_worker_once(args)
        except error.HTTPError as exc:  # pragma: no cover - runtime dependent
            print(json.dumps({"worker_error": f"HTTP {exc.code}", "message": exc.reason}, ensure_ascii=False))
            had_job = False
        except Exception as exc:  # pragma: no cover - runtime dependent
            print(json.dumps({"worker_error": str(exc)}, ensure_ascii=False))
            had_job = False

        if args.once:
            break
        if not had_job:
            time.sleep(max(args.poll_interval, 1))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
