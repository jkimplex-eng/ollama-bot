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
const { parseCogsCommand, parseFinanceCommand, parseReportCommand, parseSalesCommand } = require("../services/telegram");
const { createCogsService } = require("../services/cogs");
const { createFinanceFactsService } = require("../services/financeFacts");
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
        ["Реклама", -80],
        ["Комиссия Ozon", -100],
        ["Логистика", -20],
        ["Услуги партнёров", -10],
        ["Услуги FBO", -5],
        ["Себес", 100],
        ["Прибыль", 535],
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

  assert.deepStrictEqual(parseCogsCommand("/cogs template"), { type: "template" });
  assert.deepStrictEqual(parseCogsCommand("/cogs status"), { type: "status" });
  assert.deepStrictEqual(parseCogsCommand("/cogs clear"), { type: "clear" });
  assert.deepStrictEqual(parseCogsCommand("/cogs set SKU123 199.50"), {
    type: "set",
    sku: "SKU123",
    cogs: "199.50"
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

  cogsService.setSku("111", 123.45, { logisticsToMp: 10, productName: "Товар 1" });
  cogsService.setSku("222", 50, { logisticsToMp: 5, productName: "Товар 2" });
  assert.deepStrictEqual(cogsService.getCogsBySku("111"), {
    sku: "111",
    offerId: "",
    productName: "Товар 1",
    cogs: 123.45,
    logisticsToMp: 10,
    notes: ""
  });
  assert.deepStrictEqual(cogsService.getStatus(), {
    totalConfiguredSkus: 2,
    totalItems: 2
  });
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
      scheme: "FBO"
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
      scheme: "FBO"
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
      if (body.offset === 0) {
        return {
          ok: true,
          json: async () => ({
            result: {
              postings: firstPageRows,
              has_next: true
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
