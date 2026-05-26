const path = require("path");
const env = require("../config/env");
const { createCogsService } = require("../services/cogs");
const { createFinanceFactsService } = require("../services/financeFacts");
const { createManagementWorkbookService } = require("../services/managementWorkbook");
const { createOzonService } = require("../services/ozon");
const { createPerformanceService } = require("../services/performance");
const { createSalesFactsService } = require("../services/salesFacts");
const { createSheetsService } = require("../services/sheets");

// Parse CLI arguments
const args = process.argv.slice(2);
let dateFrom, dateTo;

for (const arg of args) {
  if (arg.startsWith("--date-from=")) {
    dateFrom = arg.split("=")[1];
  } else if (arg.startsWith("--date-to=")) {
    dateTo = arg.split("=")[1];
  }
}

if (!dateFrom || !dateTo) {
  console.error("Usage: node scripts/sync.js --date-from=YYYY-MM-DD --date-to=YYYY-MM-DD");
  process.exit(1);
}

// Instantiate Services
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

const salesFactsService = createSalesFactsService({
  filePath: env.paths.salesRowsFile
});

const financeFactsService = createFinanceFactsService({
  filePath: env.paths.financeRowsFile
});

const managementWorkbookService = createManagementWorkbookService({
  cogsService,
  financeFactsService,
  performanceService,
  salesFactsService,
  sheetsService,
  planVpPerDay: env.dailyControlPlanVp
});

console.log(`Starting manual synchronization from ${dateFrom} to ${dateTo}...`);

managementWorkbookService.backfillDailyInput({
  dateFrom,
  dateTo,
  fetchSalesForDay: async date => {
    console.log(`[Ozon] Fetching sales facts for ${date}...`);
    const salesResult = await ozonService.getSalesFacts({
      dateFrom: date + "T00:00:00+03:00",
      dateTo: date + "T23:59:59.999+03:00"
    });
    return salesResult.rows;
  },
  fetchFinanceForDay: async date => {
    console.log(`[Ozon] Fetching finance facts for ${date}...`);
    const financeResult = await ozonService.getFinanceFacts({
      dateFrom: date + "T00:00:00+03:00",
      dateTo: date + "T23:59:59.999+03:00"
    });
    return financeResult.rows;
  }
})
.then(result => {
  console.log("\nSynchronization finished!");
  console.log(`Days processed: ${result.daysProcessed}`);
  console.log(`Days updated:   ${result.daysUpdated}`);
  console.log(`Days failed:    ${result.daysFailed}`);
  if (result.failures.length > 0) {
    console.error("\nFailures:", JSON.stringify(result.failures, null, 2));
  }
  process.exit(0);
})
.catch(error => {
  console.error("Critical synchronization error:", error.stack || error);
  process.exit(1);
});
