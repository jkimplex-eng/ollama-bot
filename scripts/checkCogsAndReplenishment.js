const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  createCogsService,
  parseBulkImportText
} = require("../services/cogs");

const {
  createReplenishmentService,
  getPriority
} = require("../services/replenishment");

const {
  parseCogsCommand,
  parseReplenishmentCommand
} = require("../services/telegram");

console.log("Running checkCogsAndReplenishment.js tests...");

// 1. Test COGS import parser with space rows
console.log("Testing COGS import parser with space rows...");
const spaceImportText = `
SJ10 510
SJ42 535
sj58 499
sj59 571
`;
const parsedSpace = parseBulkImportText(spaceImportText);
assert.strictEqual(parsedSpace.length, 4);
assert.strictEqual(parsedSpace[0].offerId, "SJ10");
assert.strictEqual(parsedSpace[0].cogs, 510);
assert.strictEqual(parsedSpace[3].offerId, "sj59");
assert.strictEqual(parsedSpace[3].cogs, 571);

// 2. Test COGS import parser with semicolon rows
console.log("Testing COGS import parser with semicolon rows...");
const semicolonImportText = `
SJ10;510
SJ42;535;0
SKU;Offer ID;Product Name;COGS;Logistics To MP
`;
const parsedSemicolon = parseBulkImportText(semicolonImportText);
assert.strictEqual(parsedSemicolon.length, 2);
assert.strictEqual(parsedSemicolon[0].offerId, "SJ10");
assert.strictEqual(parsedSemicolon[0].cogs, 510);
assert.strictEqual(parsedSemicolon[1].offerId, "SJ42");
assert.strictEqual(parsedSemicolon[1].logisticsToMp, 0);

// 3. Test COGS import parser with tab rows
console.log("Testing COGS import parser with tab rows...");
const tabImportText = `
SJ10\t510
SJ42\t535\t10
`;
const parsedTab = parseBulkImportText(tabImportText);
assert.strictEqual(parsedTab.length, 2);
assert.strictEqual(parsedTab[0].offerId, "SJ10");
assert.strictEqual(parsedTab[0].cogs, 510);
assert.strictEqual(parsedTab[1].offerId, "SJ42");
assert.strictEqual(parsedTab[1].cogs, 535);
assert.strictEqual(parsedTab[1].logisticsToMp, 10);

// 4. Test case-insensitive offerId match
console.log("Testing case-insensitive offerId match...");
const tempFilePath = path.join(__dirname, "../data/test-cogs.json");
if (fs.existsSync(tempFilePath)) {
  fs.unlinkSync(tempFilePath);
}
const cogsService = createCogsService({ filePath: tempFilePath });
cogsService.importText("SJ10 510");
const matchedExact = cogsService.resolveCogs(null, "SJ10");
assert.ok(matchedExact);
assert.strictEqual(matchedExact.source, "offerId");
assert.strictEqual(matchedExact.match.cogs, 510);

const matchedCI = cogsService.resolveCogs(null, "sj10");
assert.ok(matchedCI);
assert.strictEqual(matchedCI.source, "offerId-case-insensitive");
assert.strictEqual(matchedCI.match.cogs, 510);

// 5. Test /cogs debug parser
console.log("Testing /cogs debug parser...");
const cogsDebugCmd = parseCogsCommand("/cogs debug 2026-05-14");
assert.ok(cogsDebugCmd);
assert.strictEqual(cogsDebugCmd.type, "debug");
assert.strictEqual(cogsDebugCmd.date, "2026-05-14");

// 6. Test replenishment HIGH priority with stock <= 0 or daysOfStock < 7
console.log("Testing replenishment priority logic...");
assert.strictEqual(getPriority(0, 0), "HIGH");
assert.strictEqual(getPriority(-1, 0), "HIGH");
assert.strictEqual(getPriority(10, 5), "HIGH");
assert.strictEqual(getPriority(10, 10), "MEDIUM");
assert.strictEqual(getPriority(10, 20), "LOW");

// 7. Test stock warning in replenishment forecast
console.log("Testing stock warning and comment generation in replenishment...");
// Mock ozonService, salesFactsService, sheetsService
const mockOzonService = {
  getProducts: async () => [{ sku: "111", offerId: "SJ10", name: "Product SJ10" }],
  getStocks: async () => { throw new Error("Stocks fail"); }
};
const mockSalesService = {
  getSalesRowsForDateRange: () => [{ date: "2026-05-14", sku: "111", offerId: "SJ10", quantity: 5, revenue: 1000 }]
};
const replenishmentService = createReplenishmentService({
  cogsService,
  ozonService: mockOzonService,
  salesFactsService: mockSalesService,
  sheetsService: null
});

replenishmentService.buildForecast({ dateFrom: "2026-05-14", dateTo: "2026-05-14" })
  .then(forecast => {
    assert.strictEqual(forecast.warnings.length, 1);
    assert.strictEqual(forecast.warnings[0], "Stocks unavailable, forecast uses zero stock.");
    assert.strictEqual(forecast.rows.length, 3);
    
    // The comment row is the 12th element (index 11) in the row array
    const comment = forecast.rows[0][11];
    // Comment should not contain the warning repeated
    assert.ok(!comment.includes("Stocks unavailable"));
    assert.ok(comment.includes("Нет разбивки по складам"));
    console.log("Replenishment warnings test passed successfully.");

    // 8. Test /replenishment debug parser
    console.log("Testing /replenishment debug parser...");
    const replDebugCmd = parseReplenishmentCommand("/replenishment debug 2026-05-13 2026-05-14");
    assert.ok(replDebugCmd);
    assert.strictEqual(replDebugCmd.type, "debug");
    assert.strictEqual(replDebugCmd.dateFrom, "2026-05-13");
    assert.strictEqual(replDebugCmd.dateTo, "2026-05-14");

    // 9. Test getCityForWarehouse
    console.log("Testing getCityForWarehouse mapping...");
    const { createOzonService } = require("../services/ozon");
    const ozonService = createOzonService({ clientId: "dummy", apiKey: "dummy" });
    assert.strictEqual(ozonService.getCityForWarehouse("1", "Хоругвино"), "Москва");
    assert.strictEqual(ozonService.getCityForWarehouse("2", "Пушкино РФ"), "Москва");
    assert.strictEqual(ozonService.getCityForWarehouse("3", "Шушары СПб"), "СПб");
    assert.strictEqual(ozonService.getCityForWarehouse("4", "Зеленодольск Казань"), "Казань");
    assert.strictEqual(ozonService.getCityForWarehouse("5", "Неизвестный склад"), "unknown");

    // 10. Test indexStocksByCity aggregation
    console.log("Testing indexStocksByCity...");
    const { indexStocksByCity } = require("../services/replenishment");
    const testStocks = [
      {
        sku: "SKU1",
        offerId: "OFF1",
        stocks: [
          { warehouse_id: "1", warehouse_name: "Хоругвино", present: 10, reserved: 2, available: 8 },
          { warehouse_id: "2", warehouse_name: "Пушкино", present: 20, reserved: 5, available: 15 }
        ]
      }
    ];
    const stockIndex = indexStocksByCity(testStocks, ozonService);
    const moscowEntry = stockIndex.bySkuCity.get("SKU1|Москва");
    assert.ok(moscowEntry);
    assert.strictEqual(moscowEntry.present, 30);
    assert.strictEqual(moscowEntry.reserved, 7);
    assert.strictEqual(moscowEntry.available, 23);

    // Clean up
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    console.log("All checkCogsAndReplenishment.js tests passed successfully!");
  })
  .catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
  });
