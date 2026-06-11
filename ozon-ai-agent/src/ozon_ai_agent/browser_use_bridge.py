from __future__ import annotations


def is_browser_use_available() -> bool:
    try:
        import browser_use  # noqa: F401
    except Exception:
        return False
    return True


def get_browser_use_status() -> str:
    return "available" if is_browser_use_available() else "unavailable"
