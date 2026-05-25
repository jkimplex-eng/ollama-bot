const path = require("path");

require("dotenv").config();

const rootDir = path.resolve(__dirname, "..");

module.exports = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  ollamaChatUrl:
    process.env.OLLAMA_CHAT_URL ||
    process.env.OLLAMA_URL ||
    "http://127.0.0.1:11434/api/chat",
  ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 120000),
  ollamaMaxPromptChars: Number(process.env.OLLAMA_MAX_PROMPT_CHARS || 12000),
  ollamaDecisionTimeoutMs: Number(process.env.OLLAMA_DECISION_TIMEOUT_MS || 600000),
  ollamaModels: {
    chat:
      process.env.OLLAMA_CHAT_MODEL ||
      process.env.OLLAMA_MODEL ||
      "qwen2.5:3b",
    coder: process.env.OLLAMA_CODER_MODEL || "deepseek-r1:1.5b",
    fast: process.env.OLLAMA_FAST_MODEL || "",
    analytics:
      process.env.OLLAMA_ANALYTICS_MODEL ||
      process.env.OLLAMA_CHAT_MODEL ||
      process.env.OLLAMA_MODEL ||
      "qwen2.5:3b"
  },
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  cronSecret: process.env.CRON_SECRET || "",
  dailySummaryChatId: process.env.DAILY_SUMMARY_CHAT_ID || "",
  dailyControlPlanVp: Number(process.env.DAILY_CONTROL_PLAN_VP || 0),
  replenishmentForecastDays: Number(process.env.REPLENISHMENT_FORECAST_DAYS || 21),
  replenishmentSafetyDays: Number(process.env.REPLENISHMENT_SAFETY_DAYS || 7),
  replenishmentMinShipment: Number(process.env.REPLENISHMENT_MIN_SHIPMENT || 1),
  googleSheetsWebappUrl: process.env.GOOGLE_SHEETS_WEBAPP_URL || "",
  ozonClientId: process.env.OZON_CLIENT_ID || "",
  ozonApiKey: process.env.OZON_API_KEY || "",
  ozonPerformanceClientId: process.env.OZON_PERFORMANCE_CLIENT_ID || "",
  ozonPerformanceClientSecret: process.env.OZON_PERFORMANCE_CLIENT_SECRET || "",
  ozonPerformanceBaseUrl:
    process.env.OZON_PERFORMANCE_BASE_URL || "https://api-performance.ozon.ru",
  paths: {
    memoryFile: path.join(rootDir, "memory.json"),
    profileFile: path.join(rootDir, "profile.json"),
    filesFile: path.join(rootDir, "files.json"),
    uploadDir: path.join(rootDir, "uploads"),
    knowledgeDir: path.join(rootDir, "knowledge"),
    exportDir: path.join(rootDir, "exports"),
    logsDir: path.join(rootDir, "logs"),
    jobsLogFile: path.join(rootDir, "logs", "jobs.log"),
    alertsLogFile: path.join(rootDir, "logs", "alerts.log"),
    dataDir: path.join(rootDir, "data"),
    alertsStateFile: path.join(rootDir, "data", "alerts-state.json"),
    cogsFile: path.join(rootDir, "data", "cogs.json"),
    salesRowsFile: path.join(rootDir, "data", "sales-rows.json"),
    financeRowsFile: path.join(rootDir, "data", "finance-rows.json"),
    performanceReportsFile: path.join(rootDir, "data", "performance-reports.json"),
    performanceRowsFile: path.join(rootDir, "data", "performance-rows.json"),
    performanceQueueFile: path.join(rootDir, "data", "performance-queue.json"),
    reportsDir: path.join(rootDir, "reports"),
    dailyReportsDir: path.join(rootDir, "reports", "daily")
  },
  jobs: {
    enabled: process.env.JOBS_ENABLED !== "false",
    productsIntervalMs: Number(process.env.JOBS_PRODUCTS_INTERVAL_MS || 30 * 60 * 1000),
    stocksIntervalMs: Number(process.env.JOBS_STOCKS_INTERVAL_MS || 60 * 60 * 1000),
    retryAttempts: Number(process.env.JOBS_RETRY_ATTEMPTS || 3),
    retryDelayMs: Number(process.env.JOBS_RETRY_DELAY_MS || 5000),
    productLimit: Number(process.env.JOBS_PRODUCT_LIMIT || 100),
    stockLimit: Number(process.env.JOBS_STOCK_LIMIT || 100)
  },
  alerts: {
    enabled: process.env.ALERTS_ENABLED !== "false",
    intervalMs: Number(process.env.ALERTS_INTERVAL_MS || 60 * 60 * 1000),
    lowStockThreshold: Number(process.env.ALERTS_LOW_STOCK_THRESHOLD || 5)
  }
};
