function formatDate(value) {
  return String(value || "").slice(0, 10);
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

function buildPnlSummaryRows(rows, { dateFrom, dateTo }) {
  const dates = listDates(dateFrom, dateTo);
  const ordersByDate = sumByDate(rows, dates, row => row.orders);
  const salesByDate = sumByDate(rows, dates, row => row.revenue);
  const adsByDate = sumByDate(rows, dates, getAdvertisingSpend);
  const ordersModelByDate = sumByDate(rows, dates, row => row.modelOrders);
  const salesModelByDate = sumByDate(rows, dates, row => row.modelRevenue);
  const profitByDate = buildDateMap(dates, () => 0);
  const cogsByDate = buildDateMap(dates, () => 0);
  const deliveryByDate = buildDateMap(dates, () => 0);
  const grossProfitByDate = buildDateMap(dates, () => 0);

  for (const date of dates) {
    profitByDate.set(date, round2((salesByDate.get(date) || 0) - (adsByDate.get(date) || 0)));
    grossProfitByDate.set(date, round2(profitByDate.get(date) || 0));
  }

  return {
    headers: ["Показатель", ...dates],
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

function buildSkuDashboardRows(rows, products) {
  const productIndex = buildProductsIndex(products);
  const bySku = new Map();

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
      addToCart: 0
    };

    current.name = current.name || row.productName || "";
    current.priceSource = current.priceSource || row.price || "";
    current.spend += toNumber(row.spend);
    current.orders += toNumber(row.orders);
    current.revenue += toNumber(row.revenue);
    current.modelOrders += toNumber(row.modelOrders);
    current.modelRevenue += toNumber(row.modelRevenue);
    current.impressions += toNumber(row.impressions);
    current.clicks += toNumber(row.clicks);
    current.addToCart += toNumber(row.addToCart);
    current.avgOrderPriceTotal += toNumber(row.price) * toNumber(row.orders);

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

      return [
        product.name || item.name || "",
        "",
        "",
        product.price || item.priceSource || "",
        "",
        product.offerId || "",
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
        "",
        item.impressions,
        item.impressions,
        item.clicks,
        ctr,
        item.addToCart,
        ""
      ];
    });
}

function createReportBuilderService({ ozonService, performanceService, sheetsService }) {
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
    console.log(
      "[reportBuilder] pnl source rows",
      rows.slice(0, 3).map(row => ({
        date: row.date,
        spend: row.spend,
        adSpend: row.adSpend,
        cost: row.cost,
        revenue: row.revenue,
        orders: row.orders
      }))
    );
    const report = buildPnlSummaryRows(rows, { dateFrom, dateTo });

    return {
      dateFrom,
      dateTo,
      headers: report.headers,
      rows: report.rows,
      missingFieldsNote:
        "Часть полей пока не заполнена: себестоимость, доставка, позиция, категория."
    };
  }

  async function buildSkuReport({ dateFrom, dateTo }) {
    const [rows, products] = await Promise.all([
      loadPerformanceRows(dateFrom, dateTo),
      loadProducts()
    ]);

    return {
      dateFrom,
      dateTo,
      rows: buildSkuDashboardRows(rows, products),
      missingFieldsNote:
        "Часть полей пока не заполнена: себестоимость, доставка, позиция, категория."
    };
  }

  async function exportPnlReport({ dateFrom, dateTo }) {
    const report = await buildPnlReport({ dateFrom, dateTo });
    const result = await sheetsService.clearAndWriteMappedRows("pnl_summary", report.rows, {
      headers: report.headers
    });
    return { report, writeResult: result };
  }

  async function exportSkuReport({ dateFrom, dateTo }) {
    const report = await buildSkuReport({ dateFrom, dateTo });
    const result = await sheetsService.clearAndWriteMappedRows("sku_dashboard", report.rows);
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
  createReportBuilderService,
  listDates
};
