# ozon-ai-agent

Separate Python project for browser-based Ozon Seller data capture.

## Purpose

This project is intentionally isolated from the stable Node.js Telegram bot.

Current scope:

- open `seller.ozon.ru` with the user's existing authenticated browser profile
- navigate to analytics or reports pages
- save HTML and screenshot snapshots into `data/raw`

Out of scope for this phase:

- password entry
- automated login
- campaign mutations
- bid or budget changes
- supply creation

## Guardrails

- Use an already authorized browser profile only.
- Do not type passwords or submit login credentials automatically.
- If the session is not authorized, capture the current page as-is and stop.

## Stack

- Playwright for deterministic browser control
- `browser-use` installed and prepared for later agent-driven flows

## Layout

```text
ozon-ai-agent/
  data/raw/
  scripts/capture_ozon_state.py
  src/ozon_ai_agent/
  pyproject.toml
```

## Quick start

1. Create a virtual environment.
2. Install dependencies from `pyproject.toml`.
3. Install Playwright browser support:

```powershell
python -m playwright install chromium
```

4. Run capture with an existing browser user-data directory:

```powershell
python .\scripts\capture_ozon_state.py `
  --user-data-dir "C:\Users\user\AppData\Local\Microsoft\Edge\User Data" `
  --browser-channel msedge `
  --profile-directory Default
```

## Notes on existing browser sessions

- Reusing a real browser profile may require the browser to be closed first.
- If the live profile is locked, the script now falls back to a temporary snapshot copy of the selected profile.
- The script does not attempt to recover authentication on its own.

## Outputs

Each run writes:

- page HTML
- screenshot
- metadata JSON

into:

```text
data/raw/YYYYMMDD-HHMMSS/
```

## Next planned step

- connect `browser-use` to this capture runtime for guided navigation once the session-reuse path is stable
