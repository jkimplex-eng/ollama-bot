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
- `DAILY_CONTROL_PLAN_VP=180645`

Optional local COGS mapping:

- `data/cogs.json`
- управление через Telegram: `/cogs template`, `/cogs status`, `/cogs set <sku> <cogs>`, `/cogs clear`

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
- `/daily control today`
- `/daily control yesterday`
- `/daily control 2026-05-14`
- `/daily control в таблицу today`
- `/management daily 2026-05-14`
- `/management daily в таблицу 2026-05-14`
- `/management month 2026-05`
- `/management dashboard 2026-05`
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
- `/cogs template`
- `/cogs status`
- `/cogs set <sku> <cogs>`
- `/cogs clear`
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

## Management workbook mode

Если у пользователя уже есть шаблон workbook с листами:

- `Dashboard`
- `Daily Input`
- `Unit Economics`
- `Month Review`
- `Settings`

бот заполняет только `Daily Input`.

Важно:

- `Dashboard`, `Unit Economics`, `Month Review` и `Settings` считаются формулами внутри шаблона
- бот не делает `clearAndWrite` в эти листы
- `/management daily в таблицу ...` обновляет только строку нужной даты в `Daily Input`
- остальные `/management ... в таблицу` команды возвращают подсказку, что этот лист считается формулами в шаблоне

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
- `COGS Mapping`
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
- `performance_campaigns`: `Campaign ID | Campaign Name | State | Adv Object Type | Payment Type | From Date | To Date | Budget | Daily Budget | Weekly Budget | Placement | Product Campaign Mode | Created At | Updated At`
- `performance_stats`: `Date | Campaign ID | Campaign Name | SKU | Product Name | Price | Impressions | Clicks | CTR | Add To Cart | Avg CPC | Spend | Orders | Revenue | Model Orders | Model Revenue | DRR | Ordered Amount | Total DRR | Added At`
- `cogs_mapping`: `SKU | Offer ID | Product Name | COGS | Logistics To MP | Notes`
- `daily_summary`: `Дата | Выручка | Выплата Ozon | Заказы | Комиссия | Логистика | Реклама | Себестоимость | Прибыль | Маржа | ДРР`
- `daily_control`: `Дата | День | Заказы ₽ | Продажи ₽ | Реклама ₽ | Себестоимость ₽ | Доставка до МП ₽ | ВП ₽ | Маржа ВП % | План ВП/день | Отклонение ₽ | Накоп. ВП ₽ | Run-rate прогноз ₽ | Статус | Комментарий`
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
  "formatting": {
    "boldHeader": true,
    "freezeRows": 1,
    "autoResizeColumns": true,
    "headerBackground": "#000000",
    "headerFontColor": "#ffffff",
    "currencyColumns": ["Budget"],
    "percentColumns": ["CTR"],
    "conditionalColumns": [
      {
        "header": "ВП",
        "positiveBackground": "#d9ead3",
        "negativeBackground": "#f4cccc",
        "neutralBackground": ""
      }
    ]
  },
  "rows": [["..."], ["..."]]
}
```

```json
{
  "action": "clearAndWrite",
  "sheet": "Actual_Tab_Name",
  "headers": ["H1", "H2"],
  "formatting": {
    "boldHeader": true,
    "freezeRows": 1,
    "autoResizeColumns": true,
    "headerBackground": "#000000",
    "headerFontColor": "#ffffff",
    "currencyColumns": ["Spend", "Revenue"],
    "percentColumns": ["CTR", "DRR"],
    "conditionalColumns": [],
    "currencyRows": ["Продажи", "Реклама", "Прибыль", "ВП"],
    "percentRows": ["от заказов", "от продаж"],
    "conditionalRows": [
      {
        "rowLabel": "ВП",
        "positiveBackground": "#d9ead3",
        "negativeBackground": "#f4cccc",
        "neutralBackground": ""
      }
    ]
  },
  "rows": [["..."], ["..."]]
}
```

```json
{
  "action": "updateByDate",
  "sheet": "Actual_Tab_Name",
  "dateColumn": "Дата",
  "date": "2026-05-14",
  "headers": ["Дата", "День"],
  "formatting": {
    "boldHeader": true,
    "freezeRows": 1,
    "autoResizeColumns": true,
    "headerBackground": "#000000",
    "headerFontColor": "#ffffff"
  },
  "row": ["2026-05-14", "ср"]
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
    var formatting = payload.formatting || {};
    var rows = Array.isArray(payload.rows) ? payload.rows : [];
    var width = headers.length || rows.reduce(function(max, row) {
      return Math.max(max, Array.isArray(row) ? row.length : 0);
    }, 0);

    rows = rows.map(function(row) {
      var values = Array.isArray(row) ? row.slice() : [];
      while (values.length < width) values.push("");
      return values.slice(0, width);
    });

    function resolveColumnIndexes(columns) {
      return (Array.isArray(columns) ? columns : []).map(function(entry) {
        if (typeof entry === "number") return entry;
        if (entry && typeof entry === "object" && typeof entry.index === "number") return entry.index;
        if (typeof entry === "string") {
          var indexes = [];
          headers.forEach(function(header, idx) {
            if (header === entry) indexes.push(idx + 1);
          });
          return indexes;
        }
        if (entry && typeof entry === "object" && typeof entry.header === "string") {
          var objectIndexes = [];
          headers.forEach(function(header, idx) {
            if (header === entry.header) objectIndexes.push(idx + 1);
          });
          return objectIndexes;
        }
        return [];
      }).flat().filter(function(value) {
        return typeof value === "number" && value > 0;
      });
    }

    function findRowIndexByLabel(label) {
      for (var i = 0; i < rows.length; i += 1) {
        if (String(rows[i][0] || "") === String(label || "")) {
          return i + 2;
        }
      }
      return null;
    }

    function applySheetFormatting() {
      if (headers.length) {
        var headerRange = sheet.getRange(1, 1, 1, headers.length);
        if (formatting.boldHeader) {
          headerRange.setFontWeight("bold");
        }
        if (formatting.headerBackground) {
          headerRange.setBackground(formatting.headerBackground);
        }
        if (formatting.headerFontColor) {
          headerRange.setFontColor(formatting.headerFontColor);
        }
      }

      if (formatting.freezeRows) {
        sheet.setFrozenRows(formatting.freezeRows);
      }

      if (formatting.autoResizeColumns && width > 0) {
        sheet.autoResizeColumns(1, width);
      }

      if (rows.length && width > 0) {
        var dataRange = sheet.getRange(headers.length ? 2 : 1, 1, rows.length, width);
        var currencyIndexes = resolveColumnIndexes(formatting.currencyColumns);
        var percentIndexes = resolveColumnIndexes(formatting.percentColumns);

        currencyIndexes.forEach(function(columnIndex) {
          sheet.getRange(headers.length ? 2 : 1, columnIndex, rows.length, 1).setNumberFormat('#,##0.00 "₽"');
        });

        percentIndexes.forEach(function(columnIndex) {
          sheet.getRange(headers.length ? 2 : 1, columnIndex, rows.length, 1).setNumberFormat('0.00"%"');
        });

        (Array.isArray(formatting.currencyRows) ? formatting.currencyRows : []).forEach(function(rowLabel) {
          var rowIndex = findRowIndexByLabel(rowLabel);
          if (rowIndex && width > 1) {
            sheet.getRange(rowIndex, 2, 1, width - 1).setNumberFormat('#,##0.00 "₽"');
          }
        });

        (Array.isArray(formatting.percentRows) ? formatting.percentRows : []).forEach(function(rowLabel) {
          var rowIndex = findRowIndexByLabel(rowLabel);
          if (rowIndex && width > 1) {
            sheet.getRange(rowIndex, 2, 1, width - 1).setNumberFormat('0.00"%"');
          }
        });

        (Array.isArray(formatting.conditionalColumns) ? formatting.conditionalColumns : []).forEach(function(rule) {
          var indexes = resolveColumnIndexes([rule]);
          indexes.forEach(function(columnIndex) {
            var values = sheet.getRange(headers.length ? 2 : 1, columnIndex, rows.length, 1).getValues();
            var backgrounds = values.map(function(pair) {
              var value = Number(String(pair[0] || "").replace(",", "."));
              if (!value) return [rule.neutralBackground || null];
              if (value > 0) return [rule.positiveBackground || null];
              return [rule.negativeBackground || null];
            });
            sheet.getRange(headers.length ? 2 : 1, columnIndex, rows.length, 1).setBackgrounds(backgrounds);
          });
        });

        (Array.isArray(formatting.conditionalRows) ? formatting.conditionalRows : []).forEach(function(rule) {
          var rowIndex = findRowIndexByLabel(rule.rowLabel);
          if (rowIndex && width > 1) {
            var rowValues = sheet.getRange(rowIndex, 2, 1, width - 1).getValues()[0];
            var backgrounds = rowValues.map(function(value) {
              var numericValue = Number(String(value || "").replace(",", "."));
              if (!numericValue) return rule.neutralBackground || null;
              if (numericValue > 0) return rule.positiveBackground || null;
              return rule.negativeBackground || null;
            });
            sheet.getRange(rowIndex, 2, 1, width - 1).setBackgrounds([backgrounds]);
          }
        });
      }
    }

    if (payload.action === "replaceRows" || payload.action === "clearAndWrite") {
      sheet.clearContents();
      if (headers.length) {
        var headerRange = sheet.getRange(1, 1, 1, headers.length);
        headerRange.setValues([headers]);
      }
      if (rows.length) {
        sheet.getRange(headers.length ? 2 : 1, 1, rows.length, width).setValues(rows);
      }
      applySheetFormatting();
      return jsonResponse({ ok: true, action: payload.action, rowsWritten: rows.length });
    }

    if (payload.action === "appendRows") {
      if (rows.length) {
        var startRow = Math.max(sheet.getLastRow() + 1, 1);
        sheet.getRange(startRow, 1, rows.length, width).setValues(rows);
        applySheetFormatting();
      }
      return jsonResponse({ ok: true, action: payload.action, rowsWritten: rows.length });
    }

    if (payload.action === "updateByDate") {
      var updateHeaders = headers;
      var dateColumnName = String(payload.dateColumn || "Дата");
      var updateRow = Array.isArray(payload.row) ? payload.row.slice() : [];
      while (updateRow.length < width) updateRow.push("");
      updateRow = updateRow.slice(0, width);

      if (updateHeaders.length) {
        sheet.getRange(1, 1, 1, updateHeaders.length).setValues([updateHeaders]);
      }

      var dateColumnIndex = updateHeaders.indexOf(dateColumnName);
      if (dateColumnIndex === -1) {
        return jsonResponse({ ok: false, error: "Date column not found in headers: " + dateColumnName });
      }

      var lastRow = Math.max(sheet.getLastRow(), 1);
      var existingValues = lastRow > 1
        ? sheet.getRange(2, dateColumnIndex + 1, lastRow - 1, 1).getValues()
        : [];

      function normalizeDateKey(value) {
        if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
          return Utilities.formatDate(value, Session.getScriptTimeZone(), "MM-dd");
        }
        var text = String(value || "").trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(5);
        var ru = text.match(/^(\d{2})\.(\d{2})(?:\.(\d{4}))?$/);
        if (ru) {
          return ru[2] + "-" + ru[1];
        }
        return text;
      }

      var targetDate = normalizeDateKey(payload.date);
      var matchedAs = "";
      var rowIndex = null;
      for (var r = 0; r < existingValues.length; r += 1) {
        var normalizedExistingDate = normalizeDateKey(existingValues[r][0]);
        if (normalizedExistingDate === targetDate) {
          rowIndex = r + 2;
          matchedAs = normalizedExistingDate;
          break;
        }
      }

      var appended = false;
      if (rowIndex === null) {
        rowIndex = Math.max(sheet.getLastRow() + 1, 2);
        appended = true;
      }

      sheet.getRange(rowIndex, 1, 1, width).setValues([updateRow]);
      applySheetFormatting();
      return jsonResponse({
        ok: true,
        action: payload.action,
        rowIndex: rowIndex,
        matchedRow: rowIndex,
        dateMatchedAs: matchedAs || targetDate,
        appended: appended,
        rowsWritten: 1
      });
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
- `clearAndWrite` и `replaceRows` должны очищать sheet, писать headers в строку 1 и данные со строки 2
- `updateByDate` должен сохранять headers, искать строку по колонке `Дата`, обновлять найденную строку и добавлять новую только если дата не найдена
- для `Daily Input` допустимо матчить даты как `DD.MM`, `DD.MM.YYYY`, `YYYY-MM-DD` и Google Sheets Date object
- рекомендуется helper `normalizeDateKey(value)`, который приводит все форматы к `MM-DD` для monthly-шаблона
- `formatting` поддерживает: `boldHeader`, `freezeRows`, `autoResizeColumns`, `headerBackground`, `headerFontColor`, `currencyColumns`, `percentColumns`, `conditionalColumns`, `currencyRows`, `percentRows`, `conditionalRows`
- для dashboard sheets рекомендуется:
  - чёрный header background
  - белый header font color
  - freeze first row
  - auto resize columns
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
- `/daily control today`
- `/daily control в таблицу today`

## How to work with Codex safely

- начинайте с небольших изменений
- сначала читайте текущие сервисы и docs из `docs/`
- не меняйте stable core без тестов
- перед коммитом запускайте:
  - `npm test`
  - `npm run health`
- не коммитьте `.env` и секреты
- не делайте широких переписываний, если задача точечная

Operator docs:

- [docs/AGENT.md](</C:/Users/user/Documents/Codex/2026-05-13/github/ollama-bot/docs/AGENT.md:1>)
- [docs/ROADMAP.md](</C:/Users/user/Documents/Codex/2026-05-13/github/ollama-bot/docs/ROADMAP.md:1>)
- [docs/RUNBOOK.md](</C:/Users/user/Documents/Codex/2026-05-13/github/ollama-bot/docs/RUNBOOK.md:1>)

## Stable Core

Do not change stable core without tests. In practice this includes:

- Telegram command routing
- Google Sheets mapped writes
- Ozon Seller core product flows
- Ozon Performance report lifecycle
- daily summary generation
- startup and PM2 behavior
