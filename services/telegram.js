const TelegramBot = require("node-telegram-bot-api");
const env = require("../config/env");
const { parseDailyCommand } = require("./dailySummary");

const OZON_PRODUCTS_SHEET = "products";
const TELEGRAM_MESSAGE_LIMIT = 4000;

function getHelpText() {
  return [
    "Команды:",
    "/chatid",
    "/health",
    "/daily",
    "/daily вчера",
    "/daily today",
    "/daily 2026-05-13",
    "/daily 2026-05-13 2026-05-14",
    "/daily debug 2026-05-13",
    "/daily raw 2026-05-13",
    "/analytics",
    "/analytics продажи",
    "/analytics реклама",
    "/analytics остатки",
    "/analytics проблемы",
    "/performance campaigns",
    "/performance campaigns active",
    "/performance campaigns debug active",
    "/performance campaigns running",
    "/performance campaigns sku",
    "/performance campaigns search_promo",
    "/performance campaigns banner",
    "/performance campaigns в таблицу",
    "/performance campaigns active в таблицу",
    "/performance stats 2026-05-01 2026-05-14",
    "/performance stats campaign <campaignId> 2026-05-01 2026-05-14",
    "/performance stats test 2026-05-01 2026-05-14",
    "/performance stats активные 2026-05-01 2026-05-14",
    "/performance stats в таблицу 2026-05-01 2026-05-14",
    "/performance objects <campaignId>",
    "/performance limits",
    "/performance minbid <sku>",
    "/performance discover",
    "/performance discover raw",
    "/performance continue",
    "/performance queue",
    "/performance rows status",
    "/performance rows clear",
    "/performance reset",
    "/performance export <requestGroupId>",
    "/performance report <uuid>",
    "/performance report status <uuid>",
    "/performance watch <uuid>",
    "/report pnl 2026-05-01 2026-05-14",
    "/report pnl в таблицу 2026-05-01 2026-05-14",
    "/report sku 2026-05-01 2026-05-14",
    "/report sku в таблицу 2026-05-01 2026-05-14",
    "/cogs template",
    "/cogs status",
    "/cogs set <sku> <cogs>",
    "/cogs clear",
    "/sales fetch 2026-05-13 2026-05-14",
    "/sales status",
    "/sales clear",
    "/finance status",
    "/finance clear",
    "/finance fetch 2026-05-13 2026-05-14",
    "/finance debug 2026-05-13 2026-05-14",
    "/finance import sample",
    "/performance debug",
    "/ai strategy",
    "/ai quick",
    "/ai actions",
    "/ai risks",
    "/ai закупка",
    "/ai реклама",
    "/alerts status",
    "/alerts run",
    "/alerts stop",
    "/alerts settings",
    "/ozon товары",
    "/ozon товары 25",
    "/ozon товары 25 в таблицу",
    "/sheet Лист1 | товар | 10 | комментарий",
    "/jobs status",
    "/jobs run",
    "/jobs stop",
    "/models"
  ].join("\n");
}

function parseAnalyticsCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  const match = normalized.match(/^\/analytics(?:\s+(продажи|реклама|остатки|проблемы))?$/);

  if (!match) return null;

  const topicMap = {
    "продажи": "sales",
    "реклама": "ads",
    "остатки": "stocks",
    "проблемы": "issues"
  };

  return topicMap[match[1]] || "overview";
}

function parsePerformanceCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();

  const commandPatterns = [
    [/^\/performance debug$/, () => ({ type: "debug" })],
    [/^\/performance campaigns debug active$/, () => ({ type: "campaigns_debug", filter: "running" })],
    [/^\/performance(?: queue| pending)$/, () => ({ type: "queue" })],
    [/^\/performance rows status$/, () => ({ type: "rows_status" })],
    [/^\/performance rows clear$/, () => ({ type: "rows_clear" })],
    [/^\/performance discover(?: (raw))?$/, match => ({ type: "discover", raw: Boolean(match[1]) })],
    [/^\/performance continue$/, () => ({ type: "continue" })],
    [/^\/performance reset$/, () => ({ type: "reset" })],
    [/^\/performance limits$/, () => ({ type: "limits" })],
    [/^\/performance objects (\d+)$/, match => ({ type: "objects", campaignId: match[1] })],
    [/^\/performance minbid (\d+)$/, match => ({ type: "minbid", sku: match[1] })],
    [/^\/performance export ([a-z0-9-]+)$/i, match => ({ type: "export", requestGroupId: match[1] })],
    [/^\/performance report status ([a-z0-9-]+)$/i, match => ({ type: "report_status", uuid: match[1] })],
    [/^\/performance report(?: в таблицу)? ([a-z0-9-]+)$/i, match => ({ type: "report", uuid: match[1], toSheet: normalized.includes(" в таблицу ") })],
    [/^\/performance watch ([a-z0-9-]+)$/i, match => ({ type: "watch", uuid: match[1] })],
    [
      /^\/performance campaigns(?: (active|running|sku|search_promo|banner))?(?: в таблицу)?$/,
      match => ({
        type: "campaigns",
        filter:
          match[1] === "active" || match[1] === "running"
            ? "running"
            : match[1] || "",
        toSheet: normalized.endsWith(" в таблицу")
      })
    ],
    [
      /^\/performance stats campaign (\d+) (\d{4}-\d{2}-\d{2}) (\d{4}-\d{2}-\d{2})$/,
      match => ({
        type: "stats_campaign",
        campaignId: match[1],
        dateFrom: match[2],
        dateTo: match[3]
      })
    ],
    [
      /^\/performance stats test (\d{4}-\d{2}-\d{2}) (\d{4}-\d{2}-\d{2})$/,
      match => ({
        type: "stats_test",
        dateFrom: match[1],
        dateTo: match[2]
      })
    ],
    [
      /^\/performance stats(?: (активные))?(?: в таблицу)? (\d{4}-\d{2}-\d{2}) (\d{4}-\d{2}-\d{2})$/,
      match => ({
        type: "stats",
        activeOnly: Boolean(match[1]),
        toSheet: normalized.includes(" в таблицу "),
        dateFrom: match[2],
        dateTo: match[3]
      })
    ]
  ];

  for (const [pattern, build] of commandPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      return build(match);
    }
  }

  return null;
}

function parseAiCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  const match = normalized.match(/^\/ai\s+(strategy|quick|actions|risks|закупка|реклама)$/);

  if (!match) return null;

  const modeMap = {
    "strategy": "strategy",
    "quick": "quick",
    "actions": "actions",
    "risks": "risks",
    "закупка": "purchase",
    "реклама": "ads"
  };

  return modeMap[match[1]] || null;
}

function parseReportCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  const match = normalized.match(
    /^\/report\s+(pnl|sku)(?:\s+в\s+таблицу)?\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/
  );

  if (!match) return null;

  return {
    type: match[1],
    toSheet: normalized.includes(" в таблицу "),
    dateFrom: match[2],
    dateTo: match[3]
  };
}

function parseAlertsCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  const match = normalized.match(/^\/alerts\s+(status|run|stop|settings)$/);
  return match ? match[1] : null;
}

function isCoderCommand(text) {
  const normalized = text.trim().toLowerCase();

  return (
    normalized.startsWith("/код") ||
    normalized.startsWith("/code") ||
    normalized.startsWith("/исправь") ||
    normalized.startsWith("/объясни") ||
    normalized.startsWith("/создай") ||
    normalized.startsWith("/coder")
  );
}

function parseOzonProductsCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ");
  const match = normalized.match(/^\/ozon\s+товары(?:\s+(\d+))?(?:\s+в\s+таблицу)?$/i);

  if (!match) return null;

  return {
    limit: match[1] ? Number(match[1]) : 10,
    toSheet: /\sв\sтаблицу$/i.test(normalized)
  };
}

function productToSheetRow(product) {
  return [
    product.name ?? "",
    product.sku ?? product.offerId ?? product.productId ?? "",
    product.offerId ?? "",
    product.price ?? "",
    product.stock ?? ""
  ];
}

function formatOzonProducts(products) {
  return products
    .map((product, index) => {
      const row = productToSheetRow(product);

      return (
        index + 1 +
        ". Название: " +
        (row[0] === "" ? "-" : row[0]) +
        "\nSKU: " +
        (row[1] === "" ? "-" : row[1]) +
        "\nЦена: " +
        (row[2] === "" ? "-" : row[2]) +
        "\nОстаток: " +
        (row[3] === "" ? "-" : row[3])
      );
    })
    .join("\n\n");
}

function formatModelsInfo(ollamaModels, ollamaStatus) {
  const lines = [
    "Chat model: " + ollamaModels.chat,
    "Fast model: " + (ollamaModels.fast || "-"),
    "Coder model: " + ollamaModels.coder,
    "Analytics model: " + ollamaModels.analytics,
    "Ollama: " + (ollamaStatus.ok ? "online" : "offline")
  ];

  if (ollamaStatus.ok && ollamaStatus.availableModels.length) {
    lines.push("Available: " + ollamaStatus.availableModels.join(", "));
  }

  if (!ollamaStatus.ok && ollamaStatus.error) {
    lines.push("Error: " + ollamaStatus.error);
  }

  return lines.join("\n");
}

function formatPerformanceRows(rows) {
  if (!rows.length) {
    return "Данные Performance API не найдены.";
  }

  return rows
    .slice(0, 20)
    .map(row => {
      return [
        "Дата: " + (row.date || "-"),
        "Campaign ID: " + (row.campaignId || "-"),
        "Campaign Name: " + (row.campaignName || "-"),
        "SKU: " + (row.sku || "-"),
        "Показы: " + (row.impressions ?? "-"),
        "Клики: " + (row.clicks ?? "-"),
        "CTR: " + (row.ctr ?? "-"),
        "CPC: " + (row.avgCpc ?? "-"),
        "Расход: " + (row.spend ?? "-"),
        "Заказы: " + (row.orders ?? "-"),
        "Выручка: " + (row.revenue ?? "-"),
        "ДРР: " + (row.drr ?? "-"),
        "ROAS: " + (row.roas ?? "-")
      ].join("\n");
    })
    .join("\n\n");
}

function formatPerformanceCampaigns(rows) {
  if (!rows.length) {
    return "Кампании Performance API не найдены.";
  }

  return rows
    .slice(0, 20)
    .map(row => {
      return [
        "Campaign ID: " + (row.campaignId || "-"),
        "Campaign Name: " + (row.campaignName || "-"),
        "State: " + (row.status || "-"),
        "Type: " + (row.advObjectType || "-"),
        "Payment Type: " + (row.paymentType ?? ""),
        "From Date: " + (row.fromDate || "-"),
        "Weekly Budget: " + (row.weeklyBudget === "" ? "-" : row.weeklyBudget),
        "Placement: " + (row.placement || "-")
      ].join("\n");
    })
    .join("\n\n");
}

function formatPerformanceObjects(campaignId, objects) {
  if (!objects.length) {
    return "Для кампании " + campaignId + " объекты не найдены.";
  }

  return objects
    .slice(0, 20)
    .map(item => JSON.stringify(item, null, 2))
    .join("\n\n");
}

function formatPerformanceLimits(rows) {
  if (!rows.length) {
    return "Лимиты ставок Performance API не найдены.";
  }

  return rows
    .slice(0, 20)
    .map(row => {
      return [
        "Type: " + (row.objectType || row.advObjectType || "-"),
        "Payment: " + (row.paymentMethod || row.paymentType || "-"),
        "Min Bid: " + (row.minBid ?? "-"),
        "Max Bid: " + (row.maxBid ?? "-")
      ].join("\n");
    })
    .join("\n\n");
}

function formatMinBidResponse(sku, data) {
  const rows = data.list || data.items || data.result || data.sku || [];

  if (Array.isArray(rows) && rows.length) {
    return rows
      .map(item => {
        return [
          "SKU: " + (item.sku || sku),
          "Min Bid: " + (item.minBid ?? item.bid ?? "-"),
          "Payment Type: " + (item.paymentType || "CPC"),
          "Marketplace: " + (item.marketplaceId || "MARKETPLACE_ID_RU")
        ].join("\n");
      })
      .join("\n\n");
  }

  return "SKU: " + sku + "\n" + JSON.stringify(data, null, 2);
}

function getCampaignFilters(filter) {
  if (filter === "running") {
    return { state: "CAMPAIGN_STATE_RUNNING" };
  }

  if (filter === "sku") {
    return { advObjectType: "SKU" };
  }

  if (filter === "search_promo") {
    return { advObjectType: "SEARCH_PROMO" };
  }

  if (filter === "banner") {
    return { advObjectType: "BANNER" };
  }

  return {};
}

function formatQueueItems(reports) {
  const lines = [];
  const queueMeta = reports.meta || {};

  if (queueMeta.lastActiveLimitAt) {
    lines.push("Last active-limit: " + queueMeta.lastActiveLimitAt);
  }

  if (!reports.items.length) {
    lines.push("Очередь Performance пуста.");
    return lines.join("\n");
  }

  return lines.concat(
    reports.items
    .slice(0, 20)
    .map(item => {
      return [
        "UUID: " + (item.uuid || "-"),
        "Request Group: " + (item.requestGroupId || "-"),
        "Type: stats",
        "Range: " + (item.dateFrom || "-") + " -> " + (item.dateTo || "-"),
        "Status: " + (item.status || "-"),
        "Chunk: " + (item.chunkIndex || "-") + "/" + (item.totalChunks || "-")
      ].join("\n");
    })
  ).join("\n\n");
}

function formatDiscoveredReports(reports) {
  if (!reports.length) {
    return "Активные или недавние отчёты Performance на стороне Ozon не найдены.";
  }

  return reports
    .slice(0, 20)
    .map(report => {
      return [
        "UUID: " + (report.uuid || "-"),
        "Status: " + (report.status || "unknown"),
        "Created: " + (report.createdAt || "-"),
        "Range: " + (report.dateFrom || "-") + " -> " + (report.dateTo || "-"),
        "Type: " + (report.reportType || "-")
      ].join("\n");
    })
    .join("\n\n");
}

function formatPerformanceSummary(summary, uuid) {
  return [
    "UUID: " + uuid,
    "Rows: " + summary.rows,
    "Impressions: " + summary.impressions,
    "Clicks: " + summary.clicks,
    "Spend: " + summary.spend,
    "Orders: " + summary.orders,
    "Revenue: " + summary.revenue
  ].join("\n");
}

function formatPendingReportStatus(status) {
  const age = status.ageMinutes === null ? "неизвестно" : String(status.ageMinutes);
  const retries = status.retries ?? 0;
  const lastKnownStatus = status.rawStatus || status.status || "IN_PROGRESS";
  const lines = [
    "Отчёт готовится уже " + age + " минут. Последний статус: " + lastKnownStatus,
    "UUID: " + status.uuid,
    "Проверок: " + retries
  ];

  if (typeof status.ageMinutes === "number" && status.ageMinutes > 15) {
    lines.push("Подсказка: попробуй меньший диапазон дат.");
    lines.push("Подсказка: проверь, была ли активность у кампании.");
  }

  return lines.join("\n");
}

function formatCreatedReports(created) {
  const lines = [];

  if (created.campaignsCount > 10) {
    lines.push("Найдено " + created.campaignsCount + " кампаний. Создаю отчёты пачками по 10.");
  }
  if (created.startedFirst) {
    lines.push(
      "Создан первый отчёт 1/" +
        created.totalChunks +
        ". Остальные поставлены в очередь. Используй /performance continue."
    );
  } else {
    if (created.recovered?.recovered && created.recovered.report?.uuid) {
      lines.push(
        "Найден активный отчёт Ozon, восстановил очередь. Используй /performance continue."
      );
      lines.push("UUID активного отчёта: " + created.recovered.report.uuid);
    } else {
      lines.push(
        "Активный отчёт уже существует. Новые chunk-отчёты поставлены в очередь. Используй /performance continue."
      );
    }
  }
  lines.push("Request Group: " + created.requestGroupId);
  if (created.firstItem?.uuid) {
    lines.push("UUID первого отчёта: " + created.firstItem.uuid);
  }

  return lines.join("\n");
}

function formatHealthInfo() {
  return [
    "bot online",
    "server time: " + new Date().toISOString(),
    "",
    "TELEGRAM_BOT_TOKEN: " + (env.telegramBotToken ? "ok" : "missing"),
    "OZON_CLIENT_ID: " + (env.ozonClientId ? "ok" : "missing"),
    "OZON_API_KEY: " + (env.ozonApiKey ? "ok" : "missing"),
    "GOOGLE_SHEETS_WEBAPP_URL: " + (env.googleSheetsWebappUrl ? "ok" : "missing"),
    "OLLAMA_CHAT_MODEL: " + env.ollamaModels.chat,
    "STABLE_MODE: " + (process.env.STABLE_MODE || "")
  ].join("\n");
}

function parseCogsCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ");
  let match = normalized.match(/^\/cogs\s+(template|status|clear)$/i);
  if (match) {
    return { type: match[1].toLowerCase() };
  }

  match = normalized.match(/^\/cogs\s+set\s+(\S+)\s+([0-9]+(?:[.,][0-9]+)?)$/i);
  if (match) {
    return {
      type: "set",
      sku: match[1],
      cogs: match[2]
    };
  }

  return null;
}

function parseSalesCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ");
  let match = normalized.match(/^\/sales\s+(status|clear)$/i);
  if (match) {
    return { type: match[1].toLowerCase() };
  }

  match = normalized.match(/^\/sales\s+fetch\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/i);
  if (match) {
    return {
      type: "fetch",
      dateFrom: match[1],
      dateTo: match[2]
    };
  }

  return null;
}

function parseFinanceCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ");
  let match = normalized.match(/^\/finance\s+(status|clear|import sample)$/i);
  if (match) {
    if (match[1].toLowerCase() === "import sample") {
      return { type: "import_sample" };
    }
    return { type: match[1].toLowerCase() };
  }

  match = normalized.match(/^\/finance\s+(fetch|debug)\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/i);
  if (match) {
    return {
      type: match[1].toLowerCase(),
      dateFrom: match[2],
      dateTo: match[3]
    };
  }

  return null;
}

function formatStoredRowsStatus(status) {
  return [
    "Performance rows status",
    "Total stored rows: " + status.totalStoredRows,
    "Min date: " + (status.minDate || "-"),
    "Max date: " + (status.maxDate || "-"),
    "Unique campaigns: " + status.uniqueCampaigns,
    "Unique SKUs: " + status.uniqueSkus
  ].join("\n");
}

function formatPnlReport(report) {
  const previewRows = report.rows.slice(0, 9);
  return [
    "P&L Summary",
    "Период: " + report.dateFrom + " -> " + report.dateTo,
    "",
    ...previewRows.map(row => row.join(" | ")),
    "",
    ...(report.warnings || []),
    "",
    report.missingFieldsNote
  ].join("\n");
}

function formatSkuReport(report) {
  if (!report.rows.length) {
    return "SKU Dashboard пуст за выбранный период.\n\n" + report.missingFieldsNote;
  }

  return [
    "SKU Dashboard",
    "Период: " + report.dateFrom + " -> " + report.dateTo,
    "",
    ...report.rows.slice(0, 10).map(row =>
      [
        "Название: " + (row[0] || "-"),
        "Артикул: " + (row[5] || "-"),
        "Себ: " + (row[4] || 0),
        "Рубли: " + (row[6] || 0),
        "Штуки: " + (row[7] || 0),
        "Реклама: " + (row[9] || 0),
        "ДРР: " + (row[10] || 0),
        "Показы: " + (row[17] || 0),
        "Клики: " + (row[19] || 0),
        "CTR: " + (row[20] || 0)
      ].join("\n")
    ),
    "",
    ...(report.warnings || []),
    report.missingFieldsNote
  ].join("\n\n");
}

function formatCogsTemplate() {
  return [
    "COGS Mapping columns:",
    "SKU",
    "Offer ID",
    "Product Name",
    "COGS",
    "Logistics To MP",
    "Notes"
  ].join("\n");
}

function formatCogsStatus(status) {
  return [
    "COGS status",
    "Configured SKUs: " + status.totalConfiguredSkus,
    "Total items: " + status.totalItems
  ].join("\n");
}

function formatSalesStatus(status) {
  return [
    "Sales facts status",
    "Total stored rows: " + status.totalStoredRows,
    "Min date: " + (status.minDate || "-"),
    "Max date: " + (status.maxDate || "-"),
    "Unique SKUs: " + status.uniqueSkus
  ].join("\n");
}

function formatFinanceStatus(status) {
  return [
    "Finance facts status",
    "Total stored rows: " + status.totalStoredRows,
    "Min date: " + (status.minDate || "-"),
    "Max date: " + (status.maxDate || "-")
  ].join("\n");
}

function formatFinanceFetchResult(saved, summary) {
  return [
    "Finance facts saved",
    "Rows saved: " + saved.rowsSaved,
    "Total stored rows: " + saved.totalStoredRows,
    "Transaction count: " + summary.transactionCount,
    "Accrued total: " + summary.accruedTotal
  ].join("\n");
}

function formatFinanceDiagnostics(result) {
  const lines = [
    "Finance diagnostics",
    "Период: " + result.dateFrom + " -> " + result.dateTo,
    "Транзакций: " + result.diagnostics.transactionCount,
    ""
  ];

  if (!result.diagnostics.groupedOperations.length) {
    lines.push("Нет finance операций за период.");
    return lines.join("\n");
  }

  lines.push("Grouped operation types:");
  lines.push(
    ...result.diagnostics.groupedOperations.slice(0, 20).map(item =>
      item.key + " | count=" + item.count + " | total=" + item.totalAmount
    )
  );

  if (result.diagnostics.advertisingGroups?.length) {
    lines.push("");
    lines.push("Advertising classification:");
    lines.push(
      ...result.diagnostics.advertisingGroups.slice(0, 20).map(item =>
        item.key + " | total=" + item.totalAmount
      )
    );
  }

  return lines.join("\n");
}

function formatSalesFetchResult(saved, summary, warning) {
  const lines = [
    "Sales facts saved",
    "Rows saved: " + saved.rowsSaved,
    "Total stored rows: " + saved.totalStoredRows,
    "Unique SKUs: " + summary.uniqueSkus,
    "Total revenue: " + summary.totalRevenue,
    "Total quantity: " + summary.totalQuantity
  ];

  if (warning) {
    lines.push(warning);
  }

  return lines.join("\n");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendLongMessage(bot, chatId, text) {
  const parts = [];

  for (let index = 0; index < text.length; index += TELEGRAM_MESSAGE_LIMIT) {
    parts.push(text.slice(index, index + TELEGRAM_MESSAGE_LIMIT));
  }

  if (!parts.length) {
    parts.push("Нет ответа.");
  }

  for (const part of parts) {
    await bot.sendMessage(chatId, part);
  }
}

function startTelegramBot({
  analyticsService,
  alertsService,
  cogsService,
  dailySummaryService,
  decisionEngine,
  financeFactsService,
  performanceService,
  reportBuilderService,
  salesFactsService,
  token,
  jobsService,
  ollamaService,
  ozonService,
  sheetsService,
  logger = console
}) {
  if (!token) {
    logger.log("Telegram token not found. Telegram bot disabled.");
    return null;
  }

  const tgBot = new TelegramBot(token, { polling: true });
  let lastChatId = null;
  const activeWatches = new Map();

  async function sendText(chatId, text) {
    await sendLongMessage(tgBot, chatId, text);
  }

  async function sendDocument(chatId, filePath, options = {}) {
    return tgBot.sendDocument(chatId, filePath, options);
  }

  function getPrimaryChatId() {
    return lastChatId;
  }

  alertsService.setNotifier(async message => {
    if (!lastChatId) return;
    await sendText(lastChatId, message);
  });

  tgBot.onText(/\/start/, async msg => {
    await tgBot.sendMessage(
      msg.chat.id,
      "Привет! Я твой локальный ИИ-бот.\n\n" + getHelpText()
    );
  });

  tgBot.on("message", async msg => {
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();
    lastChatId = chatId;

    if (!text || text.startsWith("/start")) return;

    if (text === "/chatid") {
      await tgBot.sendMessage(chatId, "Your chat id: " + msg.chat.id);
      return;
    }

    if (text === "/health") {
      await sendLongMessage(tgBot, chatId, formatHealthInfo());
      return;
    }

    if (text.startsWith("/sheet ")) {
      try {
        const raw = text.replace("/sheet ", "").trim();
        const parts = raw.split("|").map(x => x.trim());

        const sheetName = parts[0] || "Лист1";
        const row = parts.slice(1);

        if (!row.length) {
          await tgBot.sendMessage(chatId, "Формат: /sheet Лист1 | товар | 10 | комментарий");
          return;
        }

        await sheetsService.addRow(sheetName, row);
        await tgBot.sendMessage(chatId, "Записал строку в Google Таблицу: " + sheetName + " ✅");
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка записи в таблицу: " + err.message);
      }

      return;
    }

    if (text === "/jobs status") {
      await sendLongMessage(tgBot, chatId, jobsService.formatStatus());
      return;
    }

    if (text === "/jobs stop") {
      jobsService.stop();
      await tgBot.sendMessage(chatId, "Фоновые jobs остановлены.");
      return;
    }

    if (text === "/jobs run") {
      try {
        await tgBot.sendMessage(chatId, "Запускаю jobs вручную...");
        const result = await jobsService.runAll();
        const products = result.products.error
          ? "ошибка: " + result.products.error
          : "строк: " + result.products.rows;
        const stocks = result.stocks.error
          ? "ошибка: " + result.stocks.error
          : "строк: " + result.stocks.rows;

        await tgBot.sendMessage(
          chatId,
          "Jobs завершены.\n\nProducts: " + products + "\nStocks: " + stocks
        );
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка jobs: " + err.message);
      }

      return;
    }

    const alertsCommand = parseAlertsCommand(text);

    if (alertsCommand === "status") {
      await sendLongMessage(tgBot, chatId, alertsService.formatStatus());
      return;
    }

    if (alertsCommand === "settings") {
      await sendLongMessage(tgBot, chatId, alertsService.formatSettings());
      return;
    }

    if (alertsCommand === "stop") {
      alertsService.stop();
      await tgBot.sendMessage(chatId, "Alerts остановлены.");
      return;
    }

    if (alertsCommand === "run") {
      try {
        await tgBot.sendMessage(chatId, "Запускаю alerts вручную...");
        const result = await alertsService.runChecks();
        await sendLongMessage(
          tgBot,
          chatId,
          "Alerts завершены.\n\nВсего: " +
            result.alerts.length +
            "\nВажных: " +
            result.significantAlerts.length +
            "\nДубликат: " +
            (result.duplicate ? "да" : "нет")
        );
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка alerts: " + err.message);
      }

      return;
    }

    if (text === "/models") {
      const ollamaModels = ollamaService.getModels();
      const ollamaStatus = await ollamaService.getStatus();
      await sendLongMessage(tgBot, chatId, formatModelsInfo(ollamaModels, ollamaStatus));
      return;
    }

    const dailyCommand = parseDailyCommand(text);

    if (dailyCommand) {
      if (dailyCommand.kind === "invalid") {
        await tgBot.sendMessage(chatId, dailyCommand.error);
        return;
      }

      try {
        if (dailyCommand.kind === "debug" || dailyCommand.kind === "raw") {
          await tgBot.sendMessage(chatId, "Собираю diagnostics по Ozon...");
          const result = await dailySummaryService.generateDiagnosticsReport(
            dailyCommand.dateFrom,
            dailyCommand.dateTo,
            { rawOnly: dailyCommand.kind === "raw" }
          );
          await sendLongMessage(tgBot, chatId, result.reportText);
          return;
        }

        await tgBot.sendMessage(chatId, "Готовлю дневной P&L отчёт...");
        const result = await dailySummaryService.generateDailySummary(
          dailyCommand.dateFrom,
          dailyCommand.dateTo
        );

        const deliveredHere = String(result.targetChatId || "") === String(chatId);

        if (!deliveredHere) {
          await sendLongMessage(tgBot, chatId, result.reportText);
        }

        await tgBot.sendMessage(
          chatId,
          "Daily summary готов.\nФайл: " +
            result.reportPath +
            "\nОтправлено в Telegram: " +
            (result.sentToTelegram ? "да" : "нет")
        );
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка daily summary: " + err.message);
      }

      return;
    }

    const analyticsTopic = parseAnalyticsCommand(text);

    if (analyticsTopic) {
      try {
        await tgBot.sendMessage(chatId, "Собираю данные Ozon и запускаю DeepSeek-анализ...");
        const result = await analyticsService.analyze(analyticsTopic);
        await sendLongMessage(tgBot, chatId, result.reply);
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка аналитики: " + err.message);
      }

      return;
    }

    const performanceCommand = parsePerformanceCommand(text);

    if (performanceCommand) {
      try {
        switch (performanceCommand.type) {
          case "debug": {
            const debug = await performanceService.debugSummary();
            await sendLongMessage(tgBot, chatId, JSON.stringify(debug, null, 2));
            return;
          }
          case "queue": {
            await sendLongMessage(
              tgBot,
              chatId,
              formatQueueItems({
                items: performanceService.listQueue(),
                meta: performanceService.getQueueMeta()
              })
            );
            return;
          }
          case "discover": {
            if (!performanceService.isConfigured()) {
              await tgBot.sendMessage(
                chatId,
                "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
              );
              return;
            }

            if (performanceCommand.raw) {
              const raw = await performanceService.getStatisticsListRaw(1, 100);
              await sendLongMessage(
                tgBot,
                chatId,
                JSON.stringify(raw, null, 2).slice(0, 4000)
              );
              return;
            }

            const reports = await performanceService.discoverRemoteReports(10);
            const recovered = await performanceService.discoverAndRecoverRemoteReport();
            let text = formatDiscoveredReports(reports);

            if (recovered.recovered) {
              text =
                "Найден активный отчёт Ozon, восстановил очередь. Используй /performance continue.\n\n" +
                text;
            }

            await sendLongMessage(tgBot, chatId, text);
            return;
          }
          case "reset": {
            performanceService.resetQueue();
            await tgBot.sendMessage(
              chatId,
              "Локальная очередь очищена, но активный отчёт на стороне Ozon может ещё готовиться. Используй /performance discover."
            );
            return;
          }
          case "continue": {
            const result = await performanceService.continueQueue();

            if (result.state === "empty") {
              await tgBot.sendMessage(chatId, "Очередь Performance пуста.");
              return;
            }

            if (result.state === "recovered") {
              await tgBot.sendMessage(
                chatId,
                "Найден активный отчёт Ozon, восстановил очередь. Используй /performance continue."
              );
              return;
            }

            if (result.state === "recovered_ready") {
              await tgBot.sendMessage(
                chatId,
                "Найден готовый отчёт Ozon, восстановил очередь. Повтори /performance continue, чтобы обработать его."
              );
              return;
            }

            if (result.state === "pending") {
              await tgBot.sendMessage(chatId, "Текущий отчёт ещё готовится.");
              return;
            }

            if (result.state === "started") {
              await tgBot.sendMessage(chatId, "Запущен следующий отчёт: " + result.current.uuid);
              return;
            }

            if (result.state === "active_limit") {
              await tgBot.sendMessage(
                chatId,
                "Текущий chunk завершён, но Ozon всё ещё держит лимит активных запросов. Повтори /performance continue позже."
              );
              return;
            }

            await tgBot.sendMessage(
              chatId,
              result.next
                ? "Chunk " +
                    result.completed.chunkIndex +
                    "/" +
                    result.completed.totalChunks +
                    " готов. Запущен следующий отчёт: " +
                    result.next.uuid
                : "Chunk " +
                    result.completed.chunkIndex +
                    "/" +
                    result.completed.totalChunks +
                    " готов. В очереди больше нет chunk-ов."
            );
            return;
          }
          case "rows_status": {
            await sendLongMessage(
              tgBot,
              chatId,
              formatStoredRowsStatus(performanceService.getStoredRowsStatus())
            );
            return;
          }
          case "rows_clear": {
            performanceService.clearStoredRows();
            await tgBot.sendMessage(chatId, "Локальные строки Performance очищены.");
            return;
          }
          case "campaigns": {
            if (!performanceService.isConfigured()) {
              await tgBot.sendMessage(
                chatId,
                "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
              );
              return;
            }

            await tgBot.sendMessage(chatId, "Забираю кампании Performance API...");
            const filters = getCampaignFilters(performanceCommand.filter);

            if (performanceCommand.toSheet) {
              const campaigns = await performanceService.getCampaigns(filters);

              try {
                const result = await performanceService.writeCampaignRowsToMappedSheet(campaigns);
                await tgBot.sendMessage(
                  chatId,
                  "Записал " + result.rowsWritten + " строк в " + result.tabName
                );
              } catch (sheetError) {
                await tgBot.sendMessage(
                  chatId,
                  "Performance data was received but Sheets write failed: " + sheetError.message
                );
              }

              return;
            }

            const rows = await performanceService.getCampaigns(filters);
            await sendLongMessage(tgBot, chatId, formatPerformanceCampaigns(rows));
            return;
          }
          case "campaigns_debug": {
            if (!performanceService.isConfigured()) {
              await tgBot.sendMessage(
                chatId,
                "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
              );
              return;
            }

            const filters = getCampaignFilters(performanceCommand.filter);
            const rows = await performanceService.getCampaigns(filters);
            await sendLongMessage(
              tgBot,
              chatId,
              JSON.stringify(rows.slice(0, 3), null, 2)
            );
            return;
          }
          case "objects": {
            const campaigns = await performanceService.getCampaigns({
              pageSize: 100,
              campaignIds: [performanceCommand.campaignId]
            });
            const campaign = campaigns.find(item => item.campaignId === performanceCommand.campaignId);

            if (campaign && campaign.advObjectType === "SEARCH_PROMO") {
              await tgBot.sendMessage(
                chatId,
                "For SEARCH_PROMO campaigns another products endpoint is required and will be added separately."
              );
              return;
            }

            const objects = await performanceService.getCampaignObjects(performanceCommand.campaignId);
            await sendLongMessage(
              tgBot,
              chatId,
              "Campaign ID: " +
                performanceCommand.campaignId +
                "\n\n" +
                formatPerformanceObjects(performanceCommand.campaignId, objects)
            );
            return;
          }
          case "limits": {
            const limits = await performanceService.getBidLimits();
            await sendLongMessage(tgBot, chatId, formatPerformanceLimits(limits));
            return;
          }
          case "minbid": {
            const result = await performanceService.getMinBidBySku(performanceCommand.sku);
            await sendLongMessage(tgBot, chatId, formatMinBidResponse(performanceCommand.sku, result));
            return;
          }
          case "stats": {
            if (!performanceService.isConfigured()) {
              await tgBot.sendMessage(
                chatId,
                "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
              );
              return;
            }

            if (performanceCommand.toSheet) {
              const created = await performanceService.createStatsQueue({
                dateFrom: performanceCommand.dateFrom,
                dateTo: performanceCommand.dateTo,
                activeOnly: performanceCommand.activeOnly,
                toSheet: true
              });
              await sendLongMessage(tgBot, chatId, formatCreatedReports(created));
              await tgBot.sendMessage(
                chatId,
                "Когда все chunk-отчёты будут готовы, используй /performance export " +
                  created.requestGroupId
              );
              return;
            }

            const created = await performanceService.createStatsQueue({
              dateFrom: performanceCommand.dateFrom,
              dateTo: performanceCommand.dateTo,
              activeOnly: performanceCommand.activeOnly,
              toSheet: false
            });
            await sendLongMessage(tgBot, chatId, formatCreatedReports(created));
            return;
          }
          case "stats_campaign": {
            if (!performanceService.isConfigured()) {
              await tgBot.sendMessage(
                chatId,
                "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
              );
              return;
            }

            const report = await performanceService.createSingleCampaignStatsReport({
              campaignId: performanceCommand.campaignId,
              dateFrom: performanceCommand.dateFrom,
              dateTo: performanceCommand.dateTo
            });

            await tgBot.sendMessage(
              chatId,
              "Создал отчёт Performance для кампании " +
                performanceCommand.campaignId +
                ". UUID: " +
                report.uuid +
                "\nИспользуй /performance report " +
                report.uuid
            );
            return;
          }
          case "stats_test": {
            if (!performanceService.isConfigured()) {
              await tgBot.sendMessage(
                chatId,
                "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
              );
              return;
            }

            const result = await performanceService.createTestStatsReport({
              dateFrom: performanceCommand.dateFrom,
              dateTo: performanceCommand.dateTo
            });

            await tgBot.sendMessage(
              chatId,
              "Создал test-отчёт для кампании " +
                result.campaign.campaignId +
                " (" +
                (result.campaign.campaignName || "-") +
                "). UUID: " +
                result.report.uuid +
                "\nИспользуй /performance report " +
                result.report.uuid
            );
            return;
          }
          case "watch": {
            if (!performanceService.isConfigured()) {
              await tgBot.sendMessage(
                chatId,
                "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
              );
              return;
            }

            if (activeWatches.has(performanceCommand.uuid)) {
              await tgBot.sendMessage(chatId, "Наблюдение за этим UUID уже запущено.");
              return;
            }

            activeWatches.set(performanceCommand.uuid, true);
            await tgBot.sendMessage(chatId, "Запустил наблюдение за отчётом " + performanceCommand.uuid + " на 10 минут.");

            void (async () => {
              const startedAt = Date.now();

              try {
                while (Date.now() - startedAt < 10 * 60 * 1000) {
                  let status;

                  try {
                    status = await performanceService.getReportStatus(performanceCommand.uuid, {
                      bypassThrottle: true
                    });
                  } catch (error) {
                    if (error.code === "PERFORMANCE_REPORT_PENDING") {
                      status = null;
                    } else {
                      throw error;
                    }
                  }

                  if (status && status.ready) {
                    const resolved = await performanceService.resolveReport(performanceCommand.uuid);
                    const summary = performanceService.summarizeStats(resolved.rows);
                    await sendLongMessage(
                      tgBot,
                      chatId,
                      "Отчёт готов.\n\n" + formatPerformanceSummary(summary, performanceCommand.uuid)
                    );
                    return;
                  }

                  await delay(30 * 1000);
                }

                await tgBot.sendMessage(
                  chatId,
                  "Отчёт всё ещё не готов. Попробуй позже через /performance report " + performanceCommand.uuid
                );
              } catch (error) {
                await tgBot.sendMessage(
                  chatId,
                  "Ошибка Performance watch: " + error.message
                );
              } finally {
                activeWatches.delete(performanceCommand.uuid);
              }
            })();

            return;
          }
          case "export": {
            const result = await performanceService.exportGroup(performanceCommand.requestGroupId);

            if (!result.ok) {
              await tgBot.sendMessage(
                chatId,
                "Не все chunk-отчёты готовы. Не хватает:\n" +
                  result.missing
                    .map(item => "chunk " + item.chunkIndex + "/" + item.totalChunks + " | UUID: " + (item.uuid || "-"))
                    .join("\n")
              );
              return;
            }

            await tgBot.sendMessage(
              chatId,
              "Записал " + result.writeResult.rowsWritten + " строк в " + result.writeResult.tabName
            );
            return;
          }
          case "report_status": {
            if (!performanceService.isConfigured()) {
              await tgBot.sendMessage(
                chatId,
                "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
              );
              return;
            }

            const diagnostics = await performanceService.getReportDiagnostics(performanceCommand.uuid);
            await sendLongMessage(
              tgBot,
              chatId,
              JSON.stringify(diagnostics, null, 2).slice(0, 4000)
            );
            return;
          }
          case "report": {
            if (!performanceService.isConfigured()) {
              await tgBot.sendMessage(
                chatId,
                "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
              );
              return;
            }

            const status = await performanceService.getReportStatus(performanceCommand.uuid, {
              bypassThrottle: performanceCommand.toSheet
            });

            if (!status.ready) {
              await sendLongMessage(tgBot, chatId, formatPendingReportStatus(status));
              return;
            }

            await tgBot.sendMessage(chatId, "Отчёт готов, скачиваю...");
            if (performanceCommand.toSheet) {
              const exported = await performanceService.exportReport(performanceCommand.uuid);
              await tgBot.sendMessage(
                chatId,
                "Записал " + exported.writeResult.rowsWritten + " строк в " + exported.writeResult.tabName
              );
              return;
            }

            const resolved = await performanceService.resolveReport(performanceCommand.uuid);
            const summary = performanceService.summarizeStats(resolved.rows);

            await sendLongMessage(
              tgBot,
              chatId,
              formatPerformanceSummary(summary, performanceCommand.uuid) +
                "\n\n" +
                formatPerformanceRows(resolved.rows)
            );
            return;
          }
          default:
            return;
        }
      } catch (err) {
        if (performanceCommand.type === "report" && err.code === "PERFORMANCE_REPORT_PENDING") {
          await tgBot.sendMessage(chatId, "Отчёт Performance ещё готовится. Повтори команду через 1-2 минуты.");
          return;
        }

        if ((performanceCommand.type === "report" || performanceCommand.type === "report_status") && err.code === "PERFORMANCE_REPORT_POLL_THROTTLED") {
          await tgBot.sendMessage(chatId, err.message);
          return;
        }

        if (performanceCommand.type === "stats" && err.code === "PERFORMANCE_ACTIVE_LIMIT") {
          const recovered = await performanceService.discoverAndRecoverRemoteReport();

          if (recovered.recovered && recovered.report?.uuid) {
            await tgBot.sendMessage(
              chatId,
              "Найден активный отчёт Ozon, восстановил очередь. Используй /performance continue.\nUUID: " +
                recovered.report.uuid
            );
            return;
          }

          await tgBot.sendMessage(
            chatId,
            "Ozon reports an active report but did not expose UUID in statistics/list. Wait 10-20 minutes."
          );
          return;
        }

        if (performanceCommand.type === "stats" && err.code === "PERFORMANCE_COOLDOWN") {
          await tgBot.sendMessage(
            chatId,
            err.message
          );
          return;
        }

        await tgBot.sendMessage(
          chatId,
          "Ошибка Performance " + performanceCommand.type + ": " + err.message
        );
        return;
      }
    }

    const reportCommand = parseReportCommand(text);

    if (reportCommand) {
      try {
        if (reportCommand.type === "pnl") {
          if (reportCommand.toSheet) {
            const exported = await reportBuilderService.exportPnlReport(reportCommand);
            await sendLongMessage(
              tgBot,
              chatId,
              "Записал " +
                exported.writeResult.rowsWritten +
                " строк в " +
                exported.writeResult.tabName +
                "\n" +
                exported.report.missingFieldsNote
            );
            return;
          }

          const report = await reportBuilderService.buildPnlReport(reportCommand);
          await sendLongMessage(tgBot, chatId, formatPnlReport(report));
          return;
        }

        if (reportCommand.type === "sku") {
          if (reportCommand.toSheet) {
            const exported = await reportBuilderService.exportSkuReport(reportCommand);
            await sendLongMessage(
              tgBot,
              chatId,
              "Записал " +
                exported.writeResult.rowsWritten +
                " строк в " +
                exported.writeResult.tabName +
                "\n" +
                exported.report.missingFieldsNote
            );
            return;
          }

          const report = await reportBuilderService.buildSkuReport(reportCommand);
          await sendLongMessage(tgBot, chatId, formatSkuReport(report));
          return;
        }
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка report " + reportCommand.type + ": " + err.message);
        return;
      }
    }

    const cogsCommand = parseCogsCommand(text);

    if (cogsCommand) {
      try {
        if (cogsCommand.type === "template") {
          await sendLongMessage(tgBot, chatId, formatCogsTemplate());
          return;
        }
        if (cogsCommand.type === "status") {
          await sendLongMessage(tgBot, chatId, formatCogsStatus(cogsService.getStatus()));
          return;
        }
        if (cogsCommand.type === "set") {
          const item = cogsService.setSku(cogsCommand.sku, cogsCommand.cogs);
          await tgBot.sendMessage(chatId, "COGS сохранен: " + item.sku + " -> " + item.cogs);
          return;
        }
        if (cogsCommand.type === "clear") {
          cogsService.clear();
          await tgBot.sendMessage(chatId, "Локальные COGS очищены.");
          return;
        }
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка COGS: " + err.message);
        return;
      }
    }

    const salesCommand = parseSalesCommand(text);

    if (salesCommand) {
      try {
        if (salesCommand.type === "status") {
          await sendLongMessage(tgBot, chatId, formatSalesStatus(salesFactsService.getSalesRowsStatus()));
          return;
        }
        if (salesCommand.type === "clear") {
          salesFactsService.clearSalesRows();
          await tgBot.sendMessage(chatId, "Локальные sales facts очищены.");
          return;
        }
        if (salesCommand.type === "fetch") {
          await tgBot.sendMessage(chatId, "Запрашиваю Ozon sales facts...");
          const salesResult = await ozonService.getSalesFacts({
            dateFrom: salesCommand.dateFrom + "T00:00:00+03:00",
            dateTo: salesCommand.dateTo + "T23:59:59.999+03:00"
          });
          const result = salesFactsService.saveSalesRows(salesResult.rows, {
            dateFrom: salesCommand.dateFrom,
            dateTo: salesCommand.dateTo,
            savedAt: new Date().toISOString()
          });
          await sendLongMessage(tgBot, chatId, formatSalesFetchResult(result, salesResult.summary, salesResult.warning));
          return;
        }
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка sales facts: " + (err.userMessage || err.message));
        return;
      }
    }

    const financeCommand = parseFinanceCommand(text);

    if (financeCommand) {
      try {
        if (financeCommand.type === "status") {
          await sendLongMessage(tgBot, chatId, formatFinanceStatus(financeFactsService.getFinanceRowsStatus()));
          return;
        }
        if (financeCommand.type === "clear") {
          financeFactsService.clearFinanceRows();
          await tgBot.sendMessage(chatId, "Локальные finance facts очищены.");
          return;
        }
        if (financeCommand.type === "import_sample") {
          const result = financeFactsService.importSample();
          await tgBot.sendMessage(
            chatId,
            "Finance sample импортирован. Rows saved: " +
              result.rowsSaved +
              ", total stored rows: " +
              result.totalStoredRows
          );
          return;
        }
        if (financeCommand.type === "fetch") {
          await tgBot.sendMessage(chatId, "Запрашиваю Ozon finance facts...");
          const financeResult = await ozonService.getFinanceFacts({
            dateFrom: financeCommand.dateFrom + "T00:00:00+03:00",
            dateTo: financeCommand.dateTo + "T23:59:59.999+03:00"
          });
          const saved = financeFactsService.saveFinanceRows(financeResult.rows, {
            dateFrom: financeCommand.dateFrom,
            dateTo: financeCommand.dateTo,
            savedAt: new Date().toISOString(),
            source: "ozon-api"
          });
          await sendLongMessage(tgBot, chatId, formatFinanceFetchResult(saved, financeResult.summary));
          return;
        }
        if (financeCommand.type === "debug") {
          const financeResult = await ozonService.getFinanceFacts({
            dateFrom: financeCommand.dateFrom + "T00:00:00+03:00",
            dateTo: financeCommand.dateTo + "T23:59:59.999+03:00"
          });
          await sendLongMessage(
            tgBot,
            chatId,
            formatFinanceDiagnostics({
              ...financeResult,
              dateFrom: financeCommand.dateFrom,
              dateTo: financeCommand.dateTo
            })
          );
          return;
        }
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка finance facts: " + (err.userMessage || err.message));
        return;
      }
    }

    const aiCommand = parseAiCommand(text);

    if (aiCommand) {
      try {
        if (aiCommand === "quick") {
          const result = await decisionEngine.quickAnalyze();
          await sendLongMessage(tgBot, chatId, result.reply);
          return;
        }

        await tgBot.sendMessage(chatId, "Собираю данные и запускаю AI Decision Engine...");
        const result = await decisionEngine.analyze(aiCommand);
        await sendLongMessage(tgBot, chatId, result.reply);
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка AI Decision Engine: " + err.message);
      }

      return;
    }

    const ozonProductsCommand = parseOzonProductsCommand(text);

    if (ozonProductsCommand) {
      try {
        await tgBot.sendMessage(chatId, "Запрашиваю товары Ozon...");
        const products = await ozonService.getProducts(ozonProductsCommand.limit);

        if (!products.length) {
          await tgBot.sendMessage(chatId, "Товары не найдены.");
          return;
        }

        if (ozonProductsCommand.toSheet) {
          const rows = products.map(productToSheetRow);

          await sheetsService.clearAndWriteMappedRows(OZON_PRODUCTS_SHEET, rows);
          await tgBot.sendMessage(
            chatId,
            "Записал товары Ozon в Google Таблицу: " + products.length
          );
          return;
        }

        await sendLongMessage(tgBot, chatId, formatOzonProducts(products));
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Ozon API: " + err.message);
      }

      return;
    }

    if (isCoderCommand(text)) {
      try {
        await tgBot.sendMessage(chatId, "Запускаю coder-модель...");
        const reply = await ollamaService.askCoder(text);
        await sendLongMessage(tgBot, chatId, reply);
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка coder-модели: " + err.message);
      }

      return;
    }

    if (text.startsWith("/")) {
      await sendLongMessage(
        tgBot,
        chatId,
        "Неизвестная команда.\n\n" + getHelpText()
      );
      return;
    }

    try {
      const reply = await ollamaService.askSimple(text);
      await sendLongMessage(tgBot, chatId, reply);
    } catch (err) {
      await tgBot.sendMessage(chatId, "Ошибка: " + err.message);
    }
  });

  logger.log("Telegram bot started");
  return {
    bot: tgBot,
    getPrimaryChatId,
    sendDocument,
    sendText
  };
}

module.exports = {
  formatModelsInfo,
  formatOzonProducts,
  formatPerformanceRows,
  getHelpText,
  isCoderCommand,
  parseAiCommand,
  parseAlertsCommand,
  parseAnalyticsCommand,
  parseCogsCommand,
  parseFinanceCommand,
  parseSalesCommand,
  parseDailyCommand,
  parseOzonProductsCommand,
  parseReportCommand,
  parsePerformanceCommand,
  productToSheetRow,
  sendLongMessage,
  startTelegramBot
};
