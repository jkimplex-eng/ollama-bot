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
    "/performance campaigns running",
    "/performance campaigns sku",
    "/performance campaigns search_promo",
    "/performance campaigns banner",
    "/performance campaigns в таблицу",
    "/performance campaigns active в таблицу",
    "/performance stats 2026-05-01 2026-05-14",
    "/performance stats активные 2026-05-01 2026-05-14",
    "/performance stats в таблицу 2026-05-01 2026-05-14",
    "/performance objects <campaignId>",
    "/performance limits",
    "/performance minbid <sku>",
    "/performance continue",
    "/performance queue",
    "/performance reset",
    "/performance export <requestGroupId>",
    "/performance report <uuid>",
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

  if (normalized === "/performance debug") {
    return { type: "debug" };
  }

  if (normalized === "/performance queue" || normalized === "/performance pending") {
    return { type: "queue" };
  }

  if (normalized === "/performance continue") {
    return { type: "continue" };
  }

  if (normalized === "/performance reset") {
    return { type: "reset" };
  }

  if (normalized === "/performance limits") {
    return { type: "limits" };
  }

  const objectsMatch = normalized.match(/^\/performance\s+objects\s+(\d+)$/);

  if (objectsMatch) {
    return {
      type: "objects",
      campaignId: objectsMatch[1]
    };
  }

  const minBidMatch = normalized.match(/^\/performance\s+minbid\s+(\d+)$/);

  if (minBidMatch) {
    return {
      type: "minbid",
      sku: minBidMatch[1]
    };
  }

  const campaignTokens = normalized.split(" ");

  if (campaignTokens[0] === "/performance" && campaignTokens[1] === "campaigns") {
    const flags = new Set(campaignTokens.slice(2));
    let filter = "";

    if (flags.has("active") || flags.has("running")) {
      filter = "running";
    } else if (flags.has("sku")) {
      filter = "sku";
    } else if (flags.has("search_promo")) {
      filter = "search_promo";
    } else if (flags.has("banner")) {
      filter = "banner";
    }

    return {
      type: "campaigns",
      filter,
      toSheet: flags.has("таблицу")
    };
  }

  const exportMatch = normalized.match(/^\/performance\s+export\s+([a-z0-9-]+)$/i);

  if (exportMatch) {
    return {
      type: "export",
      requestGroupId: exportMatch[1]
    };
  }

  const reportMatch = normalized.match(/^\/performance\s+report\s+([a-z0-9-]+)$/i);

  if (reportMatch) {
    return {
      type: "report",
      uuid: reportMatch[1]
    };
  }

  const statsTokens = normalized.split(" ");

  if (statsTokens[0] === "/performance" && statsTokens[1] === "stats") {
    const flags = new Set();
    const dates = [];

    for (const token of statsTokens.slice(2)) {
      if (token === "активные") {
        flags.add("active");
        continue;
      }

      if (token === "в" || token === "таблицу") {
        flags.add("sheet");
        continue;
      }

      if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
        dates.push(token);
        continue;
      }
    }

    if (dates.length === 2) {
      return {
        type: "stats",
        activeOnly: flags.has("active"),
        toSheet: flags.has("sheet"),
        dateFrom: dates[0],
        dateTo: dates[1]
      };
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
        "CPC: " + (row.cpc ?? "-"),
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
        "Payment Type: " + (row.paymentType || "-"),
        "From Date: " + (row.fromDate || "-"),
        "To Date: " + (row.toDate || "-"),
        "Budget: " + (row.budget === "" ? "-" : row.budget),
        "Daily Budget: " + (row.dailyBudget === "" ? "-" : row.dailyBudget),
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
  if (!reports.length) {
    return "Очередь Performance пуста.";
  }

  return reports
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
    lines.push(
      "Активный отчёт уже существует. Новые chunk-отчёты поставлены в очередь. Используй /performance continue."
    );
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
  dailySummaryService,
  decisionEngine,
  performanceService,
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

    if (performanceCommand && performanceCommand.type === "debug") {
      try {
        const debug = await performanceService.debugSummary();
        await sendLongMessage(tgBot, chatId, JSON.stringify(debug, null, 2));
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance debug: " + err.message);
      }

      return;
    }

    if (performanceCommand && performanceCommand.type === "queue") {
      try {
        await sendLongMessage(
          tgBot,
          chatId,
          formatQueueItems(performanceService.listQueue())
        );
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance queue: " + err.message);
      }

      return;
    }

    if (performanceCommand && performanceCommand.type === "reset") {
      try {
        performanceService.resetQueue();
        await tgBot.sendMessage(chatId, "Локальная очередь Performance очищена.");
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance reset: " + err.message);
      }

      return;
    }

    if (performanceCommand && performanceCommand.type === "continue") {
      try {
        const result = await performanceService.continueQueue();

        if (result.state === "empty") {
          await tgBot.sendMessage(chatId, "Очередь Performance пуста.");
          return;
        }

        if (result.state === "pending") {
          await tgBot.sendMessage(chatId, "Текущий отчёт ещё готовится.");
          return;
        }

        if (result.state === "started") {
          await tgBot.sendMessage(
            chatId,
            "Запущен следующий отчёт: " + result.current.uuid
          );
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
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance continue: " + err.message);
      }

      return;
    }

    if (performanceCommand && performanceCommand.type === "campaigns") {
      try {
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
          let result;

          try {
            result = await performanceService.writeCampaignRowsToMappedSheet(campaigns);
          } catch (sheetError) {
            await tgBot.sendMessage(
              chatId,
              "Performance data was received but Sheets write failed: " + sheetError.message
            );
            return;
          }

          await tgBot.sendMessage(
            chatId,
            "Записал " + result.rowsWritten + " строк в " + result.tabName
          );
          return;
        }

        const rows = await performanceService.getCampaigns(filters);
        await sendLongMessage(tgBot, chatId, formatPerformanceCampaigns(rows));
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance API: " + err.message);
      }

      return;
    }

    if (performanceCommand && performanceCommand.type === "objects") {
      try {
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
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance objects: " + err.message);
      }

      return;
    }

    if (performanceCommand && performanceCommand.type === "limits") {
      try {
        const limits = await performanceService.getBidLimits();
        await sendLongMessage(tgBot, chatId, formatPerformanceLimits(limits));
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance limits: " + err.message);
      }

      return;
    }

    if (performanceCommand && performanceCommand.type === "minbid") {
      try {
        const result = await performanceService.getMinBidBySku(performanceCommand.sku);
        await sendLongMessage(tgBot, chatId, formatMinBidResponse(performanceCommand.sku, result));
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance minbid: " + err.message);
      }

      return;
    }

    if (performanceCommand && performanceCommand.type === "stats") {
      try {
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
      } catch (err) {
        if (err.code === "PERFORMANCE_ACTIVE_LIMIT") {
          await tgBot.sendMessage(
            chatId,
            "Ozon ограничил активные отчёты. Состояние сохранено, повтори /performance continue позже."
          );
          return;
        }

        await tgBot.sendMessage(chatId, "Ошибка Performance API: " + err.message);
      }

      return;
    }

    if (performanceCommand && performanceCommand.type === "export") {
      try {
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
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance export: " + err.message);
      }

      return;
    }

    if (performanceCommand && performanceCommand.type === "report") {
      try {
        if (!performanceService.isConfigured()) {
          await tgBot.sendMessage(
            chatId,
            "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
          );
          return;
        }

        const status = await performanceService.getReportStatus(performanceCommand.uuid);

        if (!status.ready) {
          await tgBot.sendMessage(
            chatId,
            "Отчёт Performance ещё готовится. Повтори команду через 1-2 минуты."
          );
          return;
        }

        await tgBot.sendMessage(chatId, "Отчёт готов, скачиваю...");
        const resolved = await performanceService.resolveReport(performanceCommand.uuid);
        const summary = performanceService.summarizeStats(resolved.rows);

        await sendLongMessage(
          tgBot,
          chatId,
          formatPerformanceSummary(summary, performanceCommand.uuid) +
            "\n\n" +
            formatPerformanceRows(resolved.rows)
        );
      } catch (err) {
        if (err.code === "PERFORMANCE_REPORT_PENDING") {
          await tgBot.sendMessage(
            chatId,
            "Отчёт Performance ещё готовится. Повтори команду через 1-2 минуты."
          );
          return;
        }

        await tgBot.sendMessage(chatId, "Ошибка Performance report: " + err.message);
      }

      return;
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
  parseDailyCommand,
  parseOzonProductsCommand,
  parsePerformanceCommand,
  productToSheetRow,
  sendLongMessage,
  startTelegramBot
};
