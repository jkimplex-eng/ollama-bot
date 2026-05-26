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
const { createDailyControlService } = require("../services/dailyControl");
const { createManagementWorkbookService, DAILY_INPUT_WRITE_COLUMNS, MAX_BACKFILL_DAYS } = require("../services/managementWorkbook");
const { parseCogsCommand, parseDailyControlCommand, parseFinanceCommand, parseManagementCommand, parseReplenishmentCommand, parseReportCommand, parseSalesCommand } = require("../services/telegram");
const { createCogsService, parseBulkImportText } = require("../services/cogs");
const { createFinanceFactsService } = require("../services/financeFacts");
const {
  calculateDaysOfStock,
  calculateRecommendedShipment,
  calculateSalesPerDay,
  calculateTargetStock,
  createReplenishmentService,
  getPriority
} = require("../services/replenishment");
const { createSalesFactsService } = require("../services/salesFacts");
const { clampOzonLimit, createOzonService, getPageSignature, getPostingIdentity } = require("../services/ozon");

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
      dateTo: "2026-05-02",
      salesRows: [
        { date: "2026-05-01", quantity: 3, revenue: 1500 },
        { date: "2026-05-02", quantity: 1, revenue: 700 }
      ],
      financeRows: [
        {
          date: "2026-05-01",
          sales: 1500,
          returns: 0,
          ozonCommission: -150,
          logistics: -50,
          partnerServices: 0,
          fboServices: 0,
          advertising: -150,
          otherServices: 0,
          accruedTotal: 1150
        },
        {
          date: "2026-05-02",
          sales: 700,
          returns: 0,
          ozonCommission: -70,
          logistics: -20,
          partnerServices: 0,
          fboServices: 0,
          advertising: -70,
          otherServices: 0,
          accruedTotal: 540
        }
      ]
    }),
    {
      headers: ["Metric", "2026-05-01", "2026-05-02"],
      rows: [
        ["Заказано", 1500, 700],
        ["Продажи", 1500, 700],
        ["Возвраты", 0, 0],
        ["Реклама", -150, -70],
        ["Комиссия Ozon", -150, -70],
        ["Логистика", -50, -20],
        ["Услуги партнёров", 0, 0],
        ["Услуги FBO", 0, 0],
        ["Себес", 0, 0],
        ["Прибыль", 1150, 540],
        ["Начислено / Выплата", 1150, 540]
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
      [{ date: "2026-05-13", spend: 100 }],
      {
        dateFrom: "2026-05-13",
        dateTo: "2026-05-13",
        salesRows: [{ date: "2026-05-13", quantity: 2, revenue: 1000, cogs: 50 }],
        financeRows: [
          {
            date: "2026-05-13",
            sales: 900,
            returns: -50,
            ozonCommission: -100,
            logistics: -20,
            partnerServices: -10,
            fboServices: -5,
            advertising: -80,
            otherServices: 0,
            accruedTotal: 635
          }
        ]
      }
    ),
    {
      headers: ["Metric", "2026-05-13"],
      rows: [
        ["Заказано", 1000],
        ["Продажи", 900],
        ["Возвраты", -50],
        ["Реклама", -100],
        ["Комиссия Ozon", -100],
        ["Логистика", -20],
        ["Услуги партнёров", -10],
        ["Услуги FBO", -5],
        ["Себес", 100],
        ["Прибыль", 515],
        ["Начислено / Выплата", 635]
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
        dateTo: "2026-05-14",
        salesRows: [
          { date: "13.05.2026", quantity: "3", revenue: "4567,89" },
          { date: "2026-05-14", quantity: "4", revenue: "5000.00" }
        ]
      }
    ),
    {
      headers: ["Metric", "2026-05-13", "2026-05-14"],
      rows: [
        ["Заказано", 4567.89, 5000],
        ["Продажи", 0, 0],
        ["Возвраты", 0, 0],
        ["Реклама", 1987.68, 2079.48],
        ["Комиссия Ozon", 0, 0],
        ["Логистика", 0, 0],
        ["Услуги партнёров", 0, 0],
        ["Услуги FBO", 0, 0],
        ["Себес", 0, 0],
        ["Прибыль", -1987.68, -2079.48],
        ["Начислено / Выплата", 0, 0]
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
    1530,
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
  assert.deepStrictEqual(parseDailyControlCommand("/daily control 2026-05-14"), {
    toSheet: false,
    dateInput: "2026-05-14"
  });
  assert.deepStrictEqual(parseDailyControlCommand("/daily control today"), {
    toSheet: false,
    dateInput: "today"
  });
  assert.deepStrictEqual(parseDailyControlCommand("/daily control в таблицу yesterday"), {
    toSheet: true,
    dateInput: "yesterday"
  });
  assert.deepStrictEqual(parseManagementCommand("/management daily 2026-05-14"), {
    type: "daily",
    toSheet: false,
    value: "2026-05-14"
  });
  assert.deepStrictEqual(parseManagementCommand("/management month в таблицу 2026-05"), {
    type: "month",
    toSheet: true,
    value: "2026-05"
  });
  assert.deepStrictEqual(parseManagementCommand("/management dashboard 2026-05"), {
    type: "dashboard",
    toSheet: false,
    value: "2026-05"
  });
  assert.deepStrictEqual(parseManagementCommand("/management backfill 2026-05-01 2026-05-14"), {
    type: "backfill",
    toSheet: false,
    dateFrom: "2026-05-01",
    dateTo: "2026-05-14"
  });
  assert.deepStrictEqual(parseManagementCommand("/management backfill в таблицу 2026-05-01 2026-05-14"), {
    type: "backfill",
    toSheet: true,
    dateFrom: "2026-05-01",
    dateTo: "2026-05-14"
  });

  assert.deepStrictEqual(parseCogsCommand("/cogs template"), { type: "template" });
  assert.deepStrictEqual(parseCogsCommand("/cogs list"), { type: "list" });
  assert.deepStrictEqual(parseCogsCommand("/cogs status"), { type: "status" });
  assert.deepStrictEqual(parseCogsCommand("/cogs clear"), { type: "clear" });
  assert.deepStrictEqual(parseCogsCommand("/cogs import text"), { type: "import_text" });
  assert.deepStrictEqual(parseCogsCommand("/cogs set SKU123 199.50"), {
    type: "set",
    sku: "SKU123",
    cogs: "199.50",
    logisticsToMp: ""
  });
  assert.deepStrictEqual(parseCogsCommand("/cogs set SJ11 199.50 15"), {
    type: "set",
    sku: "SJ11",
    cogs: "199.50",
    logisticsToMp: "15"
  });
  assert.deepStrictEqual(parseSalesCommand("/sales status"), { type: "status" });
  assert.deepStrictEqual(parseSalesCommand("/sales clear"), { type: "clear" });
  assert.deepStrictEqual(parseSalesCommand("/sales fetch 2026-05-13 2026-05-14"), {
    type: "fetch",
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14"
  });
  assert.deepStrictEqual(parseFinanceCommand("/finance status"), { type: "status" });
  assert.deepStrictEqual(parseFinanceCommand("/finance clear"), { type: "clear" });
  assert.deepStrictEqual(parseFinanceCommand("/finance import sample"), { type: "import_sample" });
  assert.deepStrictEqual(parseFinanceCommand("/finance fetch 2026-05-13 2026-05-14"), {
    type: "fetch",
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14"
  });
  assert.deepStrictEqual(parseFinanceCommand("/finance debug 2026-05-13 2026-05-14"), {
    type: "debug",
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14"
  });
  assert.deepStrictEqual(parseReplenishmentCommand("/replenishment forecast 2026-05-13 2026-05-14"), {
    type: "forecast",
    toSheet: false,
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14"
  });
  assert.deepStrictEqual(parseReplenishmentCommand("/replenishment forecast в таблицу 2026-05-13 2026-05-14"), {
    type: "forecast",
    toSheet: true,
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14"
  });
  assert.strictEqual(calculateSalesPerDay(62, 2), 31);
  assert.strictEqual(calculateTargetStock(31, 21, 7), 868);
  assert.strictEqual(calculateRecommendedShipment(868, 200, 1), 668);
  assert.strictEqual(calculateRecommendedShipment(10, 10, 1), 0);
  assert.strictEqual(calculateDaysOfStock(42, 6), 7);
  assert.strictEqual(getPriority(6), "HIGH");
  assert.strictEqual(getPriority(10), "MEDIUM");
  assert.strictEqual(getPriority(20), "LOW");
  assert.strictEqual(clampOzonLimit(150), 100);
  assert.strictEqual(clampOzonLimit(undefined), 100);
  assert.strictEqual(clampOzonLimit(0), 100);
  assert.strictEqual(clampOzonLimit(25), 25);
  assert.strictEqual(getPostingIdentity({ posting_number: "posting-1" }), "posting-1");
  assert.strictEqual(
    getPageSignature([{ posting_number: "posting-1" }, { posting_number: "posting-2" }]),
    JSON.stringify({ count: 2, firstPostingId: "posting-1", lastPostingId: "posting-2" })
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-bot-cogs-"));
  const cogsService = createCogsService({
    filePath: path.join(tempDir, "cogs.json")
  });
  const financeFactsService = createFinanceFactsService({
    filePath: path.join(tempDir, "finance-rows.json")
  });
  const salesFactsService = createSalesFactsService({
    filePath: path.join(tempDir, "sales-rows.json")
  });

  assert.deepStrictEqual(
    parseBulkImportText("SKU;Offer ID;Product Name;COGS;Logistics To MP\n111;SJ11;Товар 1;510;12"),
    [
      {
        sku: "111",
        offerId: "SJ11",
        offerIdKey: "sj11",
        productName: "Товар 1",
        cogs: 510,
        logisticsToMp: 12,
        notes: ""
      }
    ]
  );

  assert.deepStrictEqual(
    parseBulkImportText("SJ10\t510\nsj59\t571"),
    [
      {
        sku: "",
        offerId: "SJ10",
        offerIdKey: "sj10",
        productName: "",
        cogs: 510,
        logisticsToMp: 0,
        notes: ""
      },
      {
        sku: "",
        offerId: "sj59",
        offerIdKey: "sj59",
        productName: "",
        cogs: 571,
        logisticsToMp: 0,
        notes: ""
      }
    ]
  );

  cogsService.setSku("111", 123.45, { logisticsToMp: 10, productName: "Товар 1" });
  cogsService.setSku("222", 50, { logisticsToMp: 5, productName: "Товар 2" });
  cogsService.importText("SJ10\t510\nsj59\t571");
  assert.deepStrictEqual(cogsService.getCogsBySku("111"), {
    sku: "111",
    offerId: "",
    offerIdKey: "",
    productName: "Товар 1",
    cogs: 123.45,
    logisticsToMp: 10,
    notes: ""
  });
  assert.strictEqual(cogsService.getCogsByOfferId("SJ10").cogs, 510);
  assert.strictEqual(cogsService.getCogsByOfferId("sj10").cogs, 510);
  assert.deepStrictEqual(cogsService.getStatus(), {
    totalConfiguredSkus: 2,
    totalItems: 4
  });
  assert.deepStrictEqual(
    cogsService.mergeCogsIntoPerformanceRows([{ sku: "", offerId: "SJ59", quantity: 1 }]).rows[0],
    {
      sku: "",
      offerId: "SJ59",
      quantity: 1,
      cogs: 571,
      logisticsToMp: 0,
      cogsConfigured: true
    }
  );
  assert.deepStrictEqual(
    salesFactsService.saveSalesRows(
      [
        {
          date: "13.05.2026",
          sku: "111",
          offerId: "offer-111",
          productName: "Товар 1",
          quantity: "3",
          revenue: "4567,89",
          price: "1522,63",
          postingNumber: "posting-1",
          status: "delivered"
        },
        {
          date: "2026-05-14",
          sku: "222",
          offerId: "offer-222",
          productName: "Товар 2",
          quantity: 2,
          revenue: 2000,
          price: 1000,
          postingNumber: "posting-2",
          status: "delivered"
        },
        {
          date: "2026-05-13",
          sku: "111",
          offerId: "offer-111",
          productName: "Товар 1",
          quantity: 3,
          revenue: 4567.89,
          price: 1522.63,
          postingNumber: "posting-1",
          status: "delivered"
        }
      ],
      {
        dateFrom: "2026-05-13",
        dateTo: "2026-05-14",
        savedAt: "2026-05-15T00:00:00.000Z"
      }
    ),
    {
      totalStoredRows: 2,
      rowsSaved: 3
    }
  );
  assert.deepStrictEqual(salesFactsService.getSalesRowsStatus(), {
    totalStoredRows: 2,
    minDate: "2026-05-13",
    maxDate: "2026-05-14",
    uniqueSkus: 2
  });
  assert.deepStrictEqual(
    salesFactsService.getSalesRowsForDateRange("2026-05-13", "2026-05-14").map(row => row.sku),
    ["111", "222"]
  );
  assert.deepStrictEqual(
    salesFactsService.aggregateSalesByDate(
      salesFactsService.getSalesRowsForDateRange("2026-05-13", "2026-05-14")
    ),
    [
      { date: "2026-05-13", quantity: 3, revenue: 4567.89, orders: 1 },
      { date: "2026-05-14", quantity: 2, revenue: 2000, orders: 1 }
    ]
  );
  assert.deepStrictEqual(
    salesFactsService.aggregateSalesBySku(
      salesFactsService.getSalesRowsForDateRange("2026-05-13", "2026-05-14")
    ),
    [
      { sku: "111", offerId: "offer-111", productName: "Товар 1", quantity: 3, revenue: 4567.89 },
      { sku: "222", offerId: "offer-222", productName: "Товар 2", quantity: 2, revenue: 2000 }
    ]
  );
  assert.deepStrictEqual(
    financeFactsService.importSample(),
    {
      totalStoredRows: 1,
      rowsSaved: 1
    }
  );
  assert.deepStrictEqual(financeFactsService.getFinanceRowsStatus(), {
    totalStoredRows: 1,
    minDate: "2026-05-14",
    maxDate: "2026-05-14"
  });
  assert.deepStrictEqual(
    financeFactsService.getFinanceRowsForDateRange("2026-05-14", "2026-05-14")[0],
    {
      date: "2026-05-14",
      sales: 396053,
      returns: -10173,
      ozonCommission: -158211,
      logistics: -14147,
      partnerServices: -3742,
      fboServices: -1625,
      advertising: -39695,
      otherServices: 0,
      accruedTotal: 166855
    }
  );

  salesFactsService.clearSalesRows();
  financeFactsService.clearFinanceRows();
  cogsService.clear();
  cogsService.setSku("111", 100, { logisticsToMp: 10 });
  cogsService.setSku("222", 50, { logisticsToMp: 5 });
  salesFactsService.saveSalesRows(
    [
      {
        date: "2026-05-13",
        sku: "111",
        offerId: "offer-111",
        productName: "Товар 1",
        quantity: 2,
        revenue: 2000,
        price: 1000,
        postingNumber: "posting-a"
      },
      {
        date: "2026-05-14",
        sku: "222",
        offerId: "offer-222",
        productName: "Товар 2",
        quantity: 3,
        revenue: 3000,
        price: 1000,
        postingNumber: "posting-b"
      }
    ],
    { source: "test" }
  );
  financeFactsService.saveFinanceRows(
    [
      {
        date: "2026-05-13",
        sales: 1800,
        returns: -100,
        ozonCommission: -200,
        logistics: -50,
        partnerServices: -20,
        fboServices: -10,
        advertising: -300,
        otherServices: 0,
        accruedTotal: 1120
      },
      {
        date: "2026-05-14",
        sales: 2600,
        returns: -200,
        ozonCommission: -300,
        logistics: -70,
        partnerServices: -30,
        fboServices: -20,
        advertising: -400,
        otherServices: 0,
        accruedTotal: 1580
      }
    ],
    { source: "test" }
  );

  const dailyControlWrites = [];
  const dailyControlService = createDailyControlService({
    cogsService,
    financeFactsService,
    performanceService: {
      getStoredRowsForDateRange: async () => [
        { date: "2026-05-13", spend: 320 },
        { date: "2026-05-14", spend: 410 }
      ]
    },
    salesFactsService,
    sheetsService: {
      updateMappedRowByDate: async (mappingKey, date, row, options = {}) => {
        dailyControlWrites.push({ mappingKey, date, row, headers: options.headers });
        return { rowsWritten: 1, tabName: "Daily Control" };
      }
    },
    planVpPerDay: 180645
  });

  const dailyControlResult = await dailyControlService.buildDailyControl("2026-05-14");
  assert.strictEqual(dailyControlResult.date, "2026-05-14");
  assert.deepStrictEqual(dailyControlResult.headers[0], "Дата");
  assert.deepStrictEqual(dailyControlResult.row.slice(0, 10), [
    "2026-05-14",
    dailyControlResult.row[1],
    3000,
    2600,
    -400,
    150,
    15,
    1430,
    55,
    180645
  ]);
  assert.strictEqual(dailyControlResult.row[10], -179215);
  assert.strictEqual(dailyControlResult.row[11], 2350);
  assert.strictEqual(dailyControlResult.row[12], 5203.57);
  assert.strictEqual(dailyControlResult.row[13], "BELOW PLAN");

  const dailyControlExport = await dailyControlService.exportDailyControl("2026-05-14");
  assert.strictEqual(dailyControlExport.writeResult.tabName, "Daily Control");
  assert.strictEqual(dailyControlWrites[0].mappingKey, "daily_control");
  assert.strictEqual(dailyControlWrites[0].date, "2026-05-14");
  assert.strictEqual(dailyControlWrites[0].headers[0], "Дата");

  const managementWrites = [];
  const managementWorkbookService = createManagementWorkbookService({
    cogsService,
    financeFactsService,
    performanceService: {
      getStoredRowsForDateRange: async (dateFrom, dateTo) => {
        if (dateFrom === "2026-05-01") {
          return [
            { date: "2026-05-13", sku: "111", productName: "Товар 1", spend: 320, impressions: 1000, clicks: 40, addToCart: 5 },
            { date: "2026-05-14", sku: "222", productName: "Товар 2", spend: 410, impressions: 1500, clicks: 55, addToCart: 8 }
          ];
        }
        return [];
      }
    },
    salesFactsService,
    sheetsService: {
      updateMappedRowByDate: async (mappingKey, date, row, options = {}) => {
        managementWrites.push({ kind: "update", mappingKey, date, row, headers: options.headers, writeColumns: options.writeColumns });
        return { rowsWritten: 1, tabName: "Daily Input", matchedRow: 14, dateMatchedAs: "05-14", appended: false };
      }
    },
    planVpPerDay: 180645
  });

  const managementDaily = await managementWorkbookService.buildDailyInputRow("2026-05-14");
  assert.deepStrictEqual(managementDaily.row.slice(0, 11), [
    "2026-05-14",
    "",
    3000,
    2600,
    300,
    -400,
    150,
    70,
    1430,
    55,
    180645
  ]);
  assert.strictEqual(managementDaily.row[13], 5203.57);

  const managementExportDaily = await managementWorkbookService.exportDaily("2026-05-14");
  assert.strictEqual(managementExportDaily.dailyWrite.tabName, "Daily Input");
  assert.strictEqual(managementWrites[0].mappingKey, "daily_input");
  assert.strictEqual(managementWrites.length, 1);
  assert.strictEqual(managementExportDaily.dailyWrite.matchedRow, 14);
  assert.strictEqual(managementExportDaily.dailyWrite.dateMatchedAs, "05-14");
  assert.strictEqual(managementExportDaily.dailyWrite.appended, false);
  assert.deepStrictEqual(managementWrites[0].writeColumns, DAILY_INPUT_WRITE_COLUMNS);
  assert.strictEqual(managementWrites[0].row.length, 8);
  assert.deepStrictEqual(managementWrites[0].headers, [
    "Дата",
    "День",
    "Заказы ₽",
    "Продажи ₽",
    "Комиссия Ozon ₽",
    "Реклама ₽",
    "Себестоимость ₽",
    "Доставка до МП ₽",
    "ВП ₽",
    "Маржа ВП %",
    "План ВП/день",
    "Отклонение ₽",
    "Накоп. ВП ₽",
    "Run-rate прогноз ₽",
    "Статус",
    "Комментарий"
  ]);

  salesFactsService.clearSalesRows();
  financeFactsService.clearFinanceRows();
  cogsService.clear();
  cogsService.importText("SJ59\t571");
  salesFactsService.saveSalesRows(
    [
      {
        date: "2026-05-14",
        sku: "3715298591",
        offerId: "sj59",
        productName: "Успокаивающая сыворотка для лица",
        quantity: 1,
        revenue: 7322,
        price: 7322,
        postingNumber: "posting-sj59"
      }
    ],
    { source: "test" }
  );
  financeFactsService.saveFinanceRows(
    [
      {
        date: "2026-05-14",
        sales: 7000,
        returns: 0,
        ozonCommission: -500,
        logistics: -100,
        partnerServices: 0,
        fboServices: 0,
        advertising: -200,
        otherServices: 0,
        accruedTotal: 6200
      }
    ],
    { source: "test" }
  );

  const fallbackManagementService = createManagementWorkbookService({
    cogsService,
    financeFactsService,
    performanceService: {
      getStoredRowsForDateRange: async () => []
    },
    salesFactsService,
    sheetsService: {
      updateMappedRowByDate: async () => ({ rowsWritten: 1, tabName: "Daily Input" })
    },
    planVpPerDay: 0
  });
  const fallbackDaily = await fallbackManagementService.buildDailyInputRow("2026-05-14");
  assert.strictEqual(fallbackDaily.row[5], -200);
  assert.strictEqual(fallbackDaily.row[6], 571);
  assert.strictEqual(fallbackDaily.row[7], 100);

  const backfillWrites = [];
  const backfillSalesSaved = [];
  const backfillFinanceSaved = [];
  const backfillService = createManagementWorkbookService({
    cogsService,
    financeFactsService: {
      getFinanceRowsForDateRange: financeFactsService.getFinanceRowsForDateRange,
      saveFinanceRows: rows => backfillFinanceSaved.push(...rows)
    },
    performanceService: {
      getStoredRowsForDateRange: async () => []
    },
    salesFactsService: {
      getSalesRowsForDateRange: salesFactsService.getSalesRowsForDateRange,
      saveSalesRows: rows => backfillSalesSaved.push(...rows)
    },
    sheetsService: {
      updateMappedRowByDate: async (mappingKey, date, row, options = {}) => {
        backfillWrites.push({ mappingKey, date, row, writeColumns: options.writeColumns });
        return { rowsWritten: 1, tabName: "Daily Input", matchedRow: 7, appended: false };
      }
    },
    planVpPerDay: 0
  });

  const backfillResult = await backfillService.backfillDailyInput({
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14",
    fetchSalesForDay: async date => [
      {
        date,
        sku: "111",
        offerId: "SJ10",
        productName: "Товар 1",
        quantity: 1,
        revenue: 1000,
        price: 1000,
        postingNumber: "posting-" + date
      }
    ],
    fetchFinanceForDay: async date => [
      {
        date,
        sales: 900,
        returns: -50,
        ozonCommission: -100,
        logistics: -20,
        partnerServices: 0,
        fboServices: 0,
        advertising: -100,
        otherServices: 0,
        accruedTotal: 630
      }
    ]
  });
  assert.deepStrictEqual(backfillResult, {
    daysProcessed: 2,
    daysUpdated: 2,
    daysFailed: 0,
    failures: []
  });
  assert.strictEqual(backfillWrites.length, 2);
  assert.deepStrictEqual(backfillWrites[0].writeColumns, DAILY_INPUT_WRITE_COLUMNS);
  assert.strictEqual(backfillSalesSaved.length, 2);
  assert.strictEqual(backfillFinanceSaved.length, 2);

  const partialFailureBackfill = await backfillService.backfillDailyInput({
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14",
    fetchSalesForDay: async date => [
      {
        date,
        sku: "111",
        offerId: "SJ10",
        productName: "Товар 1",
        quantity: 1,
        revenue: 1000,
        price: 1000,
        postingNumber: "posting-" + date
      }
    ],
    fetchFinanceForDay: async date => {
      if (date === "2026-05-14") {
        throw new Error("finance failed");
      }
      return [
        {
          date,
          sales: 900,
          returns: 0,
          ozonCommission: -100,
          logistics: -20,
          partnerServices: 0,
          fboServices: 0,
          advertising: -100,
          otherServices: 0,
          accruedTotal: 680
        }
      ];
    }
  });
  assert.strictEqual(partialFailureBackfill.daysProcessed, 2);
  assert.strictEqual(partialFailureBackfill.daysUpdated, 1);
  assert.strictEqual(partialFailureBackfill.daysFailed, 1);
  assert.strictEqual(partialFailureBackfill.failures[0].date, "2026-05-14");

  await assert.rejects(
    () =>
      backfillService.backfillDailyInput({
        dateFrom: "2026-05-01",
        dateTo: "2026-06-05"
      }),
    error => error.message.includes(String(MAX_BACKFILL_DAYS))
  );

  const replenishmentWrites = [];
  const replenishmentService = createReplenishmentService({
    cogsService,
    ozonService: {
      getProducts: async () => [
        { name: "Товар 1", sku: "111", offerId: "SJ10" },
        { name: "Товар 2", sku: "222", offerId: "SJ11" }
      ],
      getStocks: async () => [
        {
          sku: "111",
          offerId: "SJ10",
          stocks: [
            { warehouse_id: "1", warehouse_name: "Хоругвино", present: 20, reserved: 0 }
          ]
        },
        {
          sku: "222",
          offerId: "SJ11",
          stocks: [
            { warehouse_id: "2", warehouse_name: "Хоругвино", present: 200, reserved: 0 },
            { warehouse_id: "3", warehouse_name: "Шушары", present: 50, reserved: 0 },
            { warehouse_id: "4", warehouse_name: "Зеленодольск", present: 50, reserved: 0 }
          ]
        }
      ],
      getCityForWarehouse: (id, name) => {
        const lower = String(name || "").toLowerCase();
        if (lower.includes("хоругвино") || lower.includes("пушкино") || lower.includes("москва")) return "Москва";
        if (lower.includes("шушары")) return "СПб";
        if (lower.includes("зеленодольск")) return "Казань";
        return "unknown";
      }
    },
    salesFactsService: {
      getSalesRowsForDateRange: () => [
        {
          date: "2026-05-13",
          sku: "111",
          offerId: "SJ10",
          productName: "Товар 1",
          quantity: 14,
          revenue: 14000
        },
        {
          date: "2026-05-14",
          sku: "111",
          offerId: "SJ10",
          productName: "Товар 1",
          quantity: 14,
          revenue: 14000
        },
        {
          date: "2026-05-13",
          sku: "222",
          offerId: "SJ11",
          productName: "Товар 2",
          quantity: 2,
          revenue: 2000
        },
        {
          date: "2026-05-14",
          sku: "222",
          offerId: "SJ11",
          productName: "Товар 2",
          quantity: 2,
          revenue: 2000
        }
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

  const replenishmentForecast = await replenishmentService.buildForecast({
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14"
  });
  // SKU 111 (SJ10) - Москва (row index 0)
  assert.strictEqual(replenishmentForecast.rows[0][0], "Москва");
  assert.strictEqual(replenishmentForecast.rows[0][1], "Хоругвино/Пушкино");
  assert.strictEqual(replenishmentForecast.rows[0][5], 8.4); // Sales per day (14 * 0.6)
  assert.strictEqual(replenishmentForecast.rows[0][6], 20); // Current stock (20)
  assert.strictEqual(replenishmentForecast.rows[0][8], 277.2); // Target stock (8.4 * 33)
  assert.strictEqual(replenishmentForecast.rows[0][9], 258); // Recommended shipment (Math.ceil(277.2 - 20) = 258)
  assert.strictEqual(replenishmentForecast.rows[0][10], "HIGH"); // Priority

  // SKU 222 (SJ11) - Москва (row index 3)
  assert.strictEqual(replenishmentForecast.rows[3][0], "Москва");
  assert.strictEqual(replenishmentForecast.rows[3][1], "Хоругвино/Пушкино");
  assert.strictEqual(replenishmentForecast.rows[3][5], 1.2); // Sales per day (2 * 0.6)
  assert.strictEqual(replenishmentForecast.rows[3][6], 200); // Current stock (200)
  assert.strictEqual(replenishmentForecast.rows[3][8], 39.6); // Target stock (1.2 * 33)
  assert.strictEqual(replenishmentForecast.rows[3][9], 0); // Recommended shipment
  assert.strictEqual(replenishmentForecast.rows[3][10], "LOW"); // Priority (daysOfStock = 166.7 >= 14)

  const replenishmentExport = await replenishmentService.exportForecast({
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14"
  });
  assert.strictEqual(replenishmentExport.writeResult.tabName, "Replenishment Plan");
  assert.strictEqual(replenishmentWrites[0].mappingKey, "replenishment_plan");
  assert.strictEqual(replenishmentWrites[0].headers[0], "City");

  const originalStocksFetch = global.fetch;
  global.fetch = async url => {
    if (url.endsWith("/v2/product/info/stocks")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            items: [{ sku: "111", offer_id: "SJ10", stocks: [{ present: 12 }] }]
          }
        })
      };
    }
    if (url.endsWith("/v3/product/info/list")) {
      return {
        ok: true,
        json: async () => ({ result: { items: [] } })
      };
    }
    throw new Error("Unexpected stocks fetch call: " + url);
  };
  try {
    const ozonStocksService = createOzonService({
      clientId: "test-client",
      apiKey: "test-key"
    });
    const stocks = await ozonStocksService.getStocks(100);
    assert.deepStrictEqual(stocks[0], {
      name: "",
      sku: "111",
      price: "",
      stock: 12,
      productId: "",
      offerId: "SJ10",
      stocks: [{ present: 12 }]
    });
  } finally {
    global.fetch = originalStocksFetch;
  }

  const originalStocksStringFetch = global.fetch;
  global.fetch = async url => {
    if (url.endsWith("/v2/product/info/stocks")) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          result: {
            items: [{ sku: "222", offer_id: "SJ11", stocks: [{ present: 7 }] }]
          }
        })
      };
    }
    if (url.endsWith("/v3/product/info/list")) {
      return {
        ok: true,
        json: async () => ({ result: { items: [] } })
      };
    }
    throw new Error("Unexpected stocks string fetch call: " + url);
  };
  try {
    const ozonStocksService = createOzonService({
      clientId: "test-client",
      apiKey: "test-key"
    });
    const stocks = await ozonStocksService.getStocks(100);
    assert.strictEqual(stocks[0].stock, 7);
    assert.strictEqual(stocks[0].offerId, "SJ11");
  } finally {
    global.fetch = originalStocksStringFetch;
  }

  const originalInvalidStocksFetch = global.fetch;
  global.fetch = async url => {
    if (url.endsWith("/v2/product/info/stocks")) {
      return {
        ok: true,
        text: async () => "<html>broken response</html>"
      };
    }
    throw new Error("Unexpected invalid stocks fetch call: " + url);
  };
  try {
    const ozonStocksService = createOzonService({
      clientId: "test-client",
      apiKey: "test-key"
    });
    await assert.rejects(
      () => ozonStocksService.getStocks(100),
      error => error.message.includes("invalid JSON")
    );
  } finally {
    global.fetch = originalInvalidStocksFetch;
  }

  const replenishmentWithoutStocks = createReplenishmentService({
    cogsService,
    ozonService: {
      getProducts: async () => [{ name: "Товар 1", sku: "111", offerId: "SJ10" }],
      getStocks: async () => {
        throw new Error("invalid JSON");
      }
    },
    salesFactsService: {
      getSalesRowsForDateRange: () => [
        {
          date: "2026-05-13",
          sku: "111",
          offerId: "SJ10",
          productName: "Товар 1",
          quantity: 10,
          revenue: 10000
        },
        {
          date: "2026-05-14",
          sku: "111",
          offerId: "SJ10",
          productName: "Товар 1",
          quantity: 10,
          revenue: 10000
        }
      ]
    },
    sheetsService: {
      clearAndWriteMappedRows: async () => ({ rowsWritten: 1, tabName: "Replenishment Plan" })
    },
    forecastDays: 21,
    safetyDays: 7,
    minShipment: 1
  });
  const replenishmentWithoutStocksForecast = await replenishmentWithoutStocks.buildForecast({
    dateFrom: "2026-05-13",
    dateTo: "2026-05-14"
  });
  assert.strictEqual(replenishmentWithoutStocksForecast.rows[0][6], 0);
  assert.strictEqual(replenishmentWithoutStocksForecast.rows[0][0], "Москва");
  assert.strictEqual(replenishmentWithoutStocksForecast.rows[0][1], "Хоругвино/Пушкино");
  assert.deepStrictEqual(replenishmentWithoutStocksForecast.warnings, [
    "Stocks unavailable, forecast uses zero stock."
  ]);
  assert.strictEqual(managementWorkbookService.templateOnlyMessage, "Этот лист считается формулами в шаблоне. Бот заполняет только Daily Input.");

  const templatePlanManagementService = createManagementWorkbookService({
    cogsService,
    financeFactsService,
    performanceService: {
      getStoredRowsForDateRange: async () => [{ date: "2026-05-14", spend: 410 }]
    },
    salesFactsService,
    sheetsService: {
      updateMappedRowByDate: async () => ({ rowsWritten: 1, tabName: "Daily Input" })
    },
    planVpPerDay: 0
  });
  const templatePlanDaily = await templatePlanManagementService.buildDailyInputRow("2026-05-14");
  assert.strictEqual(templatePlanDaily.row[9], 80.41);
  assert.strictEqual(templatePlanDaily.row[10], "");
  assert.strictEqual(templatePlanDaily.row[11], "");
  assert.strictEqual(templatePlanDaily.metrics.comment, "План считается формулой в шаблоне.");
  assert.deepStrictEqual(DAILY_INPUT_WRITE_COLUMNS, [
    "Дата",
    "День",
    "Заказы ₽",
    "Продажи ₽",
    "Комиссия Ozon ₽",
    "Реклама ₽",
    "Себестоимость ₽",
    "Доставка до МП ₽"
  ]);

  const originalFinanceFetch = global.fetch;
  let financeCallCount = 0;
  global.fetch = async url => {
    if (!url.endsWith("/v3/finance/transaction/list")) {
      throw new Error("Unexpected finance fetch call: " + url);
    }
    financeCallCount += 1;
    return {
      ok: true,
      json: async () => ({
        result: {
          operations:
            financeCallCount === 1
              ? [
                  {
                    operation_date: "2026-05-14T12:00:00Z",
                    operation_type: "orders",
                    operation_type_name: "Продажи",
                    accruals_for_sale: "396053",
                    sale_commission: "158211",
                    amount: "166855",
                    delivery_charge: "14147",
                    return_delivery_charge: "0",
                    services: [
                      { name: "Продвижение и реклама", amount: "-39695" },
                      { name: "Услуги партнёров", amount: "-3742" },
                      { name: "Услуги FBO", amount: "-1625" }
                    ]
                  },
                  {
                    operation_date: "2026-05-14T14:00:00Z",
                    operation_type: "returns",
                    operation_type_name: "Возвраты",
                    accruals_for_sale: "-10173",
                    sale_commission: "0",
                    amount: "-10173",
                    delivery_charge: "0",
                    return_delivery_charge: "0",
                    services: []
                  }
                ]
              : [],
          has_next_page: false
        }
      })
    };
  };

  try {
    const ozonFinanceService = createOzonService({
      clientId: "test-client",
      apiKey: "test-key"
    });
    const financeResult = await ozonFinanceService.getFinanceFacts({
      dateFrom: "2026-05-14T00:00:00+03:00",
      dateTo: "2026-05-14T23:59:59.999+03:00"
    });
    assert.deepStrictEqual(financeResult.rows, [
      {
        date: "2026-05-14",
        sales: 396053,
        returns: -10173,
        ozonCommission: -158211,
        logistics: -14147,
        partnerServices: -3742,
        fboServices: -1625,
        advertising: -39695,
        otherServices: -11778,
        accruedTotal: 156682
      }
    ]);
    assert.strictEqual(financeResult.summary.transactionCount, 2);
    assert.strictEqual(financeResult.summary.rows, 1);
    assert.strictEqual(financeResult.diagnostics.groupedOperations.length, 2);
  } finally {
    global.fetch = originalFinanceFetch;
  }

  const originalAdvertisingFinanceFetch = global.fetch;
  global.fetch = async url => {
    if (!url.endsWith("/v3/finance/transaction/list")) {
      throw new Error("Unexpected finance fetch call: " + url);
    }
    return {
      ok: true,
      json: async () => ({
        result: {
          operations: [
            {
              operation_date: "2026-05-14T10:00:00Z",
              operation_type: "brand_promotion",
              operation_type_name: "Продвижение бренда",
              accruals_for_sale: "0",
              sale_commission: "0",
              amount: "-3773",
              delivery_charge: "0",
              return_delivery_charge: "0",
              services: []
            },
            {
              operation_date: "2026-05-14T11:00:00Z",
              operation_type: "promotion_cpo",
              operation_type_name: "Продвижение с оплатой за заказ",
              accruals_for_sale: "0",
              sale_commission: "0",
              amount: "-11494",
              delivery_charge: "0",
              return_delivery_charge: "0",
              services: []
            },
            {
              operation_date: "2026-05-14T12:00:00Z",
              operation_type: "click_ads",
              operation_type_name: "Оплата за клик",
              accruals_for_sale: "0",
              sale_commission: "0",
              amount: "-23257",
              delivery_charge: "0",
              return_delivery_charge: "0",
              services: []
            },
            {
              operation_date: "2026-05-14T13:00:00Z",
              operation_type: "review_boost",
              operation_type_name: "Ускоренный сбор отзывов",
              accruals_for_sale: "0",
              sale_commission: "0",
              amount: "-1171",
              delivery_charge: "0",
              return_delivery_charge: "0",
              services: []
            }
          ],
          has_next_page: false
        }
      })
    };
  };

  try {
    const ozonFinanceService = createOzonService({
      clientId: "test-client",
      apiKey: "test-key"
    });
    const financeResult = await ozonFinanceService.getFinanceFacts({
      dateFrom: "2026-05-14T00:00:00+03:00",
      dateTo: "2026-05-14T23:59:59.999+03:00"
    });
    assert.strictEqual(financeResult.rows[0].advertising, -39695);
    assert.strictEqual(financeResult.rows[0].otherServices, 0);
    assert.deepStrictEqual(
      financeResult.diagnostics.advertisingGroups.map(item => item.totalAmount).sort((a, b) => a - b),
      [-23257, -11494, -3773, -1171]
    );
  } finally {
    global.fetch = originalAdvertisingFinanceFetch;
  }

  const ozonRequests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    ozonRequests.push({
      url,
      body: JSON.parse(options.body)
    });

    if (url.endsWith("/v3/posting/fbo/list")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            postings: [],
            has_next: false
          }
        })
      };
    }

    if (url.endsWith("/v3/posting/fbs/list")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            postings: [],
            has_next: false,
            last_id: ""
          }
        })
      };
    }

    throw new Error("Unexpected fetch call: " + url);
  };

  try {
    const ozonService = createOzonService({
      clientId: "test-client",
      apiKey: "test-key"
    });
    const fetchedSalesResult = await ozonService.getSalesFacts({
      dateFrom: "2026-05-13T00:00:00+03:00",
      dateTo: "2026-05-14T23:59:59.999+03:00",
      limit: 1000
    });
    assert.deepStrictEqual(fetchedSalesResult, {
      rows: [],
      summary: {
        rows: 0,
        uniqueSkus: 0,
        totalRevenue: 0,
        totalQuantity: 0
      },
      warning: "",
      stopReason: ""
    });
    assert.strictEqual(ozonRequests[0].body.limit, 100);
    assert.strictEqual(ozonRequests[1].body.limit, 100);
  } finally {
    global.fetch = originalFetch;
  }

  const originalFetchWithRevenue = global.fetch;
  global.fetch = async (url, options) => {
    if (url.endsWith("/v3/posting/fbo/list")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            postings: [
              {
                posting_number: "posting-revenue-1",
                status: "delivered",
                in_process_at: "2026-05-13T10:00:00Z",
                financial_data: {
                  products: [
                    {
                      sku: "111",
                      offer_id: "offer-111",
                      total_discounted_price: "1987,68"
                    }
                  ]
                },
                products: [
                  {
                    sku: "111",
                    offer_id: "offer-111",
                    name: "Товар 1",
                    quantity: 2,
                    final_price: "0",
                    price_with_discount: ""
                  }
                ]
              }
            ],
            has_next: false
          }
        })
      };
    }

    if (url.endsWith("/v3/posting/fbs/list")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            postings: [],
            has_next: false,
            last_id: ""
          }
        })
      };
    }

    throw new Error("Unexpected fetch call: " + url);
  };

  try {
    const ozonService = createOzonService({
      clientId: "test-client",
      apiKey: "test-key"
    });
    const revenueResult = await ozonService.getSalesFacts({
      dateFrom: "2026-05-13T00:00:00+03:00",
      dateTo: "2026-05-14T23:59:59.999+03:00"
    });
    assert.deepStrictEqual(revenueResult.rows[0], {
      date: "2026-05-13",
      sku: "111",
      offerId: "offer-111",
      productName: "Товар 1",
      quantity: 2,
      revenue: 1987.68,
      price: 993.84,
      postingNumber: "posting-revenue-1",
      orderId: "posting-revenue-1",
      status: "delivered",
      scheme: "FBO",
      region: ""
    });
    assert.deepStrictEqual(revenueResult.summary, {
      rows: 1,
      uniqueSkus: 1,
      totalRevenue: 1987.68,
      totalQuantity: 2
    });
  } finally {
    global.fetch = originalFetchWithRevenue;
  }

  const originalFetchWithPriceAmount = global.fetch;
  global.fetch = async (url, options) => {
    if (url.endsWith("/v3/posting/fbo/list")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            postings: [
              {
                posting_number: "28345787-2367-1",
                status: "delivered",
                in_process_at: "2026-05-13T10:00:00Z",
                products: [
                  {
                    offer_id: "SJ59",
                    sku: 3715298591,
                    name: "Успокаивающая сыворотка для лица",
                    quantity: 1,
                    price: { amount: "7322", currency: "RUB" }
                  }
                ]
              }
            ],
            has_next: false
          }
        })
      };
    }

    if (url.endsWith("/v3/posting/fbs/list")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            postings: [],
            has_next: false,
            last_id: ""
          }
        })
      };
    }

    throw new Error("Unexpected fetch call: " + url);
  };

  try {
    const ozonService = createOzonService({
      clientId: "test-client",
      apiKey: "test-key"
    });
    const priceAmountResult = await ozonService.getSalesFacts({
      dateFrom: "2026-05-13T00:00:00+03:00",
      dateTo: "2026-05-14T23:59:59.999+03:00"
    });
    assert.deepStrictEqual(priceAmountResult.rows[0], {
      date: "2026-05-13",
      sku: "3715298591",
      offerId: "SJ59",
      productName: "Успокаивающая сыворотка для лица",
      quantity: 1,
      revenue: 7322,
      price: 7322,
      postingNumber: "28345787-2367-1",
      orderId: "28345787-2367-1",
      status: "delivered",
      scheme: "FBO",
      region: ""
    });
    assert.deepStrictEqual(priceAmountResult.summary, {
      rows: 1,
      uniqueSkus: 1,
      totalRevenue: 7322,
      totalQuantity: 1
    });
  } finally {
    global.fetch = originalFetchWithPriceAmount;
  }

  async function runSafetyCase(responder, options = {}) {
    const calls = [];
    const previousFetch = global.fetch;
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      return responder(url, body, calls.length);
    };

    try {
      const service = createOzonService({
        clientId: "test-client",
        apiKey: "test-key"
      });
      return await service.getSalesFacts({
        dateFrom: "2026-05-13T00:00:00+03:00",
        dateTo: "2026-05-14T23:59:59.999+03:00"
        ,
        ...options
      });
    } finally {
      global.fetch = previousFetch;
    }
  }

  const repeatedPageResult = await runSafetyCase(async (url, body) => {
    if (url.endsWith("/v3/posting/fbo/list")) {
      const pageRows = Array.from({ length: 100 }, (_, index) => ({
        posting_number: "dup-" + index,
        status: "delivered",
        products: [{ sku: "111", offer_id: "offer-111", name: "Товар 1", quantity: 1, price: 100 }]
      }));
      return {
        ok: true,
        json: async () => ({
          result: {
            postings: pageRows,
            has_next: true
          }
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        result: {
          postings: [],
          has_next: false,
          last_id: ""
        }
      })
    };
  });
  assert.strictEqual(repeatedPageResult.warning, "Sales fetch stopped by pagination safety guard.");
  assert.strictEqual(repeatedPageResult.stopReason, "repeated_page_signature");
  assert.strictEqual(repeatedPageResult.summary.rows, 100);

  const duplicatePageResult = await runSafetyCase(async (url, body) => {
    if (url.endsWith("/v3/posting/fbo/list")) {
      const firstPageRows = Array.from({ length: 100 }, (_, index) => ({
        posting_number: "dup-" + index,
        status: "delivered",
        products: [{ sku: "111", offer_id: "offer-111", name: "Товар 1", quantity: 1, price: 100 }]
      }));
      if (!body.cursor) {
        return {
          ok: true,
          json: async () => ({
            result: {
              postings: firstPageRows,
              has_next: true,
              cursor: "page-2"
            }
          })
        };
      }
      const secondPageRows = firstPageRows.slice().reverse();
      return {
        ok: true,
        json: async () => ({
          result: {
            postings: secondPageRows,
            has_next: true,
            cursor: "page-3"
          }
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        result: {
          postings: [],
          has_next: false,
          last_id: ""
        }
      })
    };
  });
  assert.strictEqual(duplicatePageResult.warning, "Sales fetch stopped by pagination safety guard.");
  assert.strictEqual(duplicatePageResult.stopReason, "duplicate_page");

  let maxPagesCall = 0;
  const maxPagesResult = await runSafetyCase(async url => {
    if (url.endsWith("/v3/posting/fbo/list")) {
      maxPagesCall += 1;
      return {
        ok: true,
        json: async () => ({
          result: {
            postings: Array.from({ length: 100 }, (_, index) => ({
              posting_number: "page-" + maxPagesCall + "-" + index,
              status: "delivered",
              products: [{ sku: "111", offer_id: "offer-111", name: "Товар 1", quantity: 1, price: 100 }]
            })),
            has_next: true
          }
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        result: {
          postings: [],
          has_next: false,
          last_id: ""
        }
      })
    };
  }, { maxPages: 3, maxRows: 10000 });
  assert.strictEqual(maxPagesResult.warning, "Sales fetch stopped by pagination safety guard.");
  assert.strictEqual(maxPagesResult.stopReason, "max_pages");

  const maxRowsResult = await runSafetyCase(async (url, body, callNumber) => {
    if (url.endsWith("/v3/posting/fbo/list")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            postings: Array.from({ length: 100 }, (_, index) => ({
              posting_number: "rows-" + callNumber + "-" + index,
              status: "delivered",
              products: [{ sku: "111", offer_id: "offer-111", name: "Товар 1", quantity: 1, price: 100 }]
            })),
            has_next: true
          }
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        result: {
          postings: [],
          has_next: false,
          last_id: ""
        }
      })
    };
  }, { maxPages: 100, maxRows: 250 });
  assert.strictEqual(maxRowsResult.warning, "Sales fetch stopped by pagination safety guard.");
  assert.strictEqual(maxRowsResult.stopReason, "max_rows");

  const capturedWrites = [];
  salesFactsService.clearSalesRows();
  financeFactsService.clearFinanceRows();
  cogsService.clear();
  cogsService.setSku("111", 123.45, { logisticsToMp: 10, productName: "Товар 1" });
  cogsService.setSku("222", 50, { logisticsToMp: 5, productName: "Товар 2" });
  salesFactsService.saveSalesRows(
    [
      {
        date: "13.05.2026",
        sku: "111",
        offerId: "offer-111",
        productName: "Товар 1",
        quantity: "3",
        revenue: "4567,89",
        price: "1522,63",
        postingNumber: "posting-1",
        status: "delivered"
      },
      {
        date: "2026-05-14",
        sku: "222",
        offerId: "offer-222",
        productName: "Товар 2",
        quantity: 2,
        revenue: 2000,
        price: 1000,
        postingNumber: "posting-2",
        status: "delivered"
      }
    ],
    { source: "test" }
  );
  financeFactsService.saveFinanceRows(
    [
      {
        date: "2026-05-13",
        sales: 4300,
        returns: -100,
        ozonCommission: -500,
        logistics: -40,
        partnerServices: -20,
        fboServices: -10,
        advertising: -1987.68,
        otherServices: 0,
        accruedTotal: 1642.32
      },
      {
        date: "2026-05-14",
        sales: 1900,
        returns: -50,
        ozonCommission: -30,
        logistics: -20,
        partnerServices: 0,
        fboServices: 0,
        advertising: -100,
        otherServices: 0,
        accruedTotal: 1700
      }
    ],
    { source: "test" }
  );
  const reportBuilderService = createReportBuilderService({
    cogsService,
    financeFactsService,
    ozonService: {
      getProducts: async () => [
        { name: "Товар 1", sku: "111", offerId: "offer-111", price: 999 },
        { name: "Товар 2", sku: "222", offerId: "offer-222", price: 555 }
      ]
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
        },
        {
          date: "2026-05-14",
          sku: "222",
          productName: "Товар 2",
          offerId: "offer-222",
          revenue: "0",
          spend: "100,00",
          orders: "0"
        }
      ]
    },
    salesFactsService,
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
    4567.89,
    3,
    1522.63,
    1987.68,
    43.51,
    2179.86,
    0,
    0,
    0,
    0,
    0,
    ""
  ]);
  assert.deepStrictEqual(capturedWrites[1].rows[1], [
    "Товар 2",
    "",
    "",
    555,
    50,
    "offer-222",
    2000,
    2,
    1000,
    100,
    5,
    2000,
    2,
    1000,
    100,
    5,
    1790,
    0,
    0,
    0,
    0,
    0,
    ""
  ]);

  const pnlRows = capturedWrites[0].rows;
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Заказано"), ["Заказано", 4567.89, 2000]);
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Продажи"), ["Продажи", 4300, 1900]);
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Возвраты"), ["Возвраты", -100, -50]);
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Реклама"), ["Реклама", -1987.68, -100]);
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Комиссия Ozon"), ["Комиссия Ozon", -500, -30]);
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Логистика"), ["Логистика", -40, -20]);
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Себес"), ["Себес", 370.35, 100]);
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Прибыль"), ["Прибыль", 1271.97, 1600]);
  assert.deepStrictEqual(pnlRows.find(row => row[0] === "Начислено / Выплата"), ["Начислено / Выплата", 1642.32, 1700]);

  console.log("Report builder checks passed");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
