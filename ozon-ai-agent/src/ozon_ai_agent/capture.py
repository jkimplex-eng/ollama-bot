from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import tempfile
from datetime import datetime, UTC
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError, sync_playwright

from .browser_use_bridge import get_browser_use_status
from .config import CaptureConfig, SECTION_URLS

DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parents[2] / "data" / "raw"


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def build_run_dir(output_root: Path) -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return ensure_dir(output_root / stamp)


def copy_sqlite_db_best_effort(source: Path, target: Path) -> bool:
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        source_conn = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        target_conn = sqlite3.connect(target)
        try:
            source_conn.backup(target_conn)
        finally:
            target_conn.close()
            source_conn.close()
        return True
    except Exception:
        return False


def copy_profile_tree_best_effort(source_root: Path, target_root: Path) -> list[str]:
    skipped: list[str] = []
    skip_names = {
        "SingletonLock",
        "SingletonCookie",
        "SingletonSocket",
        "lockfile",
        "Cookies-journal",
    }
    skip_dirs = {"Sessions"}
    sqlite_fallback_names = {"Cookies", "Safe Browsing Cookies"}

    for root, dirs, files in os.walk(source_root):
        current_root = Path(root)
        rel_root = current_root.relative_to(source_root)
        dirs[:] = [name for name in dirs if name not in skip_dirs]
        destination_root = target_root / rel_root
        destination_root.mkdir(parents=True, exist_ok=True)

        for file_name in files:
            if file_name in skip_names or file_name.endswith(".lock"):
                skipped.append(str((rel_root / file_name).as_posix()))
                continue

            source_file = current_root / file_name
            target_file = destination_root / file_name
            try:
                shutil.copy2(source_file, target_file)
            except OSError:
                if file_name in sqlite_fallback_names and copy_sqlite_db_best_effort(source_file, target_file):
                    continue
                skipped.append(str((rel_root / file_name).as_posix()))

    return skipped


def copy_user_profile_snapshot(user_data_dir: Path, profile_directory: str, work_root: Path) -> tuple[Path, list[str]]:
    snapshot_root = Path(tempfile.mkdtemp(prefix="profile-snapshot-", dir=str(work_root)))
    profile_source = user_data_dir / profile_directory
    profile_target = snapshot_root / profile_directory

    if not profile_source.exists():
        raise FileNotFoundError(f"Browser profile directory not found: {profile_source}")

    local_state = user_data_dir / "Local State"
    if local_state.exists():
        shutil.copy2(local_state, snapshot_root / "Local State")

    skipped_files = copy_profile_tree_best_effort(profile_source, profile_target)
    return snapshot_root, skipped_files


def launch_context(playwright, config: CaptureConfig, user_data_dir: Path):
    return playwright.chromium.launch_persistent_context(
        user_data_dir=str(user_data_dir),
        channel=config.browser_channel or None,
        headless=config.headless,
        args=[f"--profile-directory={config.profile_directory}"] if config.profile_directory else [],
        viewport={"width": 1440, "height": 1100},
    )


def attach_browser_over_cdp(playwright, config: CaptureConfig):
    browser = playwright.chromium.connect_over_cdp(config.cdp_url, timeout=30_000)
    context = browser.contexts[0] if browser.contexts else browser.new_context(viewport={"width": 1440, "height": 1100})
    return browser, context


def open_or_reuse_page(context):
    return context.pages[0] if context.pages else context.new_page()


def detect_challenge_state(page) -> dict[str, object]:
    title = page.title()
    html = page.content()
    markers = [
        "Похоже, нет соединения",
        "We need to make sure that you are not a robot",
        "fab_chlg_",
        "Please, enable JavaScript to continue",
    ]
    matched = [marker for marker in markers if marker in title or marker in html]
    auth_markers = [
        'data-widget="@seller-ui/registration"',
        "<mounting-point name=\"@seller-ui/registration\">",
    ]
    auth_matched = [marker for marker in auth_markers if marker in html]
    return {
        "challenge_detected": bool(matched),
        "challenge_markers": matched,
        "auth_required_detected": bool(auth_matched),
        "auth_markers": auth_matched,
    }


def get_candidate_urls(target_section: str) -> list[str]:
    if target_section == "analytics":
        return SECTION_URLS["analytics"]
    if target_section == "reports":
        return SECTION_URLS["reports"]
    if target_section == "current":
        return []
    return SECTION_URLS["analytics"] + SECTION_URLS["reports"]


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
    profile_mode = "live_profile"
    profile_snapshot_used = False
    profile_snapshot_reason = ""
    active_user_data_dir = config.user_data_dir
    snapshot_dir: Path | None = None
    snapshot_skipped_files: list[str] = []
    browser = None
    browser_close_required = False

    with sync_playwright() as playwright:
        if config.connection_mode == "cdp":
            profile_mode = "attached_browser"
            browser, context = attach_browser_over_cdp(playwright, config)
        else:
            try:
                context = launch_context(playwright, config, config.user_data_dir)
                browser_close_required = True
            except PlaywrightError as exc:
                if not config.allow_profile_snapshot_fallback:
                    raise
                profile_snapshot_reason = str(exc)
                snapshot_dir, snapshot_skipped_files = copy_user_profile_snapshot(
                    config.user_data_dir,
                    config.profile_directory,
                    run_dir,
                )
                active_user_data_dir = snapshot_dir
                profile_mode = "snapshot_profile"
                profile_snapshot_used = True
                context = launch_context(playwright, config, snapshot_dir)
                browser_close_required = True
        try:
            page = open_or_reuse_page(context)
            page.goto(config.start_url, wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_timeout(2_000)

            attempts = navigate_to_reports(page, get_candidate_urls(config.target_section))
            challenge = detect_challenge_state(page)

            html_path.write_text(page.content(), encoding="utf-8")
            page.screenshot(path=str(screenshot_path), full_page=True)

            meta = {
                "captured_at_utc": datetime.now(UTC).isoformat(),
                "start_url": config.start_url,
                "current_url": page.url,
                "title": page.title(),
                "browser_channel": config.browser_channel,
                "profile_directory": config.profile_directory,
                "target_section": config.target_section,
                "connection_mode": config.connection_mode,
                "cdp_url": config.cdp_url if config.connection_mode == "cdp" else "",
                "profile_mode": profile_mode,
                "profile_snapshot_used": profile_snapshot_used,
                "profile_snapshot_reason": profile_snapshot_reason,
                "active_user_data_dir": str(active_user_data_dir),
                "profile_snapshot_skipped_files": snapshot_skipped_files,
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
                "page_state": challenge,
            }
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            return meta
        finally:
            if browser_close_required:
                context.close()
            if snapshot_dir and snapshot_dir.exists():
                shutil.rmtree(snapshot_dir, ignore_errors=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open seller.ozon.ru with an existing browser profile and capture the current analytics/reports page."
    )
    parser.add_argument("--user-data-dir", required=True, help="Path to an existing browser user-data directory.")
    parser.add_argument("--browser-channel", default="msedge", help="Browser channel, e.g. msedge or chrome.")
    parser.add_argument("--profile-directory", default="Default", help="Browser profile directory name.")
    parser.add_argument("--output-root", default=None, help="Override output root directory.")
    parser.add_argument("--headless", action="store_true", help="Run headless. Disabled by default for session reuse.")
    parser.add_argument(
        "--connection-mode",
        choices=["persistent", "cdp"],
        default="persistent",
        help="Use a Playwright persistent context or attach to an existing browser over CDP.",
    )
    parser.add_argument(
        "--cdp-url",
        default="http://127.0.0.1:9222",
        help="CDP URL for an already running browser, used when --connection-mode cdp.",
    )
    parser.add_argument(
        "--target-section",
        choices=["auto", "analytics", "reports", "current"],
        default="auto",
        help="Which seller section to target after connecting to the existing session.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = CaptureConfig(
        user_data_dir=Path(args.user_data_dir),
        browser_channel=args.browser_channel,
        profile_directory=args.profile_directory,
        output_root=Path(args.output_root) if args.output_root else DEFAULT_OUTPUT_ROOT,
        headless=bool(args.headless),
        connection_mode=args.connection_mode,
        cdp_url=args.cdp_url,
        target_section=args.target_section,
    )
    meta = capture_state(config)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
