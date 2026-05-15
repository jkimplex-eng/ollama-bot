# Runbook

## Restart PM2

```powershell
pm2 restart ollama-bot
```

Or:

```powershell
npm run pm2:restart
```

## Check Logs

```powershell
pm2 logs ollama-bot
```

Also inspect:

- `logs/jobs.log`
- `logs/alerts.log`

## Check Ollama

Telegram:

- `/models`

Local:

```powershell
curl http://127.0.0.1:11434/api/tags
```

## Pull Updates

```powershell
git pull origin main
npm install
npm test
npm run health
pm2 restart ollama-bot
```

## Recover Telegram

- confirm `TELEGRAM_BOT_TOKEN`
- run `npm run health`
- inspect PM2 logs
- test `/chatid`
- test `/health`

If needed:

```powershell
pm2 restart ollama-bot
```

## Debug Ozon Performance Queue

Use:

- `/performance queue`
- `/performance continue`
- `/performance discover`
- `/performance discover raw`
- `/performance report status <uuid>`

Files:

- `data/performance-queue.json`
- `data/performance-reports.json`

## Debug Google Apps Script

- confirm `GOOGLE_SHEETS_WEBAPP_URL`
- confirm tabs exist exactly as in `config/sheetsMap.js`
- confirm Apps Script returns JSON, not HTML
- confirm deployment permissions allow POST access
