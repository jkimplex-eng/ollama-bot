const assert = require("assert");
const { getSheetMapping } = require("../config/sheetsMap");
const {
  inferPaymentType,
  looksLikeCsvReportBody,
  normalizeCampaign,
  parseCsvReadyResponse
} = require("../services/performance");
const { normalizeRows } = require("../services/sheets");
const { parsePerformanceCommand } = require("../services/telegram");

function run() {
  assert.strictEqual(getSheetMapping("performance_stats").logicalName, "performance_stats");

  assert.throws(() => getSheetMapping("missing_mapping"), /Unknown sheet mapping: missing_mapping/);

  assert.deepStrictEqual(normalizeRows([[1, 2]], 3), [[1, 2, ""]]);
  assert.throws(
    () => normalizeRows([[1, 2, 3, 4]], 3),
    /Row length validation failed/
  );

  assert.deepStrictEqual(parsePerformanceCommand("/performance campaigns"), {
    type: "campaigns",
    filter: "",
    toSheet: false
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance campaigns active"), {
    type: "campaigns",
    filter: "running",
    toSheet: false
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance campaigns debug active"), {
    type: "campaigns_debug",
    filter: "running"
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance campaigns running"), {
    type: "campaigns",
    filter: "running",
    toSheet: false
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance campaigns sku"), {
    type: "campaigns",
    filter: "sku",
    toSheet: false
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance campaigns search_promo"), {
    type: "campaigns",
    filter: "search_promo",
    toSheet: false
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance campaigns banner"), {
    type: "campaigns",
    filter: "banner",
    toSheet: false
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance campaigns в таблицу"), {
    type: "campaigns",
    filter: "",
    toSheet: true
  });

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance campaigns active в таблицу"),
    {
      type: "campaigns",
      filter: "running",
      toSheet: true
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance campaigns sku в таблицу"),
    {
      type: "campaigns",
      filter: "sku",
      toSheet: true
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance campaigns search_promo в таблицу"),
    {
      type: "campaigns",
      filter: "search_promo",
      toSheet: true
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance campaigns banner в таблицу"),
    {
      type: "campaigns",
      filter: "banner",
      toSheet: true
    }
  );

  assert.deepStrictEqual(parsePerformanceCommand("/performance objects 123"), {
    type: "objects",
    campaignId: "123"
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance limits"), {
    type: "limits"
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance minbid 123456789"), {
    type: "minbid",
    sku: "123456789"
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance queue"), {
    type: "queue"
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance discover"), {
    type: "discover",
    raw: false
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance discover raw"), {
    type: "discover",
    raw: true
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance continue"), {
    type: "continue"
  });

  assert.deepStrictEqual(parsePerformanceCommand("/performance reset"), {
    type: "reset"
  });

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance stats campaign 123 2026-05-01 2026-05-14"),
    {
      type: "stats_campaign",
      campaignId: "123",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-14"
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance stats test 2026-05-01 2026-05-14"),
    {
      type: "stats_test",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-14"
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance stats 2026-05-01 2026-05-14"),
    {
      type: "stats",
      activeOnly: false,
      toSheet: false,
      dateFrom: "2026-05-01",
      dateTo: "2026-05-14"
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance stats активные 2026-05-01 2026-05-14"),
    {
      type: "stats",
      activeOnly: true,
      toSheet: false,
      dateFrom: "2026-05-01",
      dateTo: "2026-05-14"
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance report 123e4567-e89b-12d3-a456-426614174000"),
    {
      type: "report",
      uuid: "123e4567-e89b-12d3-a456-426614174000",
      toSheet: false
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance report status 123e4567-e89b-12d3-a456-426614174000"),
    {
      type: "report_status",
      uuid: "123e4567-e89b-12d3-a456-426614174000"
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance report в таблицу 123e4567-e89b-12d3-a456-426614174000"),
    {
      type: "report",
      uuid: "123e4567-e89b-12d3-a456-426614174000",
      toSheet: true
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance watch 123e4567-e89b-12d3-a456-426614174000"),
    {
      type: "watch",
      uuid: "123e4567-e89b-12d3-a456-426614174000"
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance export perf-12345-abcd"),
    {
      type: "export",
      requestGroupId: "perf-12345-abcd"
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance stats в таблицу 2026-05-01 2026-05-14"),
    {
      type: "stats",
      activeOnly: false,
      toSheet: true,
      dateFrom: "2026-05-01",
      dateTo: "2026-05-14"
    }
  );

  assert.strictEqual(parsePerformanceCommand("/performance campaigns active в таблицу extra"), null);
  assert.strictEqual(parsePerformanceCommand("/performance limits extra"), null);
  assert.strictEqual(parsePerformanceCommand("/performance minbid"), null);
  assert.strictEqual(parsePerformanceCommand("/performance discover raw extra"), null);
  assert.strictEqual(parsePerformanceCommand("/performance stats active 2026-05-01 2026-05-14"), null);

  assert.strictEqual(
    inferPaymentType({
      advObjectType: "SKU",
      paymentType: "",
      placementValues: ["PLACEMENT_TOP_PROMOTION"]
    }),
    "CPC_TOP / Поиск"
  );

  assert.strictEqual(
    inferPaymentType({
      advObjectType: "SEARCH_PROMO",
      paymentType: "",
      placementValues: []
    }),
    "CPO / Оплата за заказ"
  );

  assert.strictEqual(
    inferPaymentType({
      advObjectType: "ALL_SKU_PROMO",
      paymentType: "",
      placementValues: []
    }),
    "CPO / Оплата за заказ"
  );

  assert.deepStrictEqual(
    normalizeCampaign({
      id: 123,
      title: "Test campaign",
      state: "CAMPAIGN_STATE_RUNNING",
      advObjectType: "SKU",
      paymentType: "",
      budget: 0,
      dailyBudget: 0,
      weeklyBudget: 125000000,
      placement: ["PLACEMENT_TOP_PROMOTION", "PLACEMENT_SEARCH_AND_CATEGORY"],
      fromDate: "2026-05-01"
    }),
    {
      campaignId: "123",
      campaignName: "Test campaign",
      status: "CAMPAIGN_STATE_RUNNING",
      advObjectType: "SKU",
      paymentType: "CPC_TOP / Поиск",
      rawPaymentType: "",
      fromDate: "2026-05-01",
      toDate: "",
      budget: 0,
      dailyBudget: 0,
      weeklyBudget: 125,
      placement: "PLACEMENT_TOP_PROMOTION, PLACEMENT_SEARCH_AND_CATEGORY",
      productCampaignMode: "",
      createdAt: "",
      updatedAt: ""
    }
  );

  const csvFixture = [
    ";Кампания по продвижению товаров № 123; Test campaign, период 2026-05-01 - 2026-05-14",
    "Дата;sku;Название товара;Цена товара, Р;Показы;Клики;CTR (%);В корзину;Ср. цена клика, г;Ср. цена 1000 показов, Р;Расход, Р, с НДС;Заказы;Выручка, Р;Заказы модели;Выручка с заказов модели, Р;ДРР, %",
    "2026-05-01;111;Товар;9133,00;100;10;10,00;2;5,50;100,00;55,00;1;9133,00;1;9133,00;0,60"
  ].join("\n");

  assert.strictEqual(looksLikeCsvReportBody(csvFixture), true);

  assert.deepStrictEqual(
    parseCsvReadyResponse({
      ok: true,
      status: 200,
      contentType: "text/csv; charset=utf-8",
      bodyText: csvFixture
    }),
    {
      rows: [
        {
          date: "2026-05-01",
          campaignId: "123",
          campaignName: "",
          sku: "111",
          productName: "Товар",
          price: 9133,
          impressions: 100,
          clicks: 10,
          ctr: 10,
          addToCart: 2,
          avgCpc: 5.5,
          avgCpm: 100,
          spend: 55,
          orders: 1,
          revenue: 9133,
          modelOrders: 1,
          modelRevenue: 9133,
          drr: 0.6
        }
      ],
      rowsCount: 1
    }
  );

  console.log("Sheets/performance checks passed");
}

run();
