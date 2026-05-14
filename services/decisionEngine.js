const fs = require("fs");

function tailLogLines(filePath, limit = 10, maxLineLength = 180) {
  if (!filePath || !fs.existsSync(filePath)) return [];

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit);

  return lines.map(line => line.slice(0, maxLineLength));
}

function buildDecisionPrompt(mode, payload) {
  const labels = {
    strategy: "стратегия",
    actions: "действия",
    risks: "риски",
    purchase: "закупка",
    ads: "реклама"
  };

  return [
    "Ты AI Decision Engine для Ozon-бизнеса.",
    "Отвечай по-русски, кратко и в управленческом формате.",
    "Не придумывай метрики. Если данных не хватает, прямо скажи: Прямые данные продаж/рекламы пока не подключены.",
    "Режим: " + labels[mode],
    "",
    "Разделы:",
    "1. Что происходит",
    "2. Главные проблемы",
    "3. Возможности роста",
    "4. Что сделать сегодня",
    "5. Что сделать за 7 дней",
    "6. Что проверить вручную",
    "7. Уверенность: high/medium/low",
    "",
    JSON.stringify(payload)
  ].join("\n");
}

function buildQuickReply(payload) {
  const summary = payload.analyticsSnapshot.summary;
  const quickMetrics = payload.analyticsSnapshot.quickMetrics || {};
  const lines = [
    "Быстрая сводка Ozon:",
    "- Product count checked: " + (quickMetrics.checkedProducts ?? summary.totalProducts),
    "- Products with missing offer_id: " + (quickMetrics.missingOfferIdCount ?? 0),
    "- Products suitable for review: " + (quickMetrics.suitableForReviewCount ?? 0)
  ];

  if (quickMetrics.stocksAvailable) {
    lines.push("- Low stock count: " + (quickMetrics.lowStockCount ?? summary.lowStock));
  } else {
    lines.push("- Stocks unavailable: бот не получил данные по остаткам.");
  }

  lines.push("", "Дополнительно:");
  if (summary.totalProducts === 0) {
    lines.push("- Данные по товарам недоступны.");
  } else {
    if (summary.outOfStock > 0) {
      lines.push("- Есть товары без остатка.");
    }
    if (summary.withoutPrice > 0) {
      lines.push("- Есть товары без цены.");
    }
  }

  return lines.join("\n");
}

function buildFallbackReply(mode, payload, reason) {
  return [
    "Ollama недоступен, показываю детерминированную сводку.",
    "Причина: " + reason,
    "",
    buildQuickReply(payload),
    "",
    "Режим: " + mode
  ].join("\n");
}

function createDecisionEngine({
  analyticsService,
  jobsService,
  ollamaService,
  performanceService,
  logFile
}) {
  async function buildPayload(mode) {
    const analyticsTopicMap = {
      strategy: "overview",
      actions: "overview",
      risks: "issues",
      purchase: "stocks",
      ads: "ads",
      quick: "overview"
    };

    const analyticsSnapshot = await analyticsService.collectSnapshot(
      analyticsTopicMap[mode] || "overview"
    );
    const performanceAvailable = performanceService && performanceService.isConfigured();
    const recentJobLogs = tailLogLines(logFile, 10);

    return {
      mode,
      generatedAt: new Date().toISOString(),
      analyticsSnapshot,
      jobs: jobsService ? jobsService.getStatus() : null,
      performanceAvailable,
      recentJobLogs
    };
  }

  async function analyze(mode) {
    const allowedModes = new Set(["strategy", "actions", "risks", "purchase", "ads"]);

    if (!allowedModes.has(mode)) {
      throw new Error("Неизвестный режим AI Decision Engine");
    }

    const payload = await buildPayload(mode);
    const prompt = buildDecisionPrompt(mode, payload);

    try {
      const reply = await ollamaService.askAnalytics(prompt, {
        endpoint: "telegram-decision"
      });

      return {
        mode,
        payload,
        reply,
        fallbackUsed: false
      };
    } catch (error) {
      return {
        mode,
        payload,
        reply: buildFallbackReply(mode, payload, error.message),
        fallbackUsed: true
      };
    }
  }

  async function quickAnalyze() {
    const payload = await buildPayload("quick");

    return {
      mode: "quick",
      payload,
      reply: buildQuickReply(payload),
      fallbackUsed: true
    };
  }

  return {
    analyze,
    quickAnalyze
  };
}

module.exports = {
  createDecisionEngine
};
