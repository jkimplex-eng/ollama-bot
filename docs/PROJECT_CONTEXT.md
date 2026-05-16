# Project Context Handoff

This file is the portable memory for continuing the Ozon AI Telegram bot from another ChatGPT/Codex account.

## Project summary

The repository is `jkimplex-eng/ollama-bot`.

It is a Node.js/Express Telegram bot running on a VPS. It connects to:

- Telegram Bot API
- Ozon Seller API
- Ozon Performance API
- Google Sheets through Apps Script
- Ollama as optional/local AI backend
- PM2 for 24/7 runtime

The project started as a local Ollama Telegram bot and was moved to a VPS for autonomous operation.

## Current production architecture

```text
Telegram
  -> services/telegram.js
  -> service layer
     -> Ozon Seller API
     -> Ozon Performance API
     -> Google Sheets Apps Script
     -> Ollama optional AI
  -> PM2 on VPS
```

Important files:

- `server.js` - bootstraps the app
- `config/env.js` - environment and runtime config
- `config/sheetsMap.js` - strict Google Sheets mapping
- `services/telegram.js` - Telegram command router
- `services/ozon.js` - Ozon Seller API
- `services/performance.js` - Ozon Performance API, reports, queue, diagnostics
- `services/sheets.js` - Google Sheets writes
- `services/ollama.js` - local AI model calls
- `services/dailySummary.js` - daily report flow
- `services/analytics.js` - analytics logic
- `services/decisionEngine.js` - action recommendations
- `services/jobs.js` - background jobs
- `services/alerts.js` - alerts
- `docs/AGENT.md` - agent operating rules
- `docs/RUNBOOK.md` - operational runbook
- `docs/ROADMAP.md` - roadmap

## Stable core that must not break

These commands are considered stable and must remain working:

- `/chatid`
- `/health`
- `/models`
- `/ozon товары 10`
- `/ozon товары 10 в таблицу`
- `/ai quick`
- `/performance campaigns active`
- `/performance campaigns active в таблицу`
- `/performance minbid <sku>`

If a change touches these flows, add tests and verify manually.

## Ozon Performance API current state

Working:

- Performance auth/token flow
- `/performance campaigns active`
- `/performance campaigns active в таблицу`
- campaign pagination/filtering
- active/running campaign filters
- inferred payment types:
  - `SKU + PLACEMENT_TOP_PROMOTION` -> `CPC_TOP / Поиск`
  - `SKU + PLACEMENT_SEARCH_AND_CATEGORY` -> `CPC / Поиск и рекомендации`
  - `SKU + PLACEMENT_OVERTOP` -> `CPC / Спецразмещение`
  - `SEARCH_PROMO` -> `CPO / Оплата за заказ`
  - `ALL_SKU_PROMO` -> `CPO / Оплата за заказ`
- `/performance limits`
- `/performance minbid <sku>`
- single-campaign stats report creation:
  - `/performance stats campaign <campaignId> YYYY-MM-DD YYYY-MM-DD`
- report diagnostics:
  - `/performance report status <uuid>`
  - `/performance discover raw`
- queue/cooldown logic for Ozon active-report limits

Known Ozon Performance limits:

- max 10 campaigns per statistics request
- max 1 active report at a time
- report generation is asynchronous
- `statistics/list` may be empty even when the report endpoint can return the CSV

## Critical current bug

The report endpoint can already return a ready CSV:

```text
HTTP 200
Content-Type: text/csv; charset=utf-8
```

Example CSV body starts with:

```text
;Кампания по продвижению товаров № ...
День;sku;Название товара;Цена товара, ₽;Показы;Клики;CTR (%);...
```

But the bot may still treat the report as `pending` because local state or `statistics/list` says pending/null.

Next fix:

- If `GET /api/client/statistics/report?UUID=<uuid>` returns `200` and `text/csv`, treat report as READY.
- Parse semicolon-separated CSV.
- Russian decimal values use comma, for example `9133,00`.
- Update local report record to `status=ready`, set `readyAt`, set `rowsCount`.
- `/performance report <uuid>` should show a summary.
- `/performance report в таблицу <uuid>` should write rows to `Performance Stats`.

## Google Sheets strategy

The bot must use strict mappings only.

Do not create random tabs from code.

Expected tabs include:

- `Products`
- `Stocks`
- `Performance Campaigns`
- `Performance Stats`
- `Daily Summary`
- `Alerts`
- `Daily SKU`
- `PL History`
- `Finance Raw`
- `Orders Raw`
- `PL Diagnostics`

If a tab is missing, return a clear error.

## VPS deployment

Typical VPS update flow:

```bash
cd /root/ollama-bot
git pull origin main
npm install
npm test
npm run health
pm2 restart ollama-bot --update-env
pm2 save
```

Check runtime:

```bash
pm2 list
pm2 logs ollama-bot --lines 50
systemctl status ollama --no-pager
```

## Local workflow

On Windows:

```powershell
cd C:\Users\user\ollama-bot
git status
git pull --rebase origin main
npm install
npm test
npm run health
git add <files>
git commit -m "message"
git push origin main
```

If there is a rebase conflict, stop and resolve carefully. Do not force push unless explicitly decided.

## AI strategy

Ollama is currently optional and can be slow on CPU VPS.

Recommended future direction:

- keep deterministic business logic outside AI
- add `AI_PROVIDER=ollama|openai|openrouter|deerflow` later
- keep Ollama as fallback
- do not let AI break stable commands

## Orchestration strategy

Do not add a complex orchestrator yet.

First finish stable project modules:

1. Performance report CSV -> summary -> Sheets
2. clean daily raw reports
3. COGS mapping
4. real P&L
5. PostgreSQL persistence
6. dashboard
7. AI provider abstraction
8. only then agent orchestrator/multi-agent system

Current orchestration is mostly in:

- `services/telegram.js`
- `services/performance.js`
- `services/jobs.js`

## Rules for a new GPT/Codex account

Start every new session by reading:

1. `docs/AGENT.md`
2. `docs/RUNBOOK.md`
3. `docs/ROADMAP.md`
4. `docs/PROJECT_CONTEXT.md`
5. `docs/CODEX_START_PROMPT.md`

Then continue from the current state. Do not rewrite the project from scratch.

## Immediate next Codex task

Fix Performance report CSV-ready detection and export to Google Sheets.
