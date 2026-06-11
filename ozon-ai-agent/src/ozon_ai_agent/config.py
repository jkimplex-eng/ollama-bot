from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class CaptureConfig:
    user_data_dir: Path
    browser_channel: str = "msedge"
    profile_directory: str = "Default"
    output_root: Path = Path(__file__).resolve().parents[2] / "data" / "raw"
    headless: bool = False
    start_url: str = "https://seller.ozon.ru/"
    allow_profile_snapshot_fallback: bool = True


CANDIDATE_REPORT_URLS = [
    "https://seller.ozon.ru/app/analytics",
    "https://seller.ozon.ru/analytics",
    "https://seller.ozon.ru/app/reports",
    "https://seller.ozon.ru/reports",
]
