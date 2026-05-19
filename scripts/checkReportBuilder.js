const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildPnlSummaryRows,
  buildSkuDashboardRows,
  buildPnlFormatting,
  buildSkuDashboardFormatting,
  createReportBuilderService,
  SKU_DASHBOARD_HEADERS
} = require("../services/reportBuilder");
const { parseCogsCommand, parseReportCommand } = require("../services/telegram");
const { createCogsService } = require("../services/cogs");

async function run() {
  const performanceRows = [
    {
      date: "2026-05-01",
      sku: "111",
      productName: "Товар 1",
      revenue: 1000,
      spend: 100,
      orders: 2,
      modelOrders: 1,
      modelRevenue: 400,
      impressions: 1000,
      clicks: 50,
      addToCart: 7,
      price: 500
    },
    {
      date: "2026-05-01",
      sku: "222",
      productName: "Товар 2",
      revenue: 500,
      spend: 50,
      orders: 1,
      modelOrders: 0,
      modelRevenue: 0,
      impressions: 500,
      clicks: 10,
      addToCart: 2,
      price: 500
    },
    {
      date: "2026-05-02",
      sku: "111",
      productName: "Товар 1",
      revenue: 700,
      spend: 70,
      orders: 1,
      modelOrders: 1,
      modelRevenue: 300,
      impressions: 400,
      clicks: 20,
      addToCart: 3,
      price: 700
    }
  ];

  assert.deepStrictEqual(
    buildPnlSummaryRows(performanceRows, {
      dateFrom: "2026-05-01",
      dateTo: "2026-05-02"
    }),
    {
      headers: ["Metric", "2026-05-01", "2026-05-02"],
      rows: [
        ["Заказы", 3, 1],
        ["Продажи", 1500, 700],
        ["Реклама", 150, 70],
        ["от заказов", 1, 1],
        ["от продаж", 400, 300],
        ["Прибыль", 1350, 630],
        ["Себес", 0, 0],
        ["Доставка до МП", 0, 0],
        ["ВП", 1350, 630]
      ]
    }
  );

  assert.deepStrictEqual(
    buildPnlSummaryRows(
      [
        {
          date: "2026-05-13",
          orders: 1,
          revenue: 1000,
          adSpend: "200,00"
        },
        {
          date: "2026-05-14",
          orders: 2,
          revenue: 2000,
          cost: "300.00"
        }
      ],
      {
        dateFrom: "2026-05-13",
        dateTo: "2026-05-14"
      }
    ).rows.find(row => row[0] === "Реклама"),
    ["Реклама", 200, 300]
  );

  assert.deepStrictEqual(
    buildPnlSummaryRows(
      [
        {
          date: "2026-05-13",
          revenue: 1000,
          spend: 100,
          orders: 2,
          cogs: 50,
          logisticsToMp: 10
        }
      ],
      {
        dateFrom: "2026-05-13",
        dateTo: "2026-05-13"
      }
    ),
    {
      headers: ["Metric", "2026-05-13"],
      rows: [
        ["Заказы", 2],
        ["Продажи", 1000],
        ["Реклама", 100],
        ["от заказов", 0],
        ["от продаж", 0],
        ["Прибыль", 780],
        ["Себес", 100],
        ["Доставка до МП", 20],
        ["ВП", 780]
      ]
    }
  );

  assert.deepStrictEqual(
    buildPnlSummaryRows(
      [
        {
          date: "2026-05-13",
          rawDate: "13.05.2026",
          spend: "1987,68",
          revenue: "4567,89",
          orders: "3"
        },
        {
          date: "2026-05-14",
          rawDate: "14.05.2026",
          spend: "2079.48",
          revenue: "5000.00",
          orders: "4"
        }
      ],
      {
        dateFrom: "2026-05-13",
        dateTo: "2026-05-14"
      }
    ),
    {
      headers: ["Metric", "2026-05-13", "2026-05-14"],
      rows: [
        ["Заказы", 3, 4],
        ["Продажи", 4567.89, 5000],
        ["Реклама", 1987.68, 2079.48],
        ["от заказов", 0, 0],
        ["от продаж", 0, 0],
        ["Прибыль", 2580.21, 2920.52],
        ["Себес", 0, 0],
        ["Доставка до МП", 0, 0],
        ["ВП", 2580.21, 2920.52]
      ]
    }
  );

  const skuRows = buildSkuDashboardRows(performanceRows, [
    { name: "Товар 1", sku: "111", price: 999, offerId: "offer-111" },
    { name: "Товар 2", sku: "222", price: 555, offerId: "offer-222" }
  ]);

  assert.deepStrictEqual(skuRows[0], [
    "Товар 1",
    "",
    "",
    999,
    "",
    "offer-111",
    1700,
    3,
    566.67,
    170,
    10,
    700,
    2,
    350,
    170,
    10,
    "",
    1400,
    1400,
    70,
    5,
    10,
    ""
  ]);

  assert.deepStrictEqual(parseReportCommand("/report pnl 2026-05-01 2026-05-14"), {
    type: "pnl",
    toSheet: false,
    dateFrom: "2026-05-01",
    dateTo: "2026-05-14"
  });

  assert.deepStrictEqual(parseReportCommand("/report pnl в таблицу 2026-05-01 2026-05-14"), {
    type: "pnl",
    toSheet: true,
    dateFrom: "2026-05-01",
    dateTo: "2026-05-14"
  });

  assert.deepStrictEqual(parseReportCommand("/report sku 2026-05-01 2026-05-14"), {
    type: "sku",
    toSheet: false,
    dateFrom: "2026-05-01",
    dateTo: "2026-05-14"
  });

  assert.deepStrictEqual(parseReportCommand("/report sku в таблицу 2026-05-01 2026-05-14"), {
    type: "sku",
    toSheet: true,
    dateFrom: "2026-05-01",
    dateTo: "2026-05-14"
  });

  assert.deepStrictEqual(parseCogsCommand("/cogs template"), { type: "template" });
  assert.deepStrictEqual(parseCogsCommand("/cogs status"), { type: "status" });
  assert.deepStrictEqual(parseCogsCommand("/cogs clear"), { type: "clear" });
  assert.deepStrictEqual(parseCogsCommand("/cogs set SKU123 199.50"), {
    type: "set",
    sku: "SKU123",
    cogs: "199.50"
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-bot-cogs-"));
  const cogsService = createCogsService({
    filePath: path.join(tempDir, "cogs.json")
  });

  cogsService.setSku("111", 123.45, { logisticsToMp: 10, productName: "Товар 1" });
  assert.deepStrictEqual(cogsService.getCogsBySku("111"), {
    sku: "111",
    offerId: "",
    productName: "Товар 1",
    cogs: 123.45,
    logisticsToMp: 10,
    notes: ""
  });
  assert.deepStrictEqual(cogsService.getStatus(), {
    totalConfiguredSkus: 1,
    totalItems: 1
  });

  const capturedWrites = [];
  const reportBuilderService = createReportBuilderService({
    cogsService,
    ozonService: {
      getProducts: async () => [{ name: "Товар 1", sku: "111", offerId: "offer-111", price: 999 }]
    },
    performanceService: {
      getStoredRowsForDateRange: async () => [
        {
          date: "2026-05-13",
          sku: "111",
          productName: "Товар 1",
          offerId: "offer-111",
          revenue: "4567,89",
          spend: "1987,68",
          orders: "3"
        }
      ]
    },
    sheetsService: {
      clearAndWriteMappedRows: async (mappingKey, rows, options = {}) => {
        capturedWrites.push({
          mappingKey,
          rows,
          headers: options.headers || null,
          formatting: options.formatting || null
        });
        return { rowsWritten: rows.length, tabName: mappingKey };
      }
    }
  });

  await reportBuilderService.exportPnlReport({
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14"
  });
  await reportBuilderService.exportSkuReport({
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14"
  });

  assert.deepStrictEqual(capturedWrites[0].mappingKey, "pnl_summary");
  assert.deepStrictEqual(capturedWrites[0].headers, ["Metric", "2026-05-13", "2026-05-14"]);
  assert.strictEqual(capturedWrites[0].headers[0], "Metric");
  assert.deepStrictEqual(capturedWrites[0].formatting, buildPnlFormatting(["Metric", "2026-05-13", "2026-05-14"]));
  assert.deepStrictEqual(capturedWrites[1].mappingKey, "sku_dashboard");
  assert.deepStrictEqual(capturedWrites[1].headers, SKU_DASHBOARD_HEADERS);
  assert.strictEqual(capturedWrites[1].headers[0], "Название");
  assert.deepStrictEqual(capturedWrites[1].formatting, buildSkuDashboardFormatting());
  assert.deepStrictEqual(capturedWrites[1].rows[0], [
    "Товар 1",
    "",
    "",
    999,
    123.45,
    "offer-111",
    4567.89,
    3,
    1522.63,
    1987.68,
    43.51,
    0,
    0,
    "",
    1987.68,
    43.51,
    "",
    0,
    0,
    0,
    0,
    0,
    ""
  ]);

  const pnlRows = capturedWrites[0].rows;
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Себес"), ["Себес", 370.35, 0]);
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Доставка до МП"), ["Доставка до МП", 30, 0]);
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Прибыль"), ["Прибыль", 2179.86, 0]);

  console.log("Report builder checks passed");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
