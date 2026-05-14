const env = require("../config/env");
const { createDailySummaryService } = require("../services/dailySummary");
const { createOzonService } = require("../services/ozon");
const { createPerformanceService } = require("../services/performance");
const { createSheetsService } = require("../services/sheets");

async function main() {
  const ozonService = createOzonService({
    clientId: env.ozonClientId,
    apiKey: env.ozonApiKey,
    performanceClientId: env.ozonPerformanceClientId,
    performanceClientSecret: env.ozonPerformanceClientSecret
  });

  const sheetsService = createSheetsService({
    webappUrl: env.googleSheetsWebappUrl
  });

  const performanceService = createPerformanceService({
    baseUrl: env.ozonPerformanceBaseUrl,
    clientId: env.ozonPerformanceClientId,
    clientSecret: env.ozonPerformanceClientSecret,
    sheetsService
  });

  const dailySummaryService = createDailySummaryService({
    dataDir: env.paths.dataDir,
    dailyReportsDir: env.paths.dailyReportsDir,
    dailySummaryChatId: env.dailySummaryChatId,
    ozonService,
    performanceService,
    sheetsService,
    telegramService: null
  });

  const result = await dailySummaryService.generateDailySummary();
  console.log(
    JSON.stringify(
      {
        ok: true,
        reportPath: result.reportPath,
        sentToTelegram: result.sentToTelegram
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
