# Review Handoff - 2026-06-13

This document is the current project handoff package for review.

Repository:

- `jkimplex-eng/ollama-bot`

Primary runtime:

- Node.js / Express Telegram bot
- PM2 on VPS
- Ozon Seller API
- Ozon Performance API
- Google Sheets via Apps Script
- local JSON state in `data/`

Secondary track:

- separate Python browser automation project: `ozon-ai-agent`

## 1. Current project shape

Main app:

- `server.js` - bootstraps the bot and all services
- `services/telegram.js` - Telegram command routing
- `services/ozon.js` - Ozon Seller API integration
- `services/performance.js` - Ozon Performance API integration
- `services/reportBuilder.js` - P&L and SKU reports
- `services/dailySummary.js` - daily diagnostics and summaries
- `services/dailySync.js` - one-command daily sync and auto-sync
- `services/managementWorkbook.js` - `Daily Input` export logic
- `services/adsDiagnostics.js` - ads diagnostics, reconcile, gaps, factors
- `services/replenishment.js` - replenishment forecast logic

Browser automation track:

- `ozon-ai-agent/` - separate Python capture worker
- `services/ozonBrowserCapture.js` - local Node runner
- `services/ozonCaptureQueue.js` - VPS queue bridge for remote worker mode

## 2. Stable flows that should be considered production-critical

These command families are the current stable core and should not regress:

- `/chatid`
- `/health`
- `/models`
- `/ozon товары ...`
- `/daily ...`
- `/daily debug ...`
- `/daily raw ...`
- `/management daily ...`
- `/report pnl ...`
- `/report sku ...`
- `/performance campaigns ...`
- `/performance stats ...`
- `/performance report ...`
- `/performance rows status`
- `/jobs status|run|stop`
- `/alerts status|run|stop|settings`

## 3. Major delivered milestones

### Ads diagnostics layer

Read-only ads command set implemented:

- `/ads debug YYYY-MM-DD YYYY-MM-DD`
- `/ads report YYYY-MM-DD YYYY-MM-DD`
- `/ads reconcile YYYY-MM-DD YYYY-MM-DD`
- `/ads campaigns YYYY-MM-DD YYYY-MM-DD`
- `/ads sku YYYY-MM-DD YYYY-MM-DD`
- `/ads sku_day YYYY-MM-DD YYYY-MM-DD`
- `/ads gaps YYYY-MM-DD YYYY-MM-DD`
- `/ads gaps debug YYYY-MM-DD YYYY-MM-DD`
- `/ads factors YYYY-MM-DD YYYY-MM-DD`
- `/ads factors debug YYYY-MM-DD YYYY-MM-DD`
- `/ads recommendations ...`
- `/ads optimize preview ...`

What is already covered:

- Performance row deduplication before aggregation
- finance advertising reconciliation
- finance advertising breakdown by operation type
- coverage model: covered vs uncovered finance advertising
- campaign-level diagnostics
- SKU-level diagnostics
- factor-level diagnostics with sales facts, COGS, stock, priority SKU, and external traffic context

Important guardrail:

- all current ads flows are read-only
- no bid changes
- no budget changes
- no campaign mutation calls

### Daily workbook mode

Management workbook behavior is intentionally conservative:

- bot writes only to `Daily Input`
- formula-driven sheets are preserved:
  - `Dashboard`
  - `Unit Economics`
  - `Month Review`
  - `Settings`

Important constraints already implemented:

- monthly `Daily Input YYYY-MM` sheet resolution
- template-safe row update
- formula columns are preserved
- date matching supports template formats
- no duplicate append when matching row exists

### Daily sync

One-command sync exists:

- `/daily yesterday`
- `/daily today`
- `/daily YYYY-MM-DD`
- `/daily в таблицу yesterday`
- `/daily summary yesterday`
- `/daily debug YYYY-MM-DD`

Implemented behavior:

- same-date sales + finance fetch
- Daily Input build
- optional write to `Daily Input`
- concise summary
- timezone-aware yesterday resolution

### Replenishment

Implemented:

- `/replenishment forecast ...`
- `/replenishment debug ...`
- `/replenishment traffic debug ...`
- priority SKU support
- external traffic plan support
- warehouse mapping support
- stock normalization support

### Browser automation track

Separate Python project delivered:

- `ozon-ai-agent`

Implemented:

- Playwright-based seller capture
- live browser CDP attach
- reuse of already authorized Edge session
- analytics / reports targeting
- HTML + screenshot + meta capture

Verified locally:

- agent successfully entered `https://seller.ozon.ru/app/analytics`
- `challenge_detected = false`
- `auth_required_detected = false`

Recent browser automation commits:

- `c91c2bd feat: scaffold ozon browser automation agent`
- `fa08060 fix: harden ozon browser profile capture`
- `c5114da feat: add cdp attach mode for ozon capture`
- `369611d feat: add telegram command for ozon browser capture`
- `7b929fe feat: target ozon analytics and reports capture`
- `3bd6fb1 feat: add remote ozon capture worker bridge`

## 4. Current browser automation deployment model

This is important for review.

The Ozon browser session does not move to the VPS.

The correct architecture is:

```text
Telegram -> VPS bot -> capture queue -> local Windows worker -> existing Edge session -> VPS result upload -> Telegram
```

What already exists in code:

- local Telegram capture commands
- target-specific capture commands:
  - `/ozon capture`
  - `/ozon capture debug`
  - `/ozon capture status`
  - `/ozon analytics capture`
  - `/ozon analytics capture debug`
  - `/ozon reports capture`
  - `/ozon reports capture debug`
- remote queue service
- worker API endpoints
- local polling worker script

What is intentionally not yet completed operationally:

- VPS `.env` enablement for remote queue mode
- permanent local Windows worker process
- first end-to-end remote queue live run

This step was intentionally paused after implementation so it can be resumed later in a controlled way.

## 5. Files most relevant for review

Core:

- `server.js`
- `config/env.js`
- `routes/api.js`
- `services/telegram.js`

Ads:

- `services/adsDiagnostics.js`

Daily reporting:

- `services/dailySummary.js`
- `services/dailySync.js`
- `services/managementWorkbook.js`
- `services/reportBuilder.js`

Replenishment:

- `services/replenishment.js`
- `services/prioritySkus.js`
- `services/externalTrafficPlan.js`
- `services/warehouseMapping.js`

Browser automation:

- `services/ozonBrowserCapture.js`
- `services/ozonCaptureQueue.js`
- `ozon-ai-agent/src/ozon_ai_agent/capture.py`
- `ozon-ai-agent/src/ozon_ai_agent/remote_worker.py`
- `ozon-ai-agent/scripts/run_remote_capture_worker.py`
- `ozon-ai-agent/README.md`

## 6. Latest meaningful git milestones

Recent commit sequence:

- `3bd6fb1 feat: add remote ozon capture worker bridge`
- `7b929fe feat: target ozon analytics and reports capture`
- `369611d feat: add telegram command for ozon browser capture`
- `c5114da feat: add cdp attach mode for ozon capture`
- `fa08060 fix: harden ozon browser profile capture`
- `c91c2bd feat: scaffold ozon browser automation agent`
- `afe30cf feat: enrich daily raw diagnostics with local facts`
- `a444200 fix: load sales facts for ads factors`
- `567712f feat: add ads factors diagnostics`
- `933c843 feat: add ads gaps diagnostics`
- `c4e0d88 feat: add ads reconcile command`
- `8d8bafb feat: add ads diagnostics reports`

## 7. Review checklist

Suggested review path:

1. Stable Telegram routing
2. Ads diagnostics read-only safety
3. Daily workbook write safety
4. Browser automation isolation
5. VPS bridge design

Concrete checks:

- confirm no ad mutation endpoints are used in the diagnostics layer
- confirm `Daily Input` remains the only management sheet write target
- confirm formula columns in workbook exports remain preserved
- confirm browser automation does not auto-enter passwords
- confirm remote worker flow requires explicit shared secret

## 8. Known open items

These are the current known follow-ups, not hidden defects:

1. `PROJECT_CONTEXT.md` needs a future refresh because it still contains stale “next task” text.
2. Remote Ozon capture bridge is implemented but not yet operationally deployed on VPS + Windows worker.
3. Browser automation should remain isolated from the stable core until the first remote queue run is validated.
4. Long-term storage is still JSON-based and should eventually move to durable storage.

## 9. Commands for validation

Local app checks:

```powershell
npm test
npm run health
```

Browser automation local check:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\Users\user\AppData\Local\Microsoft\Edge\User Data" `
  --profile-directory=Default
```

Then:

```powershell
python .\ozon-ai-agent\scripts\capture_ozon_state.py `
  --user-data-dir "C:\Users\user\AppData\Local\Microsoft\Edge\User Data" `
  --profile-directory Default `
  --connection-mode cdp `
  --cdp-url "http://127.0.0.1:9222" `
  --target-section analytics
```

Remote worker shape:

```powershell
python .\ozon-ai-agent\scripts\run_remote_capture_worker.py `
  --server-url "https://your-vps-host" `
  --worker-secret "<shared secret>" `
  --user-data-dir "C:\Users\user\AppData\Local\Microsoft\Edge\User Data" `
  --profile-directory Default `
  --output-root ".\ozon-ai-agent\data\raw" `
  --connection-mode cdp `
  --cdp-url "http://127.0.0.1:9222"
```

Telegram validation examples:

```text
/health
/daily summary yesterday
/report pnl 2026-05-13 2026-05-14
/report sku 2026-05-13 2026-05-14
/ads reconcile 2026-05-13 2026-05-14
/ads gaps 2026-05-13 2026-05-14
/ads factors 2026-05-13 2026-05-14
/ozon capture status
/ozon analytics capture
```

## 10. Recommended reviewer conclusion framing

This project should be reviewed as two coordinated tracks:

1. stable production Telegram bot
2. isolated browser automation extension

The production bot is already feature-rich and diagnostics-heavy.

The browser automation track is no longer just a prototype. It has:

- successful local seller login via existing browser session
- Telegram integration
- analytics/reports targeting
- a designed VPS-to-Windows bridge

But it is still correct to treat the remote worker deployment as the next operational milestone, not as a fully closed rollout.
