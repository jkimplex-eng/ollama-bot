function formatDate(value) {
  const normalized = String(value || "").trim();
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3];
  }

  const ruMatch = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ruMatch) {
    return ruMatch[3] + "-" + ruMatch[2] + "-" + ruMatch[1];
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return normalized.slice(0, 10);
}

function listDates(dateFrom, dateTo) {
  const dates = [];
  const current = new Date(dateFrom + "T00:00:00Z");
  const end = new Date(dateTo + "T00:00:00Z");

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

const SKU_DASHBOARD_HEADERS = [
  "Название",
  "Категория",
  "ШК",
  "РРЦ",
  "Себ",
  "Артикул",
  "Рубли",
  "Штуки",
  "Цена",
  "Реклама",
  "ДРР",
  "Выручка",
  "Штуки",
  "Цена",
  "Реклама",
  "ДРР",
  "ВП",
  "Показы общие",
  "Показы реклама",
  "Клики",
  "CTR",
  "Корзины",
  "Позиция ср."
];

function buildPnlFormatting(headers) {
  return {
    boldHeader: true,
    freezeRows: 1,
    autoResizeColumns: true,
    headerBackground: "#000000",
    headerFontColor: "#ffffff",
    currencyColumns: headers.slice(1),
    percentColumns: [],
    conditionalColumns: [],
    currencyRows: ["Продажи", "Реклама", "Прибыль", "Себес", "Доставка до МП", "ВП"],
    percentRows: ["от заказов", "от продаж"],
    conditionalRows: [
      {
        rowLabel: "ВП",
        positiveBackground: "#d9ead3",
        negativeBackground: "#f4cccc",
        neutralBackground: ""
      }
    ]
  };
}

function buildSkuDashboardFormatting() {
  return {
    boldHeader: true,
    freezeRows: 1,
    autoResizeColumns: true,
    headerBackground: "#000000",
    headerFontColor: "#ffffff",
    currencyColumns: ["РРЦ", "Себ", "Рубли", "Цена", "Реклама", "Выручка", "ВП"],
    percentColumns: ["ДРР", "CTR"],
    conditionalColumns: [
      {
        header: "ВП",
        positiveBackground: "#d9ead3",
        negativeBackground: "#f4cccc",
        neutralBackground: ""
      }
    ]
  };
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const number = Number(
    String(value)
      .replace(/\s/g, "")
      .replace(",", ".")
  );
  return Number.isFinite(number) ? number : 0;
}

function round2(value) {
  return Number(toNumber(value).toFixed(2));
}

function buildDateMap(dates, factory) {
  return new Map(dates.map(date => [date, factory()]));
}

function sumByDate(rows, dates, pickValue) {
  const map = buildDateMap(dates, () => 0);

  for (const row of rows) {
    const date = formatDate(row.date);
    if (!map.has(date)) continue;
    map.set(date, map.get(date) + toNumber(pickValue(row)));
  }

  return map;
}

function createMetricRow(label, dates, valuesByDate) {
  return [label, ...dates.map(date => round2(valuesByDate.get(date) || 0))];
}

function getAdvertisingSpend(row) {
  return toNumber(row.spend || row.adSpend || row.cost || 0);
}

function buildPnlSummaryRows(rows, { dateFrom, dateTo, salesRows = [] }) {
  const dates = listDates(dateFrom, dateTo);
  const sourceRows = salesRows.length ? salesRows : rows;
  const ordersByDate = sumByDate(sourceRows, dates, row => row.quantity ?? row.orders);
  const salesByDate = sumByDate(sourceRows, dates, row => row.revenue);
  const adsByDate = sumByDate(rows, dates, getAdvertisingSpend);
  const ordersModelByDate = sumByDate(rows, dates, row => row.modelOrders);
  const salesModelByDate = sumByDate(rows, dates, row => row.modelRevenue);
  const profitByDate = buildDateMap(dates, () => 0);
  const cogsByDate = sumByDate(sourceRows, dates, row => toNumber(row.cogs) * toNumber(row.quantity ?? row.orders));
  const deliveryByDate = sumByDate(sourceRows, dates, row => toNumber(row.logisticsToMp) * toNumber(row.quantity ?? row.orders));
  const grossProfitByDate = buildDateMap(dates, () => 0);

  for (const date of dates) {
    profitByDate.set(
      date,
      round2(
        (salesByDate.get(date) || 0) -
          (adsByDate.get(date) || 0) -
          (cogsByDate.get(date) || 0) -
          (deliveryByDate.get(date) || 0)
      )
    );
    grossProfitByDate.set(date, round2(profitByDate.get(date) || 0));
  }

  return {
    headers: ["Metric", ...dates],
    rows: [
      createMetricRow("Заказы", dates, ordersByDate),
      createMetricRow("Продажи", dates, salesByDate),
      createMetricRow("Реклама", dates, adsByDate),
      createMetricRow("от заказов", dates, ordersModelByDate),
      createMetricRow("от продаж", dates, salesModelByDate),
      createMetricRow("Прибыль", dates, profitByDate),
      createMetricRow("Себес", dates, cogsByDate),
      createMetricRow("Доставка до МП", dates, deliveryByDate),
      createMetricRow("ВП", dates, grossProfitByDate)
    ]
  };
}

function buildProductsIndex(products) {
  const bySku = new Map();
  const byOfferId = new Map();

  for (const product of products) {
    const normalized = {
      name: product.name ?? "",
      sku: String(product.sku ?? ""),
      price: product.price ?? "",
      cogs: product.cogs ?? "",
      offerId: String(product.offerId ?? ""),
      stock: product.stock ?? "",
      productId: String(product.productId ?? "")
    };

    if (normalized.sku) {
      bySku.set(normalized.sku, normalized);
    }

    if (normalized.offerId) {
      byOfferId.set(normalized.offerId, normalized);
    }
  }

  return { bySku, byOfferId };
}

function buildSkuDashboardRows(rows, products, salesRows = []) {
  const productIndex = buildProductsIndex(products);
  const bySku = new Map();
  const hasSalesFacts = salesRows.length > 0;

  for (const row of rows) {
    const sku = String(row.sku || "");
    if (!sku) continue;

    const current = bySku.get(sku) || {
      sku,
      name: row.productName || "",
      offerId: "",
      priceSource: row.price ?? "",
      spend: 0,
      orders: 0,
      avgOrderPriceTotal: 0,
      revenue: 0,
      modelOrders: 0,
      modelRevenue: 0,
      impressions: 0,
      clicks: 0,
      addToCart: 0,
      cogsPerUnit: 0,
      logisticsToMpPerUnit: 0
    };

    current.name = current.name || row.productName || "";
    current.priceSource = current.priceSource || row.price || "";
    current.spend += toNumber(row.spend);
    if (!hasSalesFacts) {
      current.orders += toNumber(row.orders);
      current.revenue += toNumber(row.revenue);
      current.avgOrderPriceTotal += toNumber(row.price) * toNumber(row.orders);
    }
    current.modelOrders += toNumber(row.modelOrders);
    current.modelRevenue += toNumber(row.modelRevenue);
    current.impressions += toNumber(row.impressions);
    current.clicks += toNumber(row.clicks);
    current.addToCart += toNumber(row.addToCart);

    bySku.set(sku, current);
  }

  for (const row of salesRows) {
    const sku = String(row.sku || row.offerId || "");
    if (!sku) continue;

    const current = bySku.get(sku) || {
      sku,
      name: row.productName || "",
      offerId: row.offerId || "",
      priceSource: row.price ?? "",
      spend: 0,
      orders: 0,
      avgOrderPriceTotal: 0,
      revenue: 0,
      modelOrders: 0,
      modelRevenue: 0,
      impressions: 0,
      clicks: 0,
      addToCart: 0,
      cogsPerUnit: 0,
      logisticsToMpPerUnit: 0
    };

    current.name = current.name || row.productName || "";
    current.offerId = current.offerId || row.offerId || "";
    current.priceSource = current.priceSource || row.price || "";
    current.orders += toNumber(row.quantity);
    current.revenue += toNumber(row.revenue);
    current.avgOrderPriceTotal += toNumber(row.price) * toNumber(row.quantity);
    current.cogsPerUnit = current.cogsPerUnit || toNumber(row.cogs);
    current.logisticsToMpPerUnit = current.logisticsToMpPerUnit || toNumber(row.logisticsToMp);

    bySku.set(sku, current);
  }

  return Array.from(bySku.values())
    .sort((left, right) => right.revenue - left.revenue)
    .map(item => {
      const product =
        productIndex.bySku.get(item.sku) ||
        productIndex.byOfferId.get(item.sku) ||
        {};
      const orders = item.orders;
      const modelOrders = item.modelOrders;
      const revenue = round2(item.revenue);
      const spend = round2(item.spend);
      const avgPrice = orders ? round2(revenue / orders) : "";
      const avgModelPrice = modelOrders ? round2(item.modelRevenue / modelOrders) : "";
      const drr = revenue ? round2((spend / revenue) * 100) : 0;
      const ctr = item.impressions ? round2((item.clicks / item.impressions) * 100) : 0;
      const grossProfit = round2(
        revenue -
          spend -
          toNumber(item.cogsPerUnit) * orders -
          toNumber(item.logisticsToMpPerUnit) * orders
      );

      return [
        product.name || item.name || "",
        "",
        "",
        product.price || item.priceSource || "",
        product.cogs || item.cogsPerUnit || "",
        product.offerId || item.offerId || "",
        revenue,
        orders,
        avgPrice,
        spend,
        drr,
        round2(item.modelRevenue),
        modelOrders,
        avgModelPrice,
        spend,
        drr,
        grossProfit,
        item.impressions,
        item.impressions,
        item.clicks,
        ctr,
        item.addToCart,
        ""
      ];
    });
}

function createReportBuilderService({ cogsService, ozonService, performanceService, salesFactsService, sheetsService }) {
  async function loadPerformanceRows(dateFrom, dateTo) {
    const rows = await performanceService.getStoredRowsForDateRange(dateFrom, dateTo);

    if (!rows.length) {
      throw new Error(
        "Нет локальных Performance-данных за этот период. Сначала получи отчёт через /performance report <uuid> или /performance stats ..."
      );
    }

    return rows;
  }

  async function loadProducts(limit = 1000) {
    try {
      return await ozonService.getProducts(limit);
    } catch {
      return [];
    }
  }

  async function buildPnlReport({ dateFrom, dateTo }) {
    const rows = await loadPerformanceRows(dateFrom, dateTo);
    const merged = cogsService ? cogsService.mergeCogsIntoPerformanceRows(rows) : { rows, missingSkus: [] };
    const salesRowsRaw = salesFactsService ? salesFactsService.getSalesRowsForDateRange(dateFrom, dateTo) : [];
    const salesRows = cogsService ? cogsService.mergeCogsIntoPerformanceRows(salesRowsRaw).rows : salesRowsRaw;
    console.log(
      "[reportBuilder] pnl source rows",
      (salesRows.length ? salesRows : merged.rows).slice(0, 3).map(row => ({
        date: row.date,
        spend: row.spend,
        adSpend: row.adSpend,
        cost: row.cost,
        cogs: row.cogs,
        logisticsToMp: row.logisticsToMp,
        revenue: row.revenue,
        orders: row.orders,
        quantity: row.quantity
      }))
    );
    const report = buildPnlSummaryRows(merged.rows, { dateFrom, dateTo, salesRows });
    const warnings = [];
    if (merged.missingSkus.length) {
      warnings.push("Себестоимость не задана для " + merged.missingSkus.length + " SKU");
    }
    if (!salesRows.length) {
      warnings.push("Нет sales facts за период. Используется только Performance.");
    }

    return {
      dateFrom,
      dateTo,
      headers: ["Metric", ...listDates(dateFrom, dateTo)],
      rows: report.rows,
      warnings,
      missingFieldsNote:
        "Часть полей пока не заполнена: себестоимость, доставка, позиция, категория."
    };
  }

  async function buildSkuReport({ dateFrom, dateTo }) {
    const [rows, products] = await Promise.all([
      loadPerformanceRows(dateFrom, dateTo),
      loadProducts()
    ]);
    const merged = cogsService ? cogsService.mergeCogsIntoPerformanceRows(rows) : { rows, missingSkus: [] };
    const salesRowsRaw = salesFactsService ? salesFactsService.getSalesRowsForDateRange(dateFrom, dateTo) : [];
    const salesRows = cogsService ? cogsService.mergeCogsIntoPerformanceRows(salesRowsRaw).rows : salesRowsRaw;
    const enrichedProducts = products.map(product => {
      const cogsEntry =
        (cogsService && (cogsService.getCogsBySku(product.sku) || cogsService.getCogsByOfferId(product.offerId))) ||
        null;
      return {
        ...product,
        cogs: cogsEntry ? toNumber(cogsEntry.cogs) : 0
      };
    });
    const warnings = [];
    if (merged.missingSkus.length) {
      warnings.push("Себестоимость не задана для " + merged.missingSkus.length + " SKU");
    }
    if (!salesRows.length) {
      warnings.push("Нет sales facts за период. Используется только Performance.");
    }

    return {
      dateFrom,
      dateTo,
      rows: buildSkuDashboardRows(merged.rows, enrichedProducts, salesRows),
      warnings,
      missingFieldsNote:
        "Часть полей пока не заполнена: себестоимость, доставка, позиция, категория."
    };
  }

  async function exportPnlReport({ dateFrom, dateTo }) {
    const report = await buildPnlReport({ dateFrom, dateTo });
    const result = await sheetsService.clearAndWriteMappedRows("pnl_summary", report.rows, {
      headers: report.headers,
      formatting: buildPnlFormatting(report.headers)
    });
    return { report, writeResult: result };
  }

  async function exportSkuReport({ dateFrom, dateTo }) {
    const report = await buildSkuReport({ dateFrom, dateTo });
    const result = await sheetsService.clearAndWriteMappedRows("sku_dashboard", report.rows, {
      headers: SKU_DASHBOARD_HEADERS,
      formatting: buildSkuDashboardFormatting()
    });
    return { report, writeResult: result };
  }

  return {
    buildPnlReport,
    buildSkuReport,
    exportPnlReport,
    exportSkuReport,
    buildPnlSummaryRows,
    buildSkuDashboardRows
  };
}

module.exports = {
  buildPnlSummaryRows,
  buildSkuDashboardRows,
  buildPnlFormatting,
  buildSkuDashboardFormatting,
  createReportBuilderService,
  listDates,
  SKU_DASHBOARD_HEADERS
};
