const fs = require("fs");

function tailLogLines(filePath, limit = 20) {
  if (!filePath || !fs.existsSync(filePath)) return [];

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);

  return lines.slice(-limit);
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
    "Отвечай по-русски, по делу, в управленческом формате.",
    "Не придумывай метрики. Если данных не хватает, прямо скажи: Прямые данные продаж/рекламы пока не подключены.",
    "Режим: " + labels[mode],
    "",
    "Сделай разделы:",
    "1. Что происходит",
    "2. Главные проблемы",
    "3. Возможности роста",
    "4. Что сделать сегодня",
    "5. Что сделать за 7 дней",
    "6. Что проверить вручную",
    "7. Уверенность: high/medium/low",
    "",
    "JSON:",
    JSON.stringify(payload)
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
      ads: "ads"
    };

    const analyticsSnapshot = await analyticsService.collectSnapshot(
      analyticsTopicMap[mode] || "overview"
    );
    const performanceAvailable = performanceService && performanceService.isConfigured();
    const recentJobLogs = tailLogLines(logFile, 20);

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
    const reply = await ollamaService.askAnalytics(prompt);

    return {
      mode,
      payload,
      reply
    };
  }

  return {
    analyze
  };
}

module.exports = {
  createDecisionEngine
};
