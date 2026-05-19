const express = require("express");
const env = require("./config/env");
const { createApiRouter, createFileState } = require("./routes/api");
const { createAnalyticsService } = require("./services/analytics");
const { createAlertsService } = require("./services/alerts");
const { createCalendarService } = require("./services/calendar");
const { createCogsService } = require("./services/cogs");
const { createDecisionEngine } = require("./services/decisionEngine");
const { createDailySummaryService } = require("./services/dailySummary");
const { createJobsService } = require("./services/jobs");
const { createOllamaService } = require("./services/ollama");
const { createOzonService } = require("./services/ozon");
const { createPerformanceService } = require("./services/performance");
const { createReportBuilderService } = require("./services/reportBuilder");
const { createSheetsService } = require("./services/sheets");
const { startTelegramBot } = require("./services/telegram");

const app = express();
const state = createFileState(env.paths);

const ollamaService = createOllamaService({
  chatUrl: env.ollamaChatUrl,
  models: env.ollamaModels,
  maxPromptChars: env.ollamaMaxPromptChars,
  decisionTimeoutMs: env.ollamaDecisionTimeoutMs,
  state,
  timeoutMs: env.ollamaTimeoutMs
});

const ozonService = createOzonService({
  clientId: env.ozonClientId,
  apiKey: env.ozonApiKey,
  performanceClientId: env.ozonPerformanceClientId,
  performanceClientSecret: env.ozonPerformanceClientSecret
});

const sheetsService = createSheetsService({
  webappUrl: env.googleSheetsWebappUrl
});

const cogsService = createCogsService({
  filePath: env.paths.cogsFile
});

const performanceService = createPerformanceService({
  baseUrl: env.ozonPerformanceBaseUrl,
  clientId: env.ozonPerformanceClientId,
  clientSecret: env.ozonPerformanceClientSecret,
  queueFile: env.paths.performanceQueueFile,
  reportsFile: env.paths.performanceReportsFile,
  rowsFile: env.paths.performanceRowsFile,
  sheetsService
});

const reportBuilderService = createReportBuilderService({
  cogsService,
  ozonService,
  performanceService,
  sheetsService
});

const jobsService = createJobsService({
  ozonService,
  sheetsService,
  logFile: env.paths.jobsLogFile,
  ...env.jobs
});

const analyticsService = createAnalyticsService({
  jobsService,
  ollamaService,
  ozonService,
  performanceService
});

const decisionEngine = createDecisionEngine({
  analyticsService,
  jobsService,
  ollamaService,
  performanceService,
  logFile: env.paths.jobsLogFile
});

const alertsService = createAlertsService({
  intervalMs: env.alerts.intervalMs,
  jobsService,
  lowStockThreshold: env.alerts.lowStockThreshold,
  logFile: env.paths.alertsLogFile,
  performanceService,
  stateFile: env.paths.alertsStateFile,
  ozonService
});

createCalendarService();

const telegramService = {
  getPrimaryChatId() {
    return null;
  },
  async sendText() {
    return null;
  },
  async sendDocument() {
    return null;
  }
};

const dailySummaryService = createDailySummaryService({
  dataDir: env.paths.dataDir,
  dailyReportsDir: env.paths.dailyReportsDir,
  dailySummaryChatId: env.dailySummaryChatId,
  ozonService,
  performanceService,
  sheetsService,
  telegramService
});

app.use(express.json({ limit: "5mb" }));
app.use(
  createApiRouter({
    cronSecret: env.cronSecret,
    dailySummaryService,
    state,
    ollamaService,
    defaultModel: ollamaService.getModels().chat
  })
);

const activeTelegramService = startTelegramBot({
  analyticsService,
  alertsService,
  cogsService,
  dailySummaryService,
  decisionEngine,
  performanceService,
  reportBuilderService,
  token: env.telegramBotToken,
  jobsService,
  ollamaService,
  ozonService,
  sheetsService
});

if (activeTelegramService) {
  telegramService.getPrimaryChatId = activeTelegramService.getPrimaryChatId;
  telegramService.sendText = activeTelegramService.sendText;
  telegramService.sendDocument = activeTelegramService.sendDocument;
}

if (env.jobs.enabled) {
  jobsService.start();
}

if (env.alerts.enabled) {
  alertsService.start();
}

app.listen(env.port, () => {
  console.log("Bot started: http://127.0.0.1:" + env.port);
});
