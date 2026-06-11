from __future__ import annotations

import argparse
import json
from datetime import datetime, UTC
from pathlib import Path

from playwright.sync_api import sync_playwright

from .browser_use_bridge import get_browser_use_status
from .config import CANDIDATE_REPORT_URLS, CaptureConfig

DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parents[2] / "data" / "raw"


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def build_run_dir(output_root: Path) -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return ensure_dir(output_root / stamp)


def navigate_to_reports(page, candidate_urls: list[str]) -> list[dict[str, str]]:
    attempts: list[dict[str, str]] = []
    for url in candidate_urls:
        status = "ok"
        message = ""
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_timeout(2_000)
        except Exception as exc:  # pragma: no cover - runtime/browser dependent
            status = "error"
            message = str(exc)

        attempts.append(
            {
                "url": url,
                "status": status,
                "message": message,
                "final_url": page.url,
                "title": page.title(),
            }
        )
        if status == "ok" and "seller.ozon.ru" in page.url:
            break
    return attempts


def capture_state(config: CaptureConfig) -> dict:
    run_dir = build_run_dir(config.output_root)
    html_path = run_dir / "page.html"
    screenshot_path = run_dir / "page.png"
    meta_path = run_dir / "meta.json"

    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(config.user_data_dir),
            channel=config.browser_channel or None,
            headless=config.headless,
            args=[f"--profile-directory={config.profile_directory}"] if config.profile_directory else [],
            viewport={"width": 1440, "height": 1100},
        )
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(config.start_url, wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_timeout(2_000)

            attempts = navigate_to_reports(page, CANDIDATE_REPORT_URLS)

            html_path.write_text(page.content(), encoding="utf-8")
            page.screenshot(path=str(screenshot_path), full_page=True)

            meta = {
                "captured_at_utc": datetime.now(UTC).isoformat(),
                "start_url": config.start_url,
                "current_url": page.url,
                "title": page.title(),
                "browser_channel": config.browser_channel,
                "profile_directory": config.profile_directory,
                "browser_use": get_browser_use_status(),
                "attempts": attempts,
                "guardrails": {
                    "password_entry_automated": False,
                    "login_submission_automated": False,
                    "uses_existing_profile": True,
                },
                "artifacts": {
                    "html": str(html_path),
                    "screenshot": str(screenshot_path),
                },
            }
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            return meta
        finally:
            context.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open seller.ozon.ru with an existing browser profile and capture the current analytics/reports page."
    )
    parser.add_argument("--user-data-dir", required=True, help="Path to an existing browser user-data directory.")
    parser.add_argument("--browser-channel", default="msedge", help="Browser channel, e.g. msedge or chrome.")
    parser.add_argument("--profile-directory", default="Default", help="Browser profile directory name.")
    parser.add_argument("--output-root", default=None, help="Override output root directory.")
    parser.add_argument("--headless", action="store_true", help="Run headless. Disabled by default for session reuse.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = CaptureConfig(
        user_data_dir=Path(args.user_data_dir),
        browser_channel=args.browser_channel,
        profile_directory=args.profile_directory,
        output_root=Path(args.output_root) if args.output_root else DEFAULT_OUTPUT_ROOT,
        headless=bool(args.headless),
    )
    meta = capture_state(config)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
