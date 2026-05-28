const express = require("express");
const env = require("./config/env");
const { createApiRouter, createFileState } = require("./routes/api");
const { createAnalyticsService } = require("./services/analytics");
const { createAlertsService } = require("./services/alerts");
const { createCalendarService } = require("./services/calendar");
const { createCogsService } = require("./services/cogs");
const { createDecisionEngine } = require("./services/decisionEngine");
const { createDailySummaryService } = require("./services/dailySummary");
const { createDailyControlService } = require("./services/dailyControl");
const { createExternalTrafficPlanService } = require("./services/externalTrafficPlan");
const { createFinanceFactsService } = require("./services/financeFacts");
const { createJobsService } = require("./services/jobs");
const { createManagementWorkbookService } = require("./services/managementWorkbook");
const { createOllamaService } = require("./services/ollama");
const { createOzonService } = require("./services/ozon");
const { createPerformanceService } = require("./services/performance");
const { createPrioritySkusService } = require("./services/prioritySkus");
const { createReplenishmentService } = require("./services/replenishment");
const { createReportBuilderService } = require("./services/reportBuilder");
const { createSalesFactsService } = require("./services/salesFacts");
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

const prioritySkusService = createPrioritySkusService({
  filePath: env.paths.prioritySkusFile
});

const externalTrafficPlanService = createExternalTrafficPlanService({
  filePath: env.paths.externalTrafficPlanFile
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

const salesFactsService = createSalesFactsService({
  filePath: env.paths.salesRowsFile
});

const financeFactsService = createFinanceFactsService({
  filePath: env.paths.financeRowsFile
});

const reportBuilderService = createReportBuilderService({
  cogsService,
  financeFactsService,
  ozonService,
  performanceService,
  salesFactsService,
  sheetsService
});

const dailyControlService = createDailyControlService({
  cogsService,
  financeFactsService,
  performanceService,
  salesFactsService,
  sheetsService,
  planVpPerDay: env.dailyControlPlanVp
});

const managementWorkbookService = createManagementWorkbookService({
  cogsService,
  financeFactsService,
  performanceService,
  salesFactsService,
  sheetsService,
  planVpPerDay: env.dailyControlPlanVp
});

const replenishmentService = createReplenishmentService({
  cogsService,
  externalTrafficPlanService,
  ozonService,
  prioritySkusService,
  salesFactsService,
  sheetsService,
  forecastDays: env.replenishmentForecastDays,
  safetyDays: env.replenishmentSafetyDays,
  minShipment: env.replenishmentMinShipment,
  leadTimeDays: env.replenishmentLeadTimeDays
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
  dailyControlService,
  dailySummaryService,
  decisionEngine,
  financeFactsService,
  managementWorkbookService,
  performanceService,
  prioritySkusService,
  replenishmentService,
  reportBuilderService,
  salesFactsService,
  externalTrafficPlanService,
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
