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
    "/performance stats 2026-05-01 2026-05-14",
    "/performance stats активные 2026-05-01 2026-05-14",
    "/performance stats в таблицу 2026-05-01 2026-05-14",
    "/performance report <uuid>",
    "/performance report в таблицу <uuid>",
    "/performance pending",
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

  if (normalized === "/performance campaigns") {
    return { type: "campaigns" };
  }

  if (normalized === "/performance debug") {
    return { type: "debug" };
  }

  if (normalized === "/performance pending") {
    return { type: "pending" };
  }

  const reportMatch = normalized.match(
    /^\/performance\s+report(?:\s+(в\s+таблицу))?\s+([a-z0-9-]+)$/i
  );

  if (reportMatch) {
    return {
      type: "report",
      toSheet: Boolean(reportMatch[1]),
      uuid: reportMatch[2]
    };
  }

  const statsMatch = normalized.match(
    /^\/performance\s+stats(?:\s+(активные))?(?:\s+(в\s+таблицу))?\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/
  );

  if (!statsMatch) return null;

  return {
    type: "stats",
    activeOnly: Boolean(statsMatch[1]),
    toSheet: Boolean(statsMatch[2]),
    dateFrom: statsMatch[3],
    dateTo: statsMatch[4]
  };
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
        "Payment Type: " + (row.paymentType || "-")
      ].join("\n");
    })
    .join("\n\n");
}

function formatPendingReports(reports) {
  if (!reports.length) {
    return "Нет ожидающих отчётов Performance.";
  }

  return reports
    .slice(0, 20)
    .map(item => {
      return [
        "UUID: " + item.uuid,
        "Request Group: " + (item.requestGroupId || "-"),
        "Type: " + (item.reportType || "-"),
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
  } else {
    lines.push("Создал отчёт Performance.");
  }

  lines.push("Request Group: " + created.requestGroupId);
  lines.push("UUIDs:");

  for (const report of created.reports) {
    lines.push(
      "- " +
        report.uuid +
        " (chunk " +
        report.chunkIndex +
        "/" +
        report.totalChunks +
        ")"
    );
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

    if (performanceCommand && performanceCommand.type === "pending") {
      try {
        await sendLongMessage(
          tgBot,
          chatId,
          formatPendingReports(performanceService.listPendingReports())
        );
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance pending: " + err.message);
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
        const rows = await performanceService.getCampaigns();
        await sendLongMessage(tgBot, chatId, formatPerformanceCampaigns(rows));
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance API: " + err.message);
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
          await tgBot.sendMessage(chatId, "Создал отчёт...");
          const created = await performanceService.createStatsReport({
            dateFrom: performanceCommand.dateFrom,
            dateTo: performanceCommand.dateTo,
            activeOnly: performanceCommand.activeOnly
          });

          if (created.campaignsCount > 10) {
            await tgBot.sendMessage(
              chatId,
              "Найдено " + created.campaignsCount + " кампаний. Создаю отчёты пачками по 10."
            );
          }

          const combinedRows = [];
          const pendingUuids = [];

          for (const report of created.reports) {
            await tgBot.sendMessage(chatId, "Жду готовность... " + report.uuid);

            try {
              await performanceService.waitForReport(report.uuid, 10, 10_000);
              await tgBot.sendMessage(chatId, "Отчёт готов, скачиваю... " + report.uuid);
              const resolved = await performanceService.resolveReport(report.uuid);
              combinedRows.push(...resolved.rows);
            } catch (err) {
              if (err.code === "PERFORMANCE_REPORT_PENDING") {
                pendingUuids.push(report.uuid);
                continue;
              }

              throw err;
            }
          }

          if (combinedRows.length) {
            try {
              const writeResult = await performanceService.writeStatsToMappedSheet({
                rows: combinedRows
              });
              await tgBot.sendMessage(
                chatId,
                "Записал " + writeResult.rowsWritten + " строк в " + writeResult.tabName
              );
            } catch (sheetError) {
              await tgBot.sendMessage(
                chatId,
                "Performance data was received, but Sheets write failed: " + sheetError.message
              );
            }
          }

          if (pendingUuids.length) {
            await tgBot.sendMessage(
              chatId,
              "Часть отчётов ещё не готова. Повтори позже:\n" +
                pendingUuids.map(uuid => "/performance report " + uuid).join("\n")
            );
          }
          return;
        }

        const created = await performanceService.createStatsReport({
          dateFrom: performanceCommand.dateFrom,
          dateTo: performanceCommand.dateTo,
          activeOnly: performanceCommand.activeOnly
        });
        await sendLongMessage(tgBot, chatId, formatCreatedReports(created));
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Performance API: " + err.message);
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

        if (performanceCommand.toSheet) {
          try {
            const writeResult = await performanceService.writeStatsToMappedSheet({
              rows: resolved.rows
            });
            await tgBot.sendMessage(
              chatId,
              "Записал " + writeResult.rowsWritten + " строк в " + writeResult.tabName
            );
          } catch (sheetError) {
            await tgBot.sendMessage(
              chatId,
              "Performance data was received, but Sheets write failed: " + sheetError.message
            );
          }
          return;
        }

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
