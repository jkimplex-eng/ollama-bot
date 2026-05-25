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

function getPriority(currentStock, daysOfStock) {
  if (daysOfStock === undefined) {
    const days = toNumber(currentStock);
    if (days > 0 && days < 7) {
      return "HIGH";
    }
    if (days > 0 && days < 14) {
      return "MEDIUM";
    }
    return "LOW";
  }

  const stock = toNumber(currentStock);
  const days = toNumber(daysOfStock);
  if (stock <= 0) {
    return "HIGH";
  }
  if (days < 7) {
    return "HIGH";
  }
  if (days < 14) {
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

function indexStocksByCity(stocks, ozonService) {
  const bySkuCity = new Map();
  const byOfferIdCity = new Map();

  for (const productStock of stocks || []) {
    const sku = String(productStock.sku || "").trim();
    const offerId = String(productStock.offerId || "").trim();
    const warehouseEntries = Array.isArray(productStock.stocks) ? productStock.stocks : [];

    if (warehouseEntries.length === 0) {
      const city = "unknown";
      const skuKey = sku ? `${sku}|${city}` : "";
      const offerKey = offerId ? `${offerId.toLowerCase()}|${city}` : "";
      const entry = { available: 0, reserved: 0, present: 0 };
      if (skuKey) bySkuCity.set(skuKey, entry);
      if (offerKey) byOfferIdCity.set(offerKey, entry);
    } else {
      for (const item of warehouseEntries) {
        const city = ozonService?.getCityForWarehouse 
          ? ozonService.getCityForWarehouse(item.warehouse_id, item.warehouse_name)
          : "unknown";
        
        const present = toNumber(item.present ?? item.stock ?? 0);
        const reserved = toNumber(item.reserved ?? 0);
        const available = item.available !== undefined ? toNumber(item.available) : Math.max(0, present - reserved);

        const skuKey = sku ? `${sku}|${city}` : "";
        const offerKey = offerId ? `${offerId.toLowerCase()}|${city}` : "";

        if (skuKey) {
          const current = bySkuCity.get(skuKey) || { available: 0, reserved: 0, present: 0 };
          current.available += available;
          current.reserved += reserved;
          current.present += present;
          bySkuCity.set(skuKey, current);
        }
        if (offerKey) {
          const current = byOfferIdCity.get(offerKey) || { available: 0, reserved: 0, present: 0 };
          current.available += available;
          current.reserved += reserved;
          current.present += present;
          byOfferIdCity.set(offerKey, current);
        }
      }
    }
  }

  return { bySkuCity, byOfferIdCity };
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
    const stockIndex = indexStocksByCity(stocks, ozonService);

    const rows = [];
    const targetCities = ["Москва", "СПб", "Казань"];
    const cityRatios = {
      "Москва": 0.60,
      "СПб": 0.20,
      "Казань": 0.20
    };
    const cityWarehouses = {
      "Москва": "Хоругвино/Пушкино",
      "СПб": "Шушары",
      "Казань": "Зеленодольск"
    };

    for (const item of aggregatedSales) {
      const product =
        productIndex.bySku.get(item.sku) ||
        productIndex.byOfferId.get(String(item.offerId || "").toLowerCase()) ||
        null;

      const resolved = cogsService ? cogsService.resolveCogs(item.sku, item.offerId) : null;
      const cogsEntry = resolved ? resolved.match : null;

      for (const city of targetCities) {
        const skuKey = item.sku ? `${item.sku}|${city}` : "";
        const offerKey = item.offerId ? `${item.offerId.toLowerCase()}|${city}` : "";

        const stockEntry =
          (skuKey ? stockIndex.bySkuCity.get(skuKey) : null) ||
          (offerKey ? stockIndex.byOfferIdCity.get(offerKey) : null) ||
          { available: 0, reserved: 0, present: 0 };

        const currentStock = stockEntry.available;
        const salesPerDay = calculateSalesPerDay(item.quantitySold, days);
        const salesPerDayCity = round2(salesPerDay * cityRatios[city]);
        const targetStock = calculateTargetStock(salesPerDayCity, forecastDays, safetyDays);
        const recommendedShipment = calculateRecommendedShipment(targetStock, currentStock, minShipment);
        const daysOfStock = calculateDaysOfStock(currentStock, salesPerDayCity);

        const commentParts = [`Остатки ${city}: доступно ${stockEntry.available}, резерв ${stockEntry.reserved}. Нет разбивки по складам внутри кластера.`];
        if (!cogsEntry) {
          commentParts.push("COGS не задан.");
        }

        rows.push([
          city,
          cityWarehouses[city],
          item.sku || String(product?.sku || ""),
          item.offerId || String(product?.offerId || ""),
          item.productName || product?.name || "",
          salesPerDayCity,
          round2(currentStock),
          daysOfStock,
          targetStock,
          recommendedShipment,
          getPriority(currentStock, daysOfStock),
          commentParts.join(" ")
        ]);
      }
    }

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

  async function buildDebug({ dateFrom, dateTo }) {
    const dates = listDates(dateFrom, dateTo);
    const days = dates.length || 1;
    const salesRows = salesFactsService.getSalesRowsForDateRange(dateFrom, dateTo);
    const aggregatedSales = aggregateSalesBySku(salesRows);
    const products = await ozonService.getProducts(1000);
    let stocks = [];

    try {
      stocks = await ozonService.getStocks(1000);
    } catch (error) {
      stocks = [];
    }

    const productIndex = indexProducts(products);
    const stockIndex = indexStocksByCity(stocks, ozonService);

    const rows = [];
    const targetCities = ["Москва", "СПб", "Казань"];
    const cityRatios = {
      "Москва": 0.60,
      "СПб": 0.20,
      "Казань": 0.20
    };

    for (const item of aggregatedSales) {
      const product =
        productIndex.bySku.get(item.sku) ||
        productIndex.byOfferId.get(String(item.offerId || "").toLowerCase()) ||
        null;

      const resolved = cogsService ? cogsService.resolveCogs(item.sku, item.offerId) : null;
      const cogsVal = resolved ? resolved.match.cogs : "COGS не задан";
      const source = resolved ? resolved.source : "none";

      for (const city of targetCities) {
        const skuKey = item.sku ? `${item.sku}|${city}` : "";
        const offerKey = item.offerId ? `${item.offerId.toLowerCase()}|${city}` : "";

        const stockEntry =
          (skuKey ? stockIndex.bySkuCity.get(skuKey) : null) ||
          (offerKey ? stockIndex.byOfferIdCity.get(offerKey) : null) ||
          { available: 0, reserved: 0, present: 0 };

        const currentStock = stockEntry.available;
        const salesPerDay = calculateSalesPerDay(item.quantitySold, days);
        const salesPerDayCity = round2(salesPerDay * cityRatios[city]);
        const targetStock = calculateTargetStock(salesPerDayCity, forecastDays, safetyDays);
        const recommendedShipment = calculateRecommendedShipment(targetStock, currentStock, minShipment);
        const daysOfStock = calculateDaysOfStock(currentStock, salesPerDayCity);

        rows.push({
          offerId: item.offerId || product?.offerId || "",
          sku: item.sku || product?.sku || "",
          quantity: item.quantitySold,
          city,
          currentStock,
          available: stockEntry.available,
          reserved: stockEntry.reserved,
          matchedCogs: cogsVal,
          cogsSource: source,
          recommendedShipment,
          priority: getPriority(currentStock, daysOfStock)
        });
      }
    }

    return rows;
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
    exportForecast,
    buildDebug
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
  REPLENISHMENT_HEADERS,
  indexStocksByCity
};
