# Ollama Bot

Локальный Telegram и web-бот для Ozon c:

- обычным чатом через Ollama
- coder-моделью
- AI-аналитикой
- AI Decision Engine
- Ozon Seller API
- Ozon Performance API
- Google Sheets
- фоновыми jobs
- background alerts
- daily P&L summary
- запуском через PM2

## Env

Обязательные:

- `TELEGRAM_BOT_TOKEN`
- `OZON_CLIENT_ID`
- `OZON_API_KEY`
- `GOOGLE_SHEETS_WEBAPP_URL`

Ollama:

- `OLLAMA_CHAT_URL=http://127.0.0.1:11434/api/chat`
- `OLLAMA_CHAT_MODEL=qwen2.5:3b`
- `OLLAMA_CODER_MODEL=deepseek-r1:1.5b`
- `OLLAMA_ANALYTICS_MODEL=deepseek-r1:7b`
- `OLLAMA_TIMEOUT_MS=120000`

Если `OLLAMA_ANALYTICS_MODEL` не задана, используется `OLLAMA_CHAT_MODEL`.

Performance API:

- `OZON_PERFORMANCE_CLIENT_ID`
- `OZON_PERFORMANCE_CLIENT_SECRET`
- `OZON_PERFORMANCE_BASE_URL=https://api-performance.ozon.ru`

Daily summary / cron:

- `CRON_SECRET`
- `DAILY_SUMMARY_CHAT_ID`

Optional local COGS mapping:

- `data/cogs.json`

Jobs:

- `JOBS_ENABLED=true`
- `JOBS_PRODUCTS_INTERVAL_MS=1800000`
- `JOBS_STOCKS_INTERVAL_MS=3600000`
- `JOBS_RETRY_ATTEMPTS=3`
- `JOBS_RETRY_DELAY_MS=5000`
- `JOBS_PRODUCT_LIMIT=100`
- `JOBS_STOCK_LIMIT=100`

Alerts:

- `ALERTS_ENABLED=true`
- `ALERTS_INTERVAL_MS=3600000`
- `ALERTS_LOW_STOCK_THRESHOLD=5`

Прочее:

- `PORT=3000`

## Рекомендуемые модели

- chat: `qwen2.5:3b`
- chat на более сильной машине: `qwen2.5:7b`
- coder: `deepseek-r1:1.5b`
- analytics: `deepseek-r1:7b`

## Команды Telegram

Аналитика:

- `/daily`
- `/daily вчера`
- `/daily today`
- `/daily 2026-05-13`
- `/daily 2026-05-13 2026-05-14`
- `/analytics`
- `/analytics продажи`
- `/analytics реклама`
- `/analytics остатки`
- `/analytics проблемы`

Performance API:

- `/performance campaigns`
- `/performance stats`
- `/performance sku`

AI Decision Engine:

- `/ai strategy`
- `/ai actions`
- `/ai risks`
- `/ai закупка`
- `/ai реклама`

Alerts:

- `/alerts status`
- `/alerts run`
- `/alerts stop`
- `/alerts settings`

Ozon и Sheets:

- `/ozon товары`
- `/ozon товары 25`
- `/ozon товары 25 в таблицу`
- `/sheet Лист1 | товар | 10 | комментарий`

Service:

- `/jobs status`
- `/jobs run`
- `/jobs stop`
- `/models`

## Запуск

Установка зависимостей:

```powershell
npm install
```

Обычный запуск:

```powershell
npm start
```

Ручной запуск дневного P&L:

```powershell
npm run daily
```

Проверка:

```powershell
node --check server.js
npm test
```

## PM2

Старт через конфиг:

```powershell
pm2 start ecosystem.config.js
```

Или напрямую:

```powershell
pm2 start server.js --name ollama-bot
```

Также доступны:

```powershell
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
npm run pm2:logs
```

## Background jobs и alerts

Jobs:

- товары -> Google Sheets
- остатки -> Google Sheets
- логи: `logs/jobs.log`

Alerts:

- low stock
- missing stock
- товары без SKU или offer_id
- дорогие кампании
- кампании с расходом без заказов
- кандидаты на продвижение
- товары для ручной проверки
- логи: `logs/alerts.log`
- state: `data/alerts-state.json`

Daily P&L:

- отчёт сохраняется в `reports/daily/YYYY-MM-DD.md`
- summary уходит в Telegram
- данные пишутся в `Daily_PL`, `SKU_PL`, `PL_History`
- если есть `data/cogs.json`, бот использует локальную себестоимость по SKU

## External cron

GitHub Actions не используются. Для расписания нужен внешний HTTP cron.

Пример для cron-job.org или любого бесплатного cron-сервиса:

- method: `POST`
- URL: `https://your-public-url/cron/daily-summary`
- header: `x-cron-secret: <CRON_SECRET>`
- schedule: каждый день в `09:00` по Москве

Endpoint:

- `POST /cron/daily-summary`
- при неверном или пустом секрете вернёт `401`
- при успехе вернёт JSON с `reportPath` и `sentToTelegram`

## Troubleshooting

Ollama:

- проверь, что Ollama запущен локально
- проверь `OLLAMA_CHAT_URL`
- команда `/models` показывает статус и доступные модели

Ozon Seller API:

- проверь `OZON_CLIENT_ID` и `OZON_API_KEY`
- если данные по товарам не приходят, бот вернёт понятную ошибку

Ozon Performance API:

- проверь `OZON_PERFORMANCE_CLIENT_ID` и `OZON_PERFORMANCE_CLIENT_SECRET`
- если credentials не заданы, бот не падает и пишет, что Performance API не настроен

Telegram:

- проверь `TELEGRAM_BOT_TOKEN`
- если бот не отвечает, проверь PM2 логи и локальные `logs/*.log`
- если daily summary не отправляется в отдельный чат, проверь `DAILY_SUMMARY_CHAT_ID`

Cron:

- проверь, что внешний сервис делает именно `POST`
- проверь заголовок `x-cron-secret`
- если endpoint доступен публично через reverse proxy, не отключай проверку секрета

## Безопасность

- не коммить `.env`
- не коммить секреты
- Performance API секреты не выводятся в логи
- если в старом проекте были захардкоженные credentials, их нужно считать скомпрометированными и ротировать
