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
- `OLLAMA_FAST_MODEL=llama3.2:1b`
- `OLLAMA_CODER_MODEL=deepseek-r1:1.5b`
- `OLLAMA_ANALYTICS_MODEL=deepseek-r1:7b`
- `OLLAMA_TIMEOUT_MS=120000`
- `OLLAMA_MAX_PROMPT_CHARS=12000`
- `OLLAMA_DECISION_TIMEOUT_MS=600000`

Если `OLLAMA_ANALYTICS_MODEL` не задана, используется `OLLAMA_CHAT_MODEL`.

Performance API:

- `OZON_PERFORMANCE_CLIENT_ID`
- `OZON_PERFORMANCE_CLIENT_SECRET`
- `OZON_PERFORMANCE_BASE_URL=https://api-performance.ozon.ru`

Google Sheets mapping:

- actual tab mapping lives in [config/sheetsMap.js](</C:/Users/user/Documents/Codex/2026-05-13/github/ollama-bot/config/sheetsMap.js:1>)
- bot writes only to configured mappings
- unknown mapping => `Unknown sheet mapping: <name>`
- missing actual tab => `Sheet tab not found: <tabName>. Create it manually or update config/sheetsMap.js.`

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
- fast chat для CPU VPS: `llama3.2:1b` или `qwen3:1.7b`
- coder: `deepseek-r1:1.5b`
- analytics: `deepseek-r1:7b`

## Команды Telegram

Аналитика:

- `/daily`
- `/daily вчера`
- `/daily today`
- `/daily 2026-05-13`
- `/daily 2026-05-13 2026-05-14`
- `/daily debug 2026-05-13`
- `/daily raw 2026-05-13`
- `/analytics`
- `/analytics продажи`
- `/analytics реклама`
- `/analytics остатки`
- `/analytics проблемы`

Performance API:

- `/performance campaigns`
- `/performance stats 2026-05-01 2026-05-14`
- `/performance stats в таблицу 2026-05-01 2026-05-14`
- `/performance debug`

AI Decision Engine:

- `/ai strategy`
- `/ai quick`
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
- `/sheet <mappingKey> | value1 | value2 | ...`

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
- данные пишутся в mapped tabs из `config/sheetsMap.js`
- raw данные пишутся в mapped tabs `finance_raw`, `orders_raw`, `pl_diagnostics`
- если есть `data/cogs.json`, бот использует локальную себестоимость по SKU
- diagnostics доступны через `/daily debug YYYY-MM-DD` и `/daily raw YYYY-MM-DD`
- выручка и заказы берутся из postings API, а не из списаний finance API
- реклама берётся только из Performance API или явных рекламных операций в finance
- прибыль считается только если есть выручка, fees и настроенный COGS

Ограничения данных:

- finance данные Ozon могут приходить с лагом
- postings и finance за один день могут не совпадать по времени появления
- без `data/cogs.json` бот не рассчитывает прибыль, а пишет, что COGS не настроен
- если в finance есть только списания или корректировки без продаж, бот показывает предупреждение вместо фейкового P&L

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
- статистика использует асинхронный flow по docs: `POST /api/client/statistics` -> `GET /api/client/statistics/list` -> `GET /api/client/statistics/report`
- если API возвращает неожиданную форму отчёта, бот не придумывает поля и сообщает об ошибке

Telegram:

- проверь `TELEGRAM_BOT_TOKEN`
- если бот не отвечает, проверь PM2 логи и локальные `logs/*.log`
- если daily summary не отправляется в отдельный чат, проверь `DAILY_SUMMARY_CHAT_ID`

CPU VPS / Ollama:

- команды `/analytics`, `/ai strategy`, `/ai actions`, `/ai risks` используют сокращённый payload
- перед AI вызовом бот режет вход до `OLLAMA_MAX_PROMPT_CHARS`
- если Ollama падает или не отвечает вовремя, бот возвращает детерминированную сводку, а не ошибку
- для обычного чата можно задать лёгкую модель через `OLLAMA_FAST_MODEL`

Cron:

- проверь, что внешний сервис делает именно `POST`
- проверь заголовок `x-cron-secret`
- если endpoint доступен публично через reverse proxy, не отключай проверку секрета

## Безопасность

- не коммить `.env`
- не коммить секреты
- Performance API секреты не выводятся в логи
- если в старом проекте были захардкоженные credentials, их нужно считать скомпрометированными и ротировать

## Google Sheets setup

Создайте вручную tabs с именами из `config/sheetsMap.js`. По умолчанию нужны:

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

Колонки по умолчанию:

- `products`: `Название | SKU | Offer ID | Цена | Остаток`
- `stocks`: `Название | SKU | Offer ID | Остаток`
- `performance_campaigns`: `Campaign ID | Campaign Name | State | Adv Object Type | Payment Type | From Date | To Date | Budget | Daily Budget | Placement`
- `performance_stats`: `Date | Campaign ID | Campaign Name | SKU | Product Name | Price | Impressions | Clicks | CTR | Add To Cart | Avg CPC | Avg CPM | Spend | Orders | Revenue | Model Orders | Model Revenue | DRR`
- `daily_summary`: `Дата | Выручка | Выплата Ozon | Заказы | Комиссия | Логистика | Реклама | Себестоимость | Прибыль | Маржа | ДРР`
- `alerts`: `Дата | Уровень | Тип | Сообщение`

Дополнительные daily diagnostics tabs:

- `daily_sku`: `Дата | SKU | Offer ID | Название | Количество | Выручка`
- `daily_history`: `Дата | Выручка | Выплата Ozon | Заказы | Финансовые транзакции | Отправления | Прибыль | Warnings`
- `finance_raw`: `Дата отчёта | Дата операции | operation_type | operation_type_name | accruals_for_sale | sale_commission | amount | delivery_charge | return_delivery_charge | services | posting_number | sku | offer_id | item_name`
- `orders_raw`: `Дата отчёта | Дата отправления | Схема | posting_number | status | sku | offer_id | item_name | quantity | price | gross_revenue`
- `pl_diagnostics`: `Дата отчёта | Дата от | Дата до | Таймзона | finance_transactions | postings | revenue | orders | payout | profit_calculated | warnings`

## Apps Script contract

Apps Script должен принимать JSON:

```json
{
  "action": "appendRows",
  "sheet": "Actual_Tab_Name",
  "rows": [["..."], ["..."]]
}
```

```json
{
  "action": "replaceRows",
  "sheet": "Actual_Tab_Name",
  "headers": ["H1", "H2"],
  "rows": [["..."], ["..."]]
}
```

```json
{
  "action": "clearAndWrite",
  "sheet": "Actual_Tab_Name",
  "headers": ["H1", "H2"],
  "rows": [["..."], ["..."]]
}
```

Пример Apps Script:

```javascript
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || "{}");
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(payload.sheet);

    if (!sheet) {
      return jsonResponse({
        ok: false,
        error: "Sheet tab not found: " + payload.sheet + ". Create it manually or update config/sheetsMap.js."
      });
    }

    var headers = Array.isArray(payload.headers) ? payload.headers : [];
    var rows = Array.isArray(payload.rows) ? payload.rows : [];
    var width = headers.length || rows.reduce(function(max, row) {
      return Math.max(max, Array.isArray(row) ? row.length : 0);
    }, 0);

    rows = rows.map(function(row) {
      var values = Array.isArray(row) ? row.slice() : [];
      while (values.length < width) values.push("");
      return values.slice(0, width);
    });

    if (payload.action === "replaceRows" || payload.action === "clearAndWrite") {
      sheet.clearContents();
      if (headers.length) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
      if (rows.length) {
        sheet.getRange(headers.length ? 2 : 1, 1, rows.length, width).setValues(rows);
      }
      return jsonResponse({ ok: true, action: payload.action, rowsWritten: rows.length });
    }

    if (payload.action === "appendRows") {
      if (rows.length) {
        var startRow = Math.max(sheet.getLastRow() + 1, 1);
        sheet.getRange(startRow, 1, rows.length, width).setValues(rows);
      }
      return jsonResponse({ ok: true, action: payload.action, rowsWritten: rows.length });
    }

    return jsonResponse({ ok: false, error: "Unknown action: " + payload.action });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Важно:

- Apps Script не должен создавать sheets автоматически
- если tab отсутствует, он должен вернуть JSON error
- строки должны быть нормализованы по длине
- HTML ошибки деплоя лучше исключить через корректный deployment и публичный доступ

## What to test

После настройки tabs и Apps Script проверьте:

- `/performance campaigns`
- `/performance stats 2026-05-01 2026-05-14`
- `/performance stats в таблицу 2026-05-01 2026-05-14`
- `/performance debug`
- `/ozon товары 10 в таблицу`
