const assert = require("assert");
const {
  buildPnlSummaryRows,
  buildSkuDashboardRows
} = require("../services/reportBuilder");
const { parseReportCommand } = require("../services/telegram");

function run() {
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
      headers: ["Показатель", "2026-05-01", "2026-05-02"],
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
          adSpend: 200
        },
        {
          date: "2026-05-14",
          orders: 2,
          revenue: 2000,
          cost: 300
        }
      ],
      {
        dateFrom: "2026-05-13",
        dateTo: "2026-05-14"
      }
    ).rows.find(row => row[0] === "Реклама"),
    ["Реклама", 200, 300]
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

  console.log("Report builder checks passed");
}

run();
