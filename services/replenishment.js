const { normalizeMonth } = require("./prioritySkus");

const REPLENISHMENT_HEADERS = [
  "City",
  "Warehouse",
  "SKU",
  "Offer ID",
  "Product Name",
  "Organic Sales Per Day",
  "Current Stock",
  "Days Of Stock",
  "Organic Target Stock",
  "External Traffic Demand ₽",
  "External Traffic Units",
  "Total Target Stock",
  "Recommended Shipment",
  "Priority",
  "Demand Source",
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

function normalizeOfferId(value) {
  return String(value || "").trim();
}

function normalizeOfferIdKey(value) {
  return normalizeOfferId(value).toLowerCase();
}

function calculateSalesPerDay(quantitySold, days) {
  if (!days || days < 1) {
    return 0;
  }
  return round2(toNumber(quantitySold) / days);
}

function calculateTargetStock(salesPerDay, forecastDays, safetyDays, leadTimeDays = 0) {
  return round2(
    toNumber(salesPerDay) * (toNumber(forecastDays) + toNumber(safetyDays) + toNumber(leadTimeDays))
  );
}

function calculateRecommendedShipment(targetStock, currentStock, minShipment) {
  const gap = toNumber(targetStock) - toNumber(currentStock);
  if (gap <= 0) {
    return 0;
  }
  const roundedGap = Math.ceil(gap);
  return roundedGap < toNumber(minShipment) ? toNumber(minShipment) : roundedGap;
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

function getCityForRegion(regionName) {
  const name = String(regionName || "").toLowerCase();
  if (
    name.includes("москва") ||
    name.includes("москов") ||
    name.includes("мск") ||
    name.includes("хоругвино") ||
    name.includes("пушкино")
  ) {
    return "Москва";
  }
  if (
    name.includes("санкт") ||
    name.includes("ленинград") ||
    name.includes("спб") ||
    name.includes("питер") ||
    name.includes("шушары")
  ) {
    return "СПб";
  }
  if (
    name.includes("казань") ||
    name.includes("татарстан") ||
    name.includes("зеленодольск") ||
    name.includes("кзн")
  ) {
    return "Казань";
  }
  return "unknown";
}

function getRegionalSalesQuantity(salesRows) {
  const map = new Map();

  for (const row of salesRows) {
    const sku = String(row.sku || "").trim();
    const offerId = normalizeOfferId(row.offerId);
    const key = sku || offerId;
    if (!key) {
      continue;
    }

    const current = map.get(key) || { "Москва": 0, "СПб": 0, "Казань": 0 };
    const quantity = toNumber(row.quantity);
    const city = getCityForRegion(row.region);

    if (city === "Москва") {
      current["Москва"] += quantity;
    } else if (city === "СПб") {
      current["СПб"] += quantity;
    } else if (city === "Казань") {
      current["Казань"] += quantity;
    } else {
      current["Москва"] += quantity * 0.60;
      current["СПб"] += quantity * 0.20;
      current["Казань"] += quantity * 0.20;
    }

    map.set(key, current);
  }

  return map;
}

function aggregateSalesBySku(rows) {
  const map = new Map();

  for (const row of rows) {
    const sku = String(row.sku || "").trim();
    const offerId = normalizeOfferId(row.offerId);
    const key = sku || offerId;
    if (!key) {
      continue;
    }

    const current = map.get(key) || {
      sku,
      offerId,
      offerIdKey: normalizeOfferIdKey(offerId),
      productName: row.productName || "",
      quantitySold: 0,
      orderedRevenue: 0,
      averageUnitPrice: 0
    };

    current.quantitySold += toNumber(row.quantity);
    current.orderedRevenue += toNumber(row.revenue);
    if (!current.productName && row.productName) {
      current.productName = row.productName;
    }
    if (!current.offerId && offerId) {
      current.offerId = offerId;
      current.offerIdKey = normalizeOfferIdKey(offerId);
    }
    if (!current.sku && sku) {
      current.sku = sku;
    }

    map.set(key, current);
  }

  return Array.from(map.values()).map(item => ({
    ...item,
    averageUnitPrice: item.quantitySold > 0 ? round2(item.orderedRevenue / item.quantitySold) : 0
  }));
}

function indexProducts(products) {
  const bySku = new Map();
  const byOfferId = new Map();

  for (const product of products || []) {
    const sku = String(product.sku || "").trim();
    const offerId = normalizeOfferId(product.offerId);

    if (sku) {
      bySku.set(sku, product);
    }
    if (offerId) {
      byOfferId.set(normalizeOfferIdKey(offerId), product);
    }
  }

  return { bySku, byOfferId };
}

function indexStockRows(stockRows, warehouseMappingService) {
  const bySkuCity = new Map();
  const byOfferIdCity = new Map();
  const warnings = new Set();

  for (const stockRow of stockRows || []) {
    const sku = String(stockRow.sku || "").trim();
    const offerId = normalizeOfferId(stockRow.offerId);
    const mapping = warehouseMappingService?.resolveMapping
      ? warehouseMappingService.resolveMapping({
          warehouseId: stockRow.warehouseId,
          warehouseName: stockRow.warehouseName
        })
      : null;
    const city = normalizeOfferId(mapping?.city || stockRow.city || "unknown");
    const cluster = normalizeOfferId(mapping?.cluster || stockRow.cluster || "");
    const warehouseName = normalizeOfferId(
      stockRow.warehouseName || mapping?.warehouseName || "unknown"
    );
    const warehouseId = normalizeOfferId(stockRow.warehouseId || mapping?.warehouseId || "");
    const present = toNumber(stockRow.present);
    const reserved = toNumber(stockRow.reserved);
    const available = toNumber(stockRow.available);

    if (!mapping && city === "unknown") {
      warnings.add("Warehouse mapping missing. Using unknown city/warehouse for some stock rows.");
    }

    const skuKey = sku ? `${sku}|${city}` : "";
    const offerKey = offerId ? `${normalizeOfferIdKey(offerId)}|${city}` : "";
    const nextEntry = current => {
      const entry = current || {
        available: 0,
        reserved: 0,
        present: 0,
        city,
        cluster,
        leadTimeDays: mapping?.leadTimeDays,
        warehouses: new Set()
      };
      entry.available += available;
      entry.reserved += reserved;
      entry.present += present;
      entry.warehouses.add(warehouseName || warehouseId || "unknown");
      return entry;
    };

    if (skuKey) {
      bySkuCity.set(skuKey, nextEntry(bySkuCity.get(skuKey)));
    }
    if (offerKey) {
      byOfferIdCity.set(offerKey, nextEntry(byOfferIdCity.get(offerKey)));
    }
  }

  return { bySkuCity, byOfferIdCity, warnings: Array.from(warnings) };
}

function getWarehouseLabel(stockEntry, fallbackCity) {
  if (!stockEntry) {
    return fallbackCity === "Москва" ? "unknown" : "unknown";
  }
  const names = Array.from(stockEntry.warehouses || []);
  if (!names.length) {
    return "unknown";
  }
  if (names.length === 1) {
    return names[0];
  }
  return "multiple";
}

function getLeadTimeDaysForCity(city, stockEntry, defaultLeadTimeDays = 0) {
  if (stockEntry?.leadTimeDays !== undefined && stockEntry?.leadTimeDays !== null) {
    return toNumber(stockEntry.leadTimeDays);
  }
  return toNumber(defaultLeadTimeDays);
}

function calculateExternalDemandValue(budget, coefficient) {
  return round2(toNumber(budget) * toNumber(coefficient));
}

function allocateWeightedDemand(priorityItems, totalDemandValue) {
  const items = Array.isArray(priorityItems) ? priorityItems : [];
  const totalWeight = items.reduce((sum, item) => sum + Math.max(0, toNumber(item.weight, 1) || 1), 0);
  if (!items.length || totalWeight <= 0 || toNumber(totalDemandValue) <= 0) {
    return [];
  }
  return items.map(item => {
    const weight = Math.max(0, toNumber(item.weight, 1) || 1);
    return {
      ...item,
      allocatedDemandValue: round2((toNumber(totalDemandValue) * weight) / totalWeight)
    };
  });
}

function getEstimatedUnitPrice(salesItem, product) {
  const salesPrice = toNumber(salesItem?.averageUnitPrice || 0);
  if (salesPrice > 0) {
    return { price: salesPrice, source: "sales" };
  }
  const productPrice = toNumber(product?.price || 0);
  if (productPrice > 0) {
    return { price: productPrice, source: "product" };
  }
  return { price: 0, source: "none" };
}

function buildMergedItems(aggregatedSales, prioritySkus, productIndex) {
  const map = new Map();

  for (const item of aggregatedSales) {
    const key = item.sku || item.offerIdKey || normalizeOfferIdKey(item.offerId);
    if (!key) {
      continue;
    }
    map.set(key, {
      sku: item.sku || "",
      offerId: item.offerId || "",
      offerIdKey: item.offerIdKey || normalizeOfferIdKey(item.offerId),
      productName: item.productName || "",
      quantitySold: item.quantitySold || 0,
      orderedRevenue: item.orderedRevenue || 0,
      averageUnitPrice: item.averageUnitPrice || 0
    });
  }

  for (const priorityItem of prioritySkus) {
    const key = priorityItem.sku || priorityItem.offerIdKey;
    if (!key) {
      continue;
    }
    const existing = map.get(key) || {
      sku: priorityItem.sku || "",
      offerId: priorityItem.offerId || "",
      offerIdKey: priorityItem.offerIdKey,
      productName: priorityItem.productName || "",
      quantitySold: 0,
      orderedRevenue: 0,
      averageUnitPrice: 0
    };
    if (!existing.offerId && priorityItem.offerId) {
      existing.offerId = priorityItem.offerId;
      existing.offerIdKey = priorityItem.offerIdKey;
    }
    if (!existing.sku && priorityItem.sku) {
      existing.sku = priorityItem.sku;
    }
    if (!existing.productName && priorityItem.productName) {
      existing.productName = priorityItem.productName;
    }
    const product =
      productIndex.bySku.get(existing.sku) ||
      productIndex.byOfferId.get(existing.offerIdKey) ||
      null;
    if (product) {
      if (!existing.sku && product.sku) {
        existing.sku = String(product.sku || "");
      }
      if (!existing.offerId && product.offerId) {
        existing.offerId = String(product.offerId || "");
        existing.offerIdKey = normalizeOfferIdKey(existing.offerId);
      }
      if (!existing.productName && product.name) {
        existing.productName = product.name;
      }
    }
    map.set(key, existing);
  }

  return Array.from(map.values());
}

function buildExternalTrafficContext({
  dateFrom,
  aggregatedSales,
  prioritySkus,
  trafficPlan,
  productIndex,
  warnings
}) {
  const month = normalizeMonth(dateFrom.slice(0, 7));
  if (!trafficPlan) {
    return {
      month,
      trafficPlan: null,
      externalDemandValue: 0,
      allocations: [],
      allocationMap: new Map(),
      warnings
    };
  }

  const externalDemandValue = calculateExternalDemandValue(trafficPlan.budget, trafficPlan.coefficient);
  if (!prioritySkus.length) {
    warnings.push("External traffic plan exists, but no priority SKUs configured.");
    return {
      month,
      trafficPlan,
      externalDemandValue,
      allocations: [],
      allocationMap: new Map(),
      warnings
    };
  }

  const salesIndex = new Map(
    aggregatedSales.map(item => [item.sku || item.offerIdKey || normalizeOfferIdKey(item.offerId), item])
  );

  const weighted = allocateWeightedDemand(prioritySkus, externalDemandValue).map(item => {
    const salesItem =
      salesIndex.get(item.sku || item.offerIdKey) ||
      salesIndex.get(item.offerIdKey) ||
      null;
    const product =
      productIndex.bySku.get(String(item.sku || salesItem?.sku || "").trim()) ||
      productIndex.byOfferId.get(item.offerIdKey) ||
      null;
    const estimated = getEstimatedUnitPrice(salesItem, product);
    const externalUnits = estimated.price > 0 ? Math.ceil(item.allocatedDemandValue / estimated.price) : 0;
    if (estimated.price <= 0) {
      warnings.push(`No estimated price for priority SKU ${item.offerId}. External traffic units set to 0.`);
    }
    return {
      ...item,
      estimatedUnitPrice: estimated.price,
      estimatedUnitPriceSource: estimated.source,
      externalTrafficUnits: externalUnits,
      targetCity: item.targetCity || trafficPlan.targetCity || "Москва"
    };
  });

  return {
    month,
    trafficPlan,
    externalDemandValue,
    allocations: weighted,
    allocationMap: new Map(weighted.map(item => [item.offerIdKey, item])),
    warnings
  };
}

function createReplenishmentService({
  cogsService,
  externalTrafficPlanService,
  ozonService,
  prioritySkusService,
  salesFactsService,
  sheetsService,
  warehouseMappingService,
  forecastDays = 21,
  safetyDays = 7,
  minShipment = 1,
  leadTimeDays = 0
}) {
  async function loadContext({ dateFrom, dateTo }) {
    const dates = listDates(dateFrom, dateTo);
    const days = dates.length || 1;
    const month = normalizeMonth(dateFrom.slice(0, 7));
    const salesRows = salesFactsService.getSalesRowsForDateRange(dateFrom, dateTo);
    const aggregatedSales = aggregateSalesBySku(salesRows);
    const products = await ozonService.getProducts(1000);
    let stockRows = [];
    const warnings = [];
    let stocksUnavailable = false;

    try {
      const normalizedStocks = await ozonService.getNormalizedStockRows(1000);
      stockRows = normalizedStocks.rows || [];
    } catch (error) {
      warnings.push("Stocks unavailable, forecast uses zero stock.");
      stockRows = [];
      stocksUnavailable = true;
    }

    const productIndex = indexProducts(products);
    const stockIndex = indexStockRows(stockRows, warehouseMappingService);
    warnings.push(...stockIndex.warnings);
    const regionalSales = getRegionalSalesQuantity(salesRows);
    const prioritySkus = prioritySkusService ? prioritySkusService.list(month) : [];
    const trafficPlan = externalTrafficPlanService ? externalTrafficPlanService.getPlan(month) : null;
    const trafficContext = buildExternalTrafficContext({
      dateFrom,
      aggregatedSales,
      prioritySkus,
      trafficPlan,
      productIndex,
      warnings
    });
    const mergedItems = buildMergedItems(aggregatedSales, prioritySkus, productIndex);

    return {
      aggregatedSales,
      days,
      mergedItems,
      month,
      prioritySkus,
      productIndex,
      regionalSales,
      stockIndex,
      stockRows,
      stocksUnavailable,
      trafficContext,
      warnings
    };
  }

  function buildRowForCity({
    item,
    city,
    stockEntry,
    citySalesQty,
    cogsEntry,
    currentStock,
    targetCity,
    externalAllocation,
    product,
    stocksUnavailable
  }) {
    const organicSalesPerDay = round2(calculateSalesPerDay(citySalesQty, this.days));
    const appliedLeadTime = getLeadTimeDaysForCity(city, stockEntry, leadTimeDays);
    const organicTargetStock = calculateTargetStock(organicSalesPerDay, forecastDays, safetyDays, appliedLeadTime);
    const externalDemandValue =
      externalAllocation && city === targetCity ? round2(externalAllocation.allocatedDemandValue) : 0;
    const externalTrafficUnits =
      externalAllocation && city === targetCity ? toNumber(externalAllocation.externalTrafficUnits) : 0;
    const totalTargetStock = round2(organicTargetStock + externalTrafficUnits);
    const recommendedShipment = calculateRecommendedShipment(totalTargetStock, currentStock, minShipment);
    const daysOfStock = calculateDaysOfStock(currentStock, organicSalesPerDay);
    const demandSource =
      externalTrafficUnits > 0 && organicTargetStock > 0
        ? "organic + external traffic"
        : externalTrafficUnits > 0
          ? "external traffic"
          : "organic";

    const commentParts = [];
    if (!stocksUnavailable && stockEntry) {
      commentParts.push(`Остатки ${city}: доступно ${round2(stockEntry.available)}, резерв ${round2(stockEntry.reserved)}.`);
    }
    if (!cogsEntry) {
      commentParts.push("COGS не задан.");
    }
    if (externalAllocation && city === targetCity) {
      if (getWarehouseLabel(stockEntry, city) === "unknown") {
        commentParts.push("External traffic assigned to Moscow; warehouse mapping missing.");
      } else {
        commentParts.push(`Priority SKU ${externalAllocation.offerId}; external traffic allocated to ${city}.`);
      }
      if (externalAllocation.estimatedUnitPrice <= 0) {
        commentParts.push("Нет цены для перевода traffic demand в units.");
      }
    }

    return [
      city,
      getWarehouseLabel(stockEntry, city),
      item.sku || String(product?.sku || ""),
      item.offerId || String(product?.offerId || ""),
      item.productName || product?.name || "",
      organicSalesPerDay,
      round2(currentStock),
      daysOfStock,
      organicTargetStock,
      externalDemandValue,
      externalTrafficUnits,
      totalTargetStock,
      recommendedShipment,
      getPriority(currentStock, daysOfStock),
      demandSource,
      commentParts.join(" ")
    ];
  }

  async function buildForecast({ dateFrom, dateTo }) {
    const context = await loadContext({ dateFrom, dateTo });
    const rows = [];

    for (const item of context.mergedItems) {
      const product =
        context.productIndex.bySku.get(item.sku) ||
        context.productIndex.byOfferId.get(item.offerIdKey || normalizeOfferIdKey(item.offerId)) ||
        null;

      const resolved = cogsService ? cogsService.resolveCogs(item.sku, item.offerId) : null;
      const cogsEntry = resolved ? resolved.match : null;
      const skuKey = item.sku || item.offerId || "";
      const regionalEntry = context.regionalSales.get(skuKey) || { "Москва": 0, "СПб": 0, "Казань": 0 };
      const externalAllocation = context.trafficContext.allocationMap.get(item.offerIdKey || normalizeOfferIdKey(item.offerId)) || null;
      const allocationCity = externalAllocation?.targetCity || context.trafficContext.trafficPlan?.targetCity || "Москва";
      const targetCities = new Set(["Москва", "СПб", "Казань"]);
      if (allocationCity) {
        targetCities.add(allocationCity);
      }
      for (const mapEntry of context.stockIndex.bySkuCity.keys()) {
        const [mapSku, mapCity] = mapEntry.split("|");
        if (mapSku === item.sku && mapCity) {
          targetCities.add(mapCity);
        }
      }
      for (const mapEntry of context.stockIndex.byOfferIdCity.keys()) {
        const [mapOfferKey, mapCity] = mapEntry.split("|");
        if (mapOfferKey === normalizeOfferIdKey(item.offerId) && mapCity) {
          targetCities.add(mapCity);
        }
      }

      for (const city of Array.from(targetCities)) {
        const stockSkuKey = item.sku ? `${item.sku}|${city}` : "";
        const stockOfferKey = item.offerId ? `${normalizeOfferIdKey(item.offerId)}|${city}` : "";
        const stockEntry =
          (stockSkuKey ? context.stockIndex.bySkuCity.get(stockSkuKey) : null) ||
          (stockOfferKey ? context.stockIndex.byOfferIdCity.get(stockOfferKey) : null) ||
          { available: 0, reserved: 0, present: 0, city, cluster: "", warehouses: new Set(["unknown"]) };
        const currentStock = toNumber(stockEntry.available);
        const citySalesQty = toNumber(regionalEntry[city] || 0);

        rows.push(buildRowForCity.call(context, {
          item,
          city,
          stockEntry,
          citySalesQty,
          cogsEntry,
          currentStock,
          targetCity: allocationCity,
          externalAllocation,
          product,
          stocksUnavailable: context.stocksUnavailable
        }));
      }
    }

    return {
      headers: REPLENISHMENT_HEADERS,
      rows,
      summary: {
        period: dateFrom + " -> " + dateTo,
        month: context.month,
        skuCount: rows.length,
        forecastDays,
        safetyDays,
        minShipment,
        externalDemandValue: context.trafficContext.externalDemandValue
      },
      warnings: Array.from(new Set(context.warnings))
    };
  }

  async function buildDebug({ dateFrom, dateTo }) {
    const context = await loadContext({ dateFrom, dateTo });
    const rows = [];

    for (const item of context.mergedItems) {
      const product =
        context.productIndex.bySku.get(item.sku) ||
        context.productIndex.byOfferId.get(item.offerIdKey || normalizeOfferIdKey(item.offerId)) ||
        null;
      const resolved = cogsService ? cogsService.resolveCogs(item.sku, item.offerId) : null;
      const cogsVal = resolved ? resolved.match.cogs : "COGS не задан";
      const source = resolved ? resolved.source : "none";
      const externalAllocation = context.trafficContext.allocationMap.get(item.offerIdKey || normalizeOfferIdKey(item.offerId)) || null;
      const estimated = getEstimatedUnitPrice(item, product);

      rows.push({
        offerId: item.offerId || product?.offerId || "",
        sku: item.sku || product?.sku || "",
        quantity: item.quantitySold,
        matchedCogs: cogsVal,
        cogsSource: source,
        externalDemandValue: externalAllocation ? externalAllocation.allocatedDemandValue : 0,
        estimatedUnitPrice: estimated.price,
        estimatedUnitPriceSource: estimated.source,
        externalTrafficUnits: externalAllocation ? externalAllocation.externalTrafficUnits : 0,
        targetCity: externalAllocation?.targetCity || "",
        priority: externalAllocation?.priority || ""
      });
    }

    return rows;
  }

  async function buildTrafficDebug({ dateFrom, dateTo }) {
    const context = await loadContext({ dateFrom, dateTo });
    return {
      month: context.month,
      trafficPlan: context.trafficContext.trafficPlan,
      externalDemandValue: context.trafficContext.externalDemandValue,
      prioritySkus: context.prioritySkus,
      allocations: context.trafficContext.allocations,
      warnings: Array.from(new Set(context.warnings))
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
    buildDebug,
    buildForecast,
    buildTrafficDebug,
    exportForecast
  };
}

module.exports = {
  aggregateSalesBySku,
  allocateWeightedDemand,
  calculateDaysOfStock,
  calculateExternalDemandValue,
  calculateRecommendedShipment,
  calculateSalesPerDay,
  calculateTargetStock,
  createReplenishmentService,
  getEstimatedUnitPrice,
  getPriority,
  REPLENISHMENT_HEADERS,
  indexStockRows,
  getCityForRegion,
  getRegionalSalesQuantity
};
