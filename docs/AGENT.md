# Project Operator Agent

## Purpose

This repository is maintained with a lightweight operator model: understand the current system, make small safe changes, run checks, and avoid broad rewrites.

## Current System Architecture

- `server.js`
  - bootstraps Express, Telegram, Ozon, Sheets, jobs, alerts, analytics, daily summary
- `config/env.js`
  - central runtime config and filesystem paths
- `config/sheetsMap.js`
  - strict Google Sheets tab mappings
- `routes/api.js`
  - web and cron endpoints
- `services/telegram.js`
  - Telegram command parsing and command execution
- `services/ollama.js`
  - Ollama model routing
- `services/ozon.js`
  - Ozon Seller API integration
- `services/performance.js`
  - Ozon Performance API, reports, queue, diagnostics
- `services/sheets.js`
  - mapped Google Sheets writes only
- `services/dailySummary.js`
  - daily P&L and diagnostics
- `services/analytics.js`
  - analytics summary layer
- `services/decisionEngine.js`
  - action-oriented AI decision outputs
- `services/jobs.js`
  - background sync jobs
- `services/alerts.js`
  - alert generation and delivery

## Stable Core Commands

Treat these as stable behavior unless the task explicitly changes them:

- `/chatid`
- `/health`
- `/models`
- `/ozon товары`
- `/ozon товары <limit>`
- `/ozon товары <limit> в таблицу`
- `/daily`
- `/daily debug <date>`
- `/daily raw <date>`
- `/jobs status|run|stop`
- `/alerts status|run|stop|settings`
- `/performance campaigns ...`
- `/performance stats ...`
- `/performance report ...`
- `/performance queue`
- `/performance continue`
- `/performance discover`

## Unstable Features

- Ozon Performance active-limit recovery
- Ozon Performance readiness detection
- daily P&L reconciliation between finance and postings
- AI analytics and decision prompts
- external Apps Script behavior and tab correctness

## Deployment Commands

```powershell
npm install
npm test
npm run health
npm start
```

PM2:

```powershell
pm2 start ecosystem.config.js
pm2 restart ollama-bot
pm2 logs ollama-bot
```

## VPS Checklist

- `.env` exists on the VPS
- no secrets are committed
- `npm test` passes before restart
- `npm run health` passes or warnings are understood
- Ollama is running locally if AI features are needed
- PM2 process `ollama-bot` is online
- `logs/` and `data/` are writable
- Apps Script URL is valid

## Debugging Checklist

- run `npm test`
- run `npm run health`
- inspect PM2 logs
- inspect `logs/jobs.log`
- inspect `logs/alerts.log`
- inspect `data/performance-queue.json`
- inspect `data/performance-reports.json`
- use Telegram diagnostics:
  - `/models`
  - `/performance debug`
  - `/performance discover`
  - `/performance discover raw`
  - `/performance report status <uuid>`
  - `/daily debug <date>`

## GitHub / Codex Workflow

1. Read the affected service first.
2. Make a small, scoped change.
3. Run `npm test`.
4. Run `npm run health` if config, docs, startup, or deployment behavior changed.
5. Commit only intended files.
6. Push only after checks pass.

## Rules

- small changes only
- `npm test` required
- no secrets in code or docs
- no broad rewrites
- preserve strict Sheets mappings
- prefer diagnostics before changing fragile Ozon logic
