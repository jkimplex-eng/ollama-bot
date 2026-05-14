const TelegramBot = require("node-telegram-bot-api");
const { parseDailyCommand } = require("./dailySummary");

const OZON_PRODUCTS_SHEET = "Ozon";
const TELEGRAM_MESSAGE_LIMIT = 4000;

function getHelpText() {
  return [
    "Команды:",
    "/daily",
    "/daily вчера",
    "/daily today",
    "/daily 2026-05-13",
    "/daily 2026-05-13 2026-05-14",
    "/analytics",
    "/analytics продажи",
    "/analytics реклама",
    "/analytics остатки",
    "/analytics проблемы",
    "/performance campaigns",
    "/performance stats",
    "/performance sku",
    "/ai strategy",
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
  const match = normalized.match(/^\/performance\s+(campaigns|stats|sku)$/);
  return match ? match[1] : null;
}

function parseAiCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  const match = normalized.match(/^\/ai\s+(strategy|actions|risks|закупка|реклама)$/);

  if (!match) return null;

  const modeMap = {
    "strategy": "strategy",
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
        await tgBot.sendMessage(chatId, "Записал строку в Google Таблицу ✅");
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
      try {
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
        if (!performanceService.isConfigured()) {
          await tgBot.sendMessage(
            chatId,
            "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
          );
          return;
        }

        await tgBot.sendMessage(chatId, "Забираю данные Performance API...");

        if (performanceCommand === "campaigns") {
          const rows = await performanceService.syncCampaignsToSheets();
          await sendLongMessage(
            tgBot,
            chatId,
            "Кампании выгружены в Ozon_Performance_Campaigns.\n\n" +
              rows
                .slice(0, 20)
                .map(item => item.campaignId + " | " + item.campaignName)
                .join("\n")
          );
          return;
        }

        if (performanceCommand === "stats") {
          const rows = await performanceService.syncStatsToSheets();
          await sendLongMessage(
            tgBot,
            chatId,
            "Статистика выгружена в Ozon_Performance_Stats.\n\n" + formatPerformanceRows(rows)
          );
          return;
        }

        const rows = await performanceService.syncSkuStatsToSheets();
        await sendLongMessage(
          tgBot,
          chatId,
          "SKU-статистика выгружена в Ozon_Performance_SKU.\n\n" + formatPerformanceRows(rows)
        );
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance API: " + err.message);
      }

      return;
    }

    const aiCommand = parseAiCommand(text);

    if (aiCommand) {
      try {
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
          const rows = [
            ["Название", "SKU", "Цена", "Остаток"],
            ...products.map(productToSheetRow)
          ];

          await sheetsService.addRows(OZON_PRODUCTS_SHEET, rows);
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
