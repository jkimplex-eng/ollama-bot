const REPLENISHMENT_HEADERS = [
  "City",
  "Warehouse",
  "SKU",
  "Offer ID",
  "Product Name",
  "Sales Per Day",
  "Current Stock",
  "Days Of Stock",
  "Target Stock",
  "Recommended Shipment",
  "Priority",
  "Comment"
];

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function round2(value) {
  return Number(toNumber(value).toFixed(2));
}

function listDates(dateFrom, dateTo) {
  const result = [];
  const current = new Date(dateFrom + "T00:00:00Z");
  const end = new Date(dateTo + "T00:00:00Z");

  while (current <= end) {
    result.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return result;
}

function calculateSalesPerDay(quantitySold, days) {
  if (!days || days < 1) {
    return 0;
  }
  return round2(toNumber(quantitySold) / days);
}

function calculateTargetStock(salesPerDay, forecastDays, safetyDays) {
  return round2(toNumber(salesPerDay) * (toNumber(forecastDays) + toNumber(safetyDays)));
}

function calculateRecommendedShipment(targetStock, currentStock, minShipment) {
  const gap = round2(toNumber(targetStock) - toNumber(currentStock));
  if (gap <= 0) {
    return 0;
  }

  return gap < toNumber(minShipment) ? toNumber(minShipment) : gap;
}

function calculateDaysOfStock(currentStock, salesPerDay) {
  if (toNumber(salesPerDay) <= 0) {
    return 0;
  }
  return round2(toNumber(currentStock) / toNumber(salesPerDay));
}

function getPriority(daysOfStock) {
  const value = toNumber(daysOfStock);
  if (value > 0 && value < 7) {
    return "HIGH";
  }
  if (value > 0 && value < 14) {
    return "MEDIUM";
  }
  return "LOW";
}

function aggregateSalesBySku(rows) {
  const map = new Map();

  for (const row of rows) {
    const sku = String(row.sku || "").trim();
    const offerId = String(row.offerId || "").trim();
    const key = sku || offerId;
    if (!key) {
      continue;
    }

    const current = map.get(key) || {
      sku,
      offerId,
      productName: row.productName || "",
      quantitySold: 0,
      orderedRevenue: 0
    };

    current.quantitySold += toNumber(row.quantity);
    current.orderedRevenue += toNumber(row.revenue);
    if (!current.productName && row.productName) {
      current.productName = row.productName;
    }
    if (!current.offerId && offerId) {
      current.offerId = offerId;
    }
    if (!current.sku && sku) {
      current.sku = sku;
    }

    map.set(key, current);
  }

  return Array.from(map.values());
}

function indexProducts(products) {
  const bySku = new Map();
  const byOfferId = new Map();

  for (const product of products || []) {
    const sku = String(product.sku || "").trim();
    const offerId = String(product.offerId || "").trim();

    if (sku) {
      bySku.set(sku, product);
    }
    if (offerId) {
      byOfferId.set(offerId.toLowerCase(), product);
    }
  }

  return { bySku, byOfferId };
}

function indexStocks(stocks) {
  const bySku = new Map();
  const byOfferId = new Map();

  for (const stock of stocks || []) {
    const sku = String(stock.sku || "").trim();
    const offerId = String(stock.offerId || "").trim();
    const stockValue = toNumber(stock.stock);

    if (sku) {
      bySku.set(sku, stockValue);
    }
    if (offerId) {
      byOfferId.set(offerId.toLowerCase(), stockValue);
    }
  }

  return { bySku, byOfferId };
}

function createReplenishmentService({
  cogsService,
  ozonService,
  salesFactsService,
  sheetsService,
  forecastDays = 21,
  safetyDays = 7,
  minShipment = 1
}) {
  async function buildForecast({ dateFrom, dateTo }) {
    const dates = listDates(dateFrom, dateTo);
    const days = dates.length || 1;
    const salesRows = salesFactsService.getSalesRowsForDateRange(dateFrom, dateTo);
    const aggregatedSales = aggregateSalesBySku(salesRows);
    const products = await ozonService.getProducts(1000);
    let stocks = [];
    const warnings = [];

    try {
      stocks = await ozonService.getStocks(1000);
    } catch (error) {
      warnings.push("Stocks unavailable, forecast uses zero stock.");
      stocks = [];
    }

    const productIndex = indexProducts(products);
    const stockIndex = indexStocks(stocks);

    const rows = aggregatedSales.map(item => {
      const product =
        productIndex.bySku.get(item.sku) ||
        productIndex.byOfferId.get(String(item.offerId || "").toLowerCase()) ||
        null;
      const currentStock =
        stockIndex.bySku.get(item.sku) ??
        stockIndex.byOfferId.get(String(item.offerId || "").toLowerCase()) ??
        0;
      const salesPerDay = calculateSalesPerDay(item.quantitySold, days);
      const targetStock = calculateTargetStock(salesPerDay, forecastDays, safetyDays);
      const recommendedShipment = calculateRecommendedShipment(targetStock, currentStock, minShipment);
      const daysOfStock = calculateDaysOfStock(currentStock, salesPerDay);
      const cogsEntry =
        cogsService?.getCogsBySku(item.sku) ||
        cogsService?.getCogsByOfferId(item.offerId) ||
        null;
      const commentParts = ["Нет разбивки по складам, используется общий остаток SKU."];
      if (warnings.length) {
        commentParts.push("Stocks unavailable, forecast uses zero stock.");
      }

      if (!cogsEntry) {
        commentParts.push("COGS не задан.");
      }

      return [
        "unknown",
        "unknown",
        item.sku || String(product?.sku || ""),
        item.offerId || String(product?.offerId || ""),
        item.productName || product?.name || "",
        salesPerDay,
        round2(currentStock),
        daysOfStock,
        targetStock,
        recommendedShipment,
        getPriority(daysOfStock),
        commentParts.join(" ")
      ];
    });

    return {
      headers: REPLENISHMENT_HEADERS,
      rows,
      summary: {
        period: dateFrom + " -> " + dateTo,
        skuCount: rows.length,
        forecastDays,
        safetyDays,
        minShipment
      },
      warnings
    };
  }

  async function exportForecast(params) {
    const forecast = await buildForecast(params);
    const writeResult = await sheetsService.clearAndWriteMappedRows("replenishment_plan", forecast.rows, {
      headers: REPLENISHMENT_HEADERS
    });
    return { forecast, writeResult };
  }

  return {
    buildForecast,
    exportForecast
  };
}

module.exports = {
  aggregateSalesBySku,
  calculateDaysOfStock,
  calculateRecommendedShipment,
  calculateSalesPerDay,
  calculateTargetStock,
  createReplenishmentService,
  getPriority,
  REPLENISHMENT_HEADERS
};
