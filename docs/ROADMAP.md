# Roadmap

## Stable Core

- protect Telegram command routing
- protect startup, PM2, and cron behavior
- improve local diagnostics and operator safety

## Google Sheets Mapping

- keep strict mappings only
- improve Apps Script validation
- improve write diagnostics and export confidence

## Ozon Performance

- strengthen report readiness detection
- reduce operator pain around active limits
- improve single-campaign and queue flows

## Daily Reports

- improve finance and postings reconciliation
- improve COGS support
- improve diagnostics quality

## AI Analytics

- reduce CPU load
- improve deterministic fallbacks
- separate descriptive insights from actions

## Alerts

- improve deduplication
- improve severity and tuning
- improve operator visibility

## Dashboard

- add read-only operational dashboard
- expose jobs, alerts, reports, and queue state

## Database

- replace fragile JSON state with durable storage
- normalize reports, queue state, and history

## RAG

- add project knowledge retrieval
- keep it isolated from stable production flows

## Browser Automation

- create separate Python project `ozon-ai-agent`
- connect `browser-use` and Playwright
- reuse the user's existing authenticated browser profile/session for `seller.ozon.ru`
- do not automate password entry or login form submission
- navigate to seller analytics/reports pages and save current HTML/screenshot snapshots into `data/raw`
- keep browser automation isolated from stable Telegram bot production flows until validated
