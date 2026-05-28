const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  createCogsService,
  parseBulkImportText
} = require("../services/cogs");
const { createExternalTrafficPlanService } = require("../services/externalTrafficPlan");
const { createPrioritySkusService } = require("../services/prioritySkus");
const {
  allocateWeightedDemand,
  calculateExternalDemandValue,
  createReplenishmentService,
  getEstimatedUnitPrice,
  getPriority,
  indexStocksByCity,
  getCityForRegion,
  getRegionalSalesQuantity
} = require("../services/replenishment");
const {
  parseCogsCommand,
  parsePrioritySkuCommand,
  parseReplenishmentCommand,
  parseTrafficPlanCommand
} = require("../services/telegram");
const { createOzonService } = require("../services/ozon");

function cleanup(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

async function run() {
  console.log("Running checkCogsAndReplenishment.js tests...");

  console.log("Testing COGS import parser with space rows...");
  const parsedSpace = parseBulkImportText("SJ10 510\nSJ42 535\nsj58 499\nsj59 571\n");
  assert.strictEqual(parsedSpace.length, 4);
  assert.strictEqual(parsedSpace[0].offerId, "SJ10");
  assert.strictEqual(parsedSpace[3].offerId, "sj59");

  console.log("Testing COGS import parser with semicolon rows...");
  const parsedSemicolon = parseBulkImportText("SJ10;510\nSJ42;535;0\nSKU;Offer ID;Product Name;COGS;Logistics To MP\n");
  assert.strictEqual(parsedSemicolon.length, 2);
  assert.strictEqual(parsedSemicolon[1].logisticsToMp, 0);

  console.log("Testing COGS import parser with tab rows...");
  const parsedTab = parseBulkImportText("SJ10\t510\nSJ42\t535\t10\n");
  assert.strictEqual(parsedTab.length, 2);
  assert.strictEqual(parsedTab[1].logisticsToMp, 10);

  const tempCogsFile = path.join(__dirname, "../data/test-cogs.json");
  const tempPriorityFile = path.join(__dirname, "../data/test-priority-skus.json");
  const tempTrafficFile = path.join(__dirname, "../data/test-external-traffic-plan.json");
  cleanup(tempCogsFile);
  cleanup(tempPriorityFile);
  cleanup(tempTrafficFile);

  const cogsService = createCogsService({ filePath: tempCogsFile });
  const prioritySkusService = createPrioritySkusService({ filePath: tempPriorityFile });
  const externalTrafficPlanService = createExternalTrafficPlanService({ filePath: tempTrafficFile });

  cogsService.importText("SJ10 510\nSJ11 510\nSJ39 600\n");

  console.log("Testing case-insensitive offerId match...");
  const matchedExact = cogsService.resolveCogs(null, "SJ10");
  assert.ok(matchedExact);
  assert.strictEqual(matchedExact.source, "offerId");
  const matchedCI = cogsService.resolveCogs(null, "sj10");
  assert.ok(matchedCI);
  assert.strictEqual(matchedCI.source, "offerId-case-insensitive");

  console.log("Testing /cogs debug parser...");
  const cogsDebugCmd = parseCogsCommand("/cogs debug 2026-05-14");
  assert.strictEqual(cogsDebugCmd.type, "debug");

  console.log("Testing priority SKU parser...");
  assert.deepStrictEqual(parsePrioritySkuCommand("/priority sku add 2026-05 SJ11 1 Москва"), {
    type: "add",
    month: "2026-05",
    offerId: "SJ11",
    weight: "1",
    city: "Москва"
  });
  assert.deepStrictEqual(parsePrioritySkuCommand("/priority sku list 2026-05"), {
    type: "list",
    month: "2026-05"
  });
  assert.deepStrictEqual(parsePrioritySkuCommand("/priority sku debug 2026-05"), {
    type: "debug",
    month: "2026-05"
  });

  console.log("Testing traffic plan parser...");
  assert.deepStrictEqual(parseTrafficPlanCommand("/traffic plan set 2026-05 200000 2 Москва"), {
    type: "set",
    month: "2026-05",
    budget: "200000",
    coefficient: "2",
    city: "Москва"
  });
  assert.deepStrictEqual(parseTrafficPlanCommand("/traffic plan status 2026-05"), {
    type: "status",
    month: "2026-05"
  });

  console.log("Testing replenishment parser...");
  assert.deepStrictEqual(parseReplenishmentCommand("/replenishment debug 2026-05-13 2026-05-14"), {
    type: "debug",
    toSheet: false,
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14"
  });
  assert.deepStrictEqual(parseReplenishmentCommand("/replenishment traffic debug 2026-05-01 2026-05-31"), {
    type: "traffic_debug",
    toSheet: false,
    dateFrom: "2026-05-01",
    dateTo: "2026-05-31"
  });

  console.log("Testing duplicate priority SKU updates...");
  prioritySkusService.addOrUpdate({ month: "2026-05", offerId: "SJ11", weight: 1, city: "Москва" });
  prioritySkusService.addOrUpdate({ month: "2026-05", offerId: "sj11", weight: 3, city: "Москва" });
  const priorityList = prioritySkusService.list("2026-05");
  assert.strictEqual(priorityList.length, 1);
  assert.strictEqual(priorityList[0].weight, 3);

  console.log("Testing traffic plan set/status/clear...");
  externalTrafficPlanService.setPlan({ month: "2026-05", budget: 200000, coefficient: 2, city: "Москва" });
  const plan = externalTrafficPlanService.getPlan("2026-05");
  assert.strictEqual(plan.budget, 200000);
  assert.strictEqual(plan.coefficient, 2);

  console.log("Testing external demand value calculation...");
  assert.strictEqual(calculateExternalDemandValue(200000, 2), 400000);

  console.log("Testing weighted allocation...");
  const weighted = allocateWeightedDemand([
    { offerId: "SJ11", weight: 1 },
    { offerId: "SJ39", weight: 3 }
  ], 400000);
  assert.strictEqual(weighted[0].allocatedDemandValue, 100000);
  assert.strictEqual(weighted[1].allocatedDemandValue, 300000);

  console.log("Testing price fallback...");
  assert.deepStrictEqual(getEstimatedUnitPrice({ averageUnitPrice: 1234.56 }, { price: 500 }), {
    price: 1234.56,
    source: "sales"
  });
  assert.deepStrictEqual(getEstimatedUnitPrice({ averageUnitPrice: 0 }, { price: "777" }), {
    price: 777,
    source: "product"
  });

  console.log("Testing replenishment priority logic...");
  assert.strictEqual(getPriority(0, 0), "HIGH");
  assert.strictEqual(getPriority(-1, 0), "HIGH");
  assert.strictEqual(getPriority(10, 5), "HIGH");
  assert.strictEqual(getPriority(10, 10), "MEDIUM");
  assert.strictEqual(getPriority(10, 20), "LOW");

  console.log("Testing city helpers...");
  assert.strictEqual(getCityForRegion("Москва Г."), "Москва");
  assert.strictEqual(getCityForRegion("Санкт-Петербург г."), "СПб");
  assert.strictEqual(getCityForRegion("Республика Татарстан"), "Казань");
  assert.strictEqual(getCityForRegion("Челябинская обл."), "unknown");

  const ozonService = createOzonService({ clientId: "dummy", apiKey: "dummy" });
  assert.strictEqual(ozonService.getCityForWarehouse("1", "Хоругвино"), "Москва");
  const stockIndex = indexStocksByCity([
    {
      sku: "SKU1",
      offerId: "OFF1",
      stocks: [
        { warehouse_id: "1", warehouse_name: "Хоругвино", present: 10, reserved: 2, available: 8 },
        { warehouse_id: "2", warehouse_name: "Пушкино", present: 20, reserved: 5, available: 15 }
      ]
    }
  ], ozonService);
  assert.strictEqual(stockIndex.bySkuCity.get("SKU1|Москва").available, 23);

  const regionalQty = getRegionalSalesQuantity([
    { sku: "SKU1", offerId: "OFF1", quantity: 10, region: "Москва Г." },
    { sku: "SKU1", offerId: "OFF1", quantity: 5, region: "Республика Татарстан" },
    { sku: "SKU1", offerId: "OFF1", quantity: 10, region: "Неизвестный регион" }
  ]);
  assert.strictEqual(regionalQty.get("SKU1")["Москва"], 16);
  assert.strictEqual(regionalQty.get("SKU1")["СПб"], 2);
  assert.strictEqual(regionalQty.get("SKU1")["Казань"], 7);

  console.log("Testing organic-only behavior unchanged when no traffic plan exists...");
  const organicOnlyService = createReplenishmentService({
    cogsService,
    prioritySkusService,
    externalTrafficPlanService,
    ozonService: {
      getProducts: async () => [{ sku: "111", offerId: "SJ10", name: "Product SJ10", price: 500 }],
      getStocks: async () => { throw new Error("Stocks fail"); }
    },
    salesFactsService: {
      getSalesRowsForDateRange: () => [{ date: "2026-05-14", sku: "111", offerId: "SJ10", quantity: 5, revenue: 1000 }]
    },
    sheetsService: null
  });
  const organicOnlyForecast = await organicOnlyService.buildForecast({ dateFrom: "2026-05-14", dateTo: "2026-05-14" });
  assert.strictEqual(organicOnlyForecast.rows[0][9], 0);
  assert.strictEqual(organicOnlyForecast.rows[0][10], 0);
  assert.ok(organicOnlyForecast.warnings.includes("Stocks unavailable, forecast uses zero stock."));
  assert.ok(!organicOnlyForecast.rows[0][15].includes("Stocks unavailable"));

  console.log("Testing missing priority SKU warning...");
  const warningOnlyTrafficService = createReplenishmentService({
    cogsService,
    prioritySkusService,
    externalTrafficPlanService,
    ozonService: {
      getProducts: async () => [{ sku: "111", offerId: "SJ10", name: "Product SJ10", price: 500 }],
      getStocks: async () => []
    },
    salesFactsService: {
      getSalesRowsForDateRange: () => [{ date: "2026-05-14", sku: "111", offerId: "SJ10", quantity: 5, revenue: 1000 }]
    },
    sheetsService: null
  });
  externalTrafficPlanService.setPlan({ month: "2026-05", budget: 200000, coefficient: 2, city: "Москва" });
  prioritySkusService.clear("2026-05");
  const warningForecast = await warningOnlyTrafficService.buildForecast({ dateFrom: "2026-05-14", dateTo: "2026-05-14" });
  assert.ok(warningForecast.warnings.includes("External traffic plan exists, but no priority SKUs configured."));

  console.log("Testing full external traffic allocation and Moscow-only placement...");
  prioritySkusService.addOrUpdate({ month: "2026-05", offerId: "SJ11", weight: 1, city: "Москва" });
  prioritySkusService.addOrUpdate({ month: "2026-05", offerId: "SJ39", weight: 3, city: "Москва" });
  const replenishmentWrites = [];
  const replenishmentService = createReplenishmentService({
    cogsService,
    prioritySkusService,
    externalTrafficPlanService,
    ozonService: {
      getProducts: async () => [
        { name: "Товар 1", sku: "111", offerId: "SJ11", price: 1000 },
        { name: "Товар 2", sku: "222", offerId: "SJ39", price: 1500 }
      ],
      getStocks: async () => [
        {
          sku: "111",
          offerId: "SJ11",
          stocks: [{ warehouse_id: "1", warehouse_name: "Хоругвино", present: 20, reserved: 0, available: 20 }]
        },
        {
          sku: "222",
          offerId: "SJ39",
          stocks: [{ warehouse_id: "2", warehouse_name: "Хоругвино", present: 10, reserved: 0, available: 10 }]
        }
      ],
      getCityForWarehouse: (id, name) => String(name || "").toLowerCase().includes("хоругвино") ? "Москва" : "unknown"
    },
    salesFactsService: {
      getSalesRowsForDateRange: () => [
        { date: "2026-05-13", sku: "111", offerId: "SJ11", productName: "Товар 1", quantity: 10, revenue: 10000, region: "Москва" },
        { date: "2026-05-14", sku: "111", offerId: "SJ11", productName: "Товар 1", quantity: 10, revenue: 10000, region: "Москва" },
        { date: "2026-05-13", sku: "222", offerId: "SJ39", productName: "Товар 2", quantity: 20, revenue: 30000, region: "Москва" },
        { date: "2026-05-14", sku: "222", offerId: "SJ39", productName: "Товар 2", quantity: 20, revenue: 30000, region: "Москва" }
      ]
    },
    sheetsService: {
      clearAndWriteMappedRows: async (mappingKey, rows, options = {}) => {
        replenishmentWrites.push({ mappingKey, rows, headers: options.headers });
        return { rowsWritten: rows.length, tabName: "Replenishment Plan" };
      }
    },
    forecastDays: 21,
    safetyDays: 7,
    minShipment: 1
  });

  const forecast = await replenishmentService.buildForecast({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
  const trafficDebug = await replenishmentService.buildTrafficDebug({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
  assert.strictEqual(trafficDebug.externalDemandValue, 400000);
  assert.strictEqual(trafficDebug.allocations[0].allocatedDemandValue, 100000);
  assert.strictEqual(trafficDebug.allocations[1].allocatedDemandValue, 300000);

  const sj11Moscow = forecast.rows.find(row => row[3] === "SJ11" && row[0] === "Москва");
  const sj11Spb = forecast.rows.find(row => row[3] === "SJ11" && row[0] === "СПб");
  const sj39Moscow = forecast.rows.find(row => row[3] === "SJ39" && row[0] === "Москва");
  assert.ok(sj11Moscow);
  assert.ok(sj39Moscow);
  assert.strictEqual(sj11Moscow[9], 100000);
  assert.strictEqual(sj11Moscow[10], 100);
  assert.strictEqual(sj11Moscow[14], "organic + external traffic");
  assert.strictEqual(sj39Moscow[9], 300000);
  assert.strictEqual(sj39Moscow[10], 200);
  assert.strictEqual(sj11Spb[9], 0);
  assert.strictEqual(sj11Spb[10], 0);

  const debugRows = await replenishmentService.buildDebug({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
  const debugSj11 = debugRows.find(row => row.offerId === "SJ11");
  assert.strictEqual(debugSj11.cogsSource, "offerId");

  const exportResult = await replenishmentService.exportForecast({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
  assert.strictEqual(exportResult.writeResult.tabName, "Replenishment Plan");
  assert.strictEqual(replenishmentWrites[0].mappingKey, "replenishment_plan");
  assert.deepStrictEqual(replenishmentWrites[0].headers, [
    "City",
    "Warehouse",
    "SKU",
    "Offer ID",
    "Product Name",
    "Organic Sales Per Day",
    "Current Stock",
    "Days Of Stock",
    "Organic Target Stock",
    "External Traffic Demand ₽",
    "External Traffic Units",
    "Total Target Stock",
    "Recommended Shipment",
    "Priority",
    "Demand Source",
    "Comment"
  ]);

  console.log("Testing missing price warning...");
  prioritySkusService.clear("2026-05");
  prioritySkusService.addOrUpdate({ month: "2026-05", offerId: "SJ404", weight: 1, city: "Москва" });
  const missingPriceService = createReplenishmentService({
    cogsService,
    prioritySkusService,
    externalTrafficPlanService,
    ozonService: {
      getProducts: async () => [{ name: "No Price Product", sku: "", offerId: "SJ404", price: "" }],
      getStocks: async () => []
    },
    salesFactsService: {
      getSalesRowsForDateRange: () => []
    },
    sheetsService: null
  });
  const missingPriceDebug = await missingPriceService.buildTrafficDebug({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
  assert.ok(missingPriceDebug.warnings.some(item => item.includes("No estimated price for priority SKU SJ404")));
  assert.strictEqual(missingPriceDebug.allocations[0].externalTrafficUnits, 0);

  cleanup(tempCogsFile);
  cleanup(tempPriorityFile);
  cleanup(tempTrafficFile);
  console.log("All checkCogsAndReplenishment.js tests passed successfully!");
}

run().catch(error => {
  console.error("Test failed:", error);
  process.exit(1);
});
