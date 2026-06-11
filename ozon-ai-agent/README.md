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

5. Preferred mode for a real already-authorized session: attach to a browser started with CDP enabled.

Start Edge manually:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\Users\user\AppData\Local\Microsoft\Edge\User Data" `
  --profile-directory=Default
```

Then run capture in attach mode:

```powershell
python .\scripts\capture_ozon_state.py `
  --user-data-dir "C:\Users\user\AppData\Local\Microsoft\Edge\User Data" `
  --profile-directory Default `
  --connection-mode cdp `
  --cdp-url "http://127.0.0.1:9222"
```

## Notes on existing browser sessions

- Reusing a real browser profile may require the browser to be closed first.
- If the live profile is locked, the script now falls back to a temporary snapshot copy of the selected profile.
- Attach mode over CDP is the preferred path when you want to keep using the already opened logged-in browser session.
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

## Remote worker mode for VPS

When the Telegram bot runs on a VPS, the browser session must stay on the local Windows machine.

Architecture:

```text
Telegram -> VPS bot queue -> local Windows worker -> existing Edge session -> VPS result upload -> Telegram
```

1. On the VPS, enable remote queue mode:

```text
OZON_BROWSER_CAPTURE_MODE=remote_queue
OZON_CAPTURE_WORKER_ENABLED=true
OZON_CAPTURE_WORKER_SECRET=<shared secret>
```

2. On the local Windows machine, keep Edge running with CDP enabled:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\Users\user\AppData\Local\Microsoft\Edge\User Data" `
  --profile-directory=Default
```

3. Start the polling worker:

```powershell
python .\scripts\run_remote_capture_worker.py `
  --server-url "https://your-vps-host" `
  --worker-secret "<shared secret>" `
  --user-data-dir "C:\Users\user\AppData\Local\Microsoft\Edge\User Data" `
  --profile-directory Default `
  --output-root ".\data\raw" `
  --connection-mode cdp `
  --cdp-url "http://127.0.0.1:9222"
```

After that, Telegram commands sent to the VPS bot can enqueue capture jobs, and the local worker will execute them with the already authorized browser session.

## Next planned step

- connect `browser-use` to this capture runtime for guided navigation once the session-reuse path is stable
