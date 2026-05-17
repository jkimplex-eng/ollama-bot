# Project Context Handoff

This file is the portable memory for continuing the Ozon AI Telegram bot from another ChatGPT/Codex account.

## Project summary

Repository: `jkimplex-eng/ollama-bot`.

This is a Node.js/Express Telegram bot running 24/7 on a VPS via PM2. It connects to:

- Telegram Bot API
- Ozon Seller API
- Ozon Performance API
- Google Sheets through Apps Script
- Ollama as optional/local AI backend
- strict local JSON state files under `data/`

The project started as a local Ollama Telegram bot and was moved to a VPS for autonomous operation.

## Current production architecture

```text
Telegram
  -> services/telegram.js
  -> service layer
     -> Ozon Seller API
     -> Ozon Performance API
     -> Google Sheets Apps Script
     -> local data/*.json storage
     -> Ollama optional AI
  -> PM2 on VPS
```

Important files:

- `server.js` - bootstraps the app
- `config/env.js` - environment and runtime config
- `config/sheetsMap.js` - strict Google Sheets mapping
- `services/telegram.js` - Telegram command router
- `services/ozon.js` - Ozon Seller API
- `services/performance.js` - Ozon Performance API, reports, queue, diagnostics, stored rows
- `services/sheets.js` - Google Sheets writes
- `services/reportBuilder.js` - P&L Summary and SKU Dashboard builders
- `services/ollama.js` - local AI model calls
- `services/dailySummary.js` - daily report flow
- `services/analytics.js` - analytics logic
- `services/decisionEngine.js` - action recommendations
- `services/jobs.js` - background jobs
- `services/alerts.js` - alerts
- `docs/AGENT.md` - agent operating rules
- `docs/RUNBOOK.md` - operational runbook
- `docs/ROADMAP.md` - roadmap
- `docs/CODEX_START_PROMPT.md` - prompt for a new GPT/Codex account

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
- `/performance report <uuid>`
- `/performance report в таблицу <uuid>`
- `/performance rows status`
- `/report pnl YYYY-MM-DD YYYY-MM-DD`
- `/report sku YYYY-MM-DD YYYY-MM-DD`

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
- CSV-ready report detection:
  - if report endpoint returns HTTP 200 + `text/csv`, treat as ready even when `statistics/list` is empty
- Russian semicolon CSV parsing:
  - BOM/header normalization
  - comma decimal parsing, e.g. `1987,68` -> `1987.68`
  - real Russian headers mapped to fields such as `spend`, `avgCpc`, `revenue`, `orderedAmount`
- export to Google Sheets `Performance Stats`
- local persistent rows storage in `data/performance-rows.json`
- `/performance rows status`
- `/performance rows clear`

Known Ozon Performance limits:

- max 10 campaigns per statistics request
- max 1 active report at a time
- report generation is asynchronous
- `statistics/list` may be empty even when the report endpoint can return the CSV

## Google Sheets strategy

The bot must use strict mappings only.

Do not create random tabs from code.

Expected tabs include:

- `Products`
- `Stocks`
- `Performance Campaigns`
- `Performance Stats`
- `P&L Summary`
- `SKU Dashboard`
- `Daily Summary`
- `Alerts`
- `Daily SKU`
- `PL History`
- `Finance Raw`
- `Orders Raw`
- `PL Diagnostics`

If a tab is missing, return a clear error.

## Dashboard exports current state

Working:

- `/report pnl YYYY-MM-DD YYYY-MM-DD`
- `/report pnl в таблицу YYYY-MM-DD YYYY-MM-DD`
- `/report sku YYYY-MM-DD YYYY-MM-DD`
- `/report sku в таблицу YYYY-MM-DD YYYY-MM-DD`
- exports use `clearAndWrite`, not append
- local performance rows are persisted and date-normalized
- stored row dates support both `DD.MM.YYYY` and `YYYY-MM-DD`
- `/performance rows status` shows normalized ISO min/max dates

Known current dashboard issue:

- `/report sku` correctly shows advertising spend, e.g. `Реклама: 4067.16`
- `/report pnl` currently shows `Реклама | 0 | 0` for the same period
- next fix: P&L Summary advertising row must aggregate `row.spend` by date

Current Codex task to do next:

```text
Fix P&L Summary advertising aggregation.

Problem:
/report sku shows Реклама: 4067.16
but /report pnl shows Реклама | 0 | 0

Requirements:
1. In services/reportBuilder.js, P&L Summary row "Реклама" must aggregate Performance row spend by date.
2. If row.spend exists, use it.
3. If spend is missing, fallback to row.adSpend or row.cost if available.
4. Add tests:
- two rows with spend on 2026-05-13 and 2026-05-14
- P&L Summary advertising row totals are correct per day
5. Run npm test and npm run health.
6. Commit and push.
```

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
2. dashboard reports based on stored rows
3. clean daily raw reports
4. COGS mapping
5. real P&L
6. PostgreSQL persistence
7. dashboard
8. AI provider abstraction
9. only then agent orchestrator/multi-agent system

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

Fix P&L Summary advertising aggregation in `services/reportBuilder.js`.
