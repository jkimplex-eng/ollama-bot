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
    currencyRows: [
      "Заказано",
      "Продажи",
      "Возвраты",
      "Реклама",
      "Комиссия Ozon",
      "Логистика",
      "Услуги партнёров",
      "Услуги FBO",
      "Себес",
      "Прибыль",
      "Начислено / Выплата"
    ],
    percentRows: [],
    conditionalRows: [
      {
        rowLabel: "Прибыль",
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
  if (row.spend !== undefined && row.spend !== null && row.spend !== "") {
    return toNumber(row.spend);
  }
  if (row.adSpend !== undefined && row.adSpend !== null && row.adSpend !== "") {
    return toNumber(row.adSpend);
  }
  if (row.cost !== undefined && row.cost !== null && row.cost !== "") {
    return toNumber(row.cost);
  }
  return 0;
}

function getExpenseEffect(value) {
  const amount = toNumber(value);
  return amount > 0 ? -amount : amount;
}

function buildPnlSummaryRows(rows, { dateFrom, dateTo, salesRows = [], financeRows = [] }) {
  const dates = listDates(dateFrom, dateTo);
  const orderedRevenueByDate = sumByDate(salesRows, dates, row => row.revenue);
  const orderedQuantityByDate = sumByDate(salesRows, dates, row => row.quantity);
  const financeSalesByDate = sumByDate(financeRows, dates, row => row.sales);
  const returnsByDate = sumByDate(financeRows, dates, row => row.returns);
  const commissionByDate = sumByDate(financeRows, dates, row => row.ozonCommission);
  const logisticsByDate = sumByDate(financeRows, dates, row => row.logistics);
  const partnerServicesByDate = sumByDate(financeRows, dates, row => row.partnerServices);
  const fboServicesByDate = sumByDate(financeRows, dates, row => row.fboServices);
  const otherServicesByDate = sumByDate(financeRows, dates, row => row.otherServices);
  const performanceAds = sumByDate(rows, dates, getAdvertisingSpend);
  const adsByDate = buildDateMap(dates, () => 0);
  for (const date of dates) {
    const val = performanceAds.get(date) || 0;
    adsByDate.set(date, financeRows.length ? -Math.abs(val) : val);
  }
  const accruedByDate = sumByDate(financeRows, dates, row => row.accruedTotal);
  const profitByDate = buildDateMap(dates, () => 0);
  const cogsByDate = sumByDate(salesRows, dates, row => toNumber(row.cogs) * toNumber(row.quantity));

  for (const date of dates) {
    profitByDate.set(
      date,
      round2(
        (financeSalesByDate.get(date) || 0) +
          (returnsByDate.get(date) || 0) +
          getExpenseEffect(commissionByDate.get(date) || 0) +
          getExpenseEffect(logisticsByDate.get(date) || 0) +
          getExpenseEffect(partnerServicesByDate.get(date) || 0) +
          getExpenseEffect(fboServicesByDate.get(date) || 0) +
          getExpenseEffect(otherServicesByDate.get(date) || 0) +
          getExpenseEffect(adsByDate.get(date) || 0) -
          (cogsByDate.get(date) || 0) -
          0
      )
    );
  }

  return {
    headers: ["Metric", ...dates],
    rows: [
      createMetricRow("Заказано", dates, orderedRevenueByDate),
      createMetricRow("Продажи", dates, financeSalesByDate),
      createMetricRow("Возвраты", dates, returnsByDate),
      createMetricRow("Реклама", dates, adsByDate),
      createMetricRow("Комиссия Ozon", dates, commissionByDate),
      createMetricRow("Логистика", dates, logisticsByDate),
      createMetricRow("Услуги партнёров", dates, partnerServicesByDate),
      createMetricRow("Услуги FBO", dates, fboServicesByDate),
      createMetricRow("Себес", dates, cogsByDate),
      createMetricRow("Прибыль", dates, profitByDate),
      createMetricRow("Начислено / Выплата", dates, accruedByDate)
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
      const displayedRevenue = salesRows.length ? revenue : round2(item.modelRevenue);
      const displayedOrders = salesRows.length ? orders : modelOrders;
      const displayedAvgPrice = salesRows.length ? avgPrice : avgModelPrice;
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
        displayedRevenue,
        displayedOrders,
        displayedAvgPrice,
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

function createReportBuilderService({ cogsService, financeFactsService, ozonService, performanceService, salesFactsService, sheetsService }) {
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
    const financeRows = financeFactsService ? financeFactsService.getFinanceRowsForDateRange(dateFrom, dateTo) : [];
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
    const report = buildPnlSummaryRows(merged.rows, { dateFrom, dateTo, salesRows, financeRows });
    const warnings = [];
    if (merged.missingSkus.length) {
      warnings.push("Себестоимость не задана для " + merged.missingSkus.length + " SKU");
    }
    if (!salesRows.length) {
      warnings.push("Нет sales facts за период. Используется только Performance.");
    }
    if (!financeRows.length) {
      warnings.push("Нет finance facts за период. Заказано берётся из postings, P&L неполный.");
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
