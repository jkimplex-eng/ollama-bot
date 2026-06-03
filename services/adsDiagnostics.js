const {
  buildReconciliationRows,
  getReconciliationStatus,
  summarizeReconciliation
} = require("./verification/reconciliationVerification");

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

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const parsed = Number(
    String(value)
      .replace(/\s/g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "")
  );

  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Number(toNumber(value).toFixed(2));
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

function uniqueSorted(items) {
  return Array.from(new Set(items.filter(Boolean))).sort();
}

function normalizePerformanceRow(row) {
  return {
    ...row,
    date: formatDate(row.date)
  };
}

function createPerformanceDedupeKey(row) {
  return [
    formatDate(row.date),
    String(row.campaignId || ""),
    String(row.sku || ""),
    round2(row.spend),
    round2(row.impressions),
    round2(row.clicks)
  ].join("|");
}

function dedupePerformanceRows(rows) {
  const normalizedRows = rows.map(normalizePerformanceRow);
  const map = new Map();

  for (const row of normalizedRows) {
    map.set(createPerformanceDedupeKey(row), row);
  }

  const dedupedRows = Array.from(map.values());
  return {
    normalizedRows,
    dedupedRows,
    duplicatesRemovedCount: Math.max(0, normalizedRows.length - dedupedRows.length)
  };
}

function getAvailableFields(rows) {
  return uniqueSorted(
    rows.flatMap(row => Object.keys(row || {})).filter(Boolean)
  );
}

function aggregateByDate(rows, dates) {
  const totals = new Map(
    dates.map(date => [
      date,
      {
        date,
        impressions: 0,
        clicks: 0,
        spend: 0,
        orders: 0,
        revenue: 0
      }
    ])
  );

  for (const row of rows) {
    const date = formatDate(row.date);
    if (!totals.has(date)) {
      continue;
    }

    const current = totals.get(date);
    current.impressions += toNumber(row.impressions);
    current.clicks += toNumber(row.clicks);
    current.spend += toNumber(row.spend);
    current.orders += toNumber(row.orders);
    current.revenue += toNumber(row.revenue);
  }

  return Array.from(totals.values()).map(item => ({
    ...item,
    ctr: item.impressions ? round2((item.clicks / item.impressions) * 100) : 0,
    cpc: item.clicks ? round2(item.spend / item.clicks) : 0,
    drr: item.revenue ? round2((item.spend / item.revenue) * 100) : 0
  }));
}

function aggregateCampaignSummary(rows) {
  const byCampaign = new Map();

  for (const row of rows) {
    const campaignId = String(row.campaignId || "");
    const key = campaignId || "unknown";
    const current = byCampaign.get(key) || {
      campaignId,
      campaignName: row.campaignName || "",
      days: new Set(),
      impressions: 0,
      clicks: 0,
      spend: 0,
      orders: 0,
      revenue: 0
    };

    current.campaignName = current.campaignName || row.campaignName || "";
    current.days.add(formatDate(row.date));
    current.impressions += toNumber(row.impressions);
    current.clicks += toNumber(row.clicks);
    current.spend += toNumber(row.spend);
    current.orders += toNumber(row.orders);
    current.revenue += toNumber(row.revenue);
    byCampaign.set(key, current);
  }

  return Array.from(byCampaign.values())
    .map(item => ({
      campaignId: item.campaignId || "",
      campaignName: item.campaignName || "",
      days: item.days.size,
      impressions: item.impressions,
      clicks: item.clicks,
      spend: round2(item.spend),
      orders: round2(item.orders),
      revenue: round2(item.revenue),
      ctr: item.impressions ? round2((item.clicks / item.impressions) * 100) : 0,
      cpc: item.clicks ? round2(item.spend / item.clicks) : 0,
      drr: item.revenue ? round2((item.spend / item.revenue) * 100) : 0,
      warnings: [
        item.impressions <= 0 ? "no impressions" : "",
        item.clicks <= 0 ? "no clicks" : "",
        item.revenue <= 0 ? "no revenue attribution" : "",
        item.spend > 0 && item.orders <= 0 && item.revenue <= 0 ? "spend exists but no orders/revenue" : ""
      ].filter(Boolean)
    }))
    .sort((left, right) => right.spend - left.spend);
}

function aggregateSkuSummary(rows) {
  const bySku = new Map();

  for (const row of rows) {
    const sku = String(row.sku || "");
    const key = sku || "unknown";
    const current = bySku.get(key) || {
      sku,
      productName: row.productName || "",
      impressions: 0,
      clicks: 0,
      spend: 0,
      orders: 0,
      revenue: 0
    };

    current.productName = current.productName || row.productName || "";
    current.impressions += toNumber(row.impressions);
    current.clicks += toNumber(row.clicks);
    current.spend += toNumber(row.spend);
    current.orders += toNumber(row.orders);
    current.revenue += toNumber(row.revenue);
    bySku.set(key, current);
  }

  return Array.from(bySku.values())
    .map(item => ({
      sku: item.sku || "",
      productName: item.productName || "",
      spend: round2(item.spend),
      impressions: item.impressions,
      clicks: item.clicks,
      orders: round2(item.orders),
      revenue: round2(item.revenue),
      ctr: item.impressions ? round2((item.clicks / item.impressions) * 100) : 0,
      cpc: item.clicks ? round2(item.spend / item.clicks) : 0,
      drr: item.revenue ? round2((item.spend / item.revenue) * 100) : 0,
      warnings: [
        item.impressions <= 0 ? "no impressions" : "",
        item.clicks <= 0 ? "no clicks" : "",
        item.revenue <= 0 ? "no revenue attribution" : "",
        item.spend > 0 && item.orders <= 0 && item.revenue <= 0 ? "spend exists but no orders/revenue" : ""
      ].filter(Boolean)
    }))
    .sort((left, right) => right.spend - left.spend);
}

function aggregateFactorSlices(rows) {
  const bySlice = new Map();

  for (const row of rows) {
    const campaignId = String(row.campaignId || "");
    const sku = String(row.sku || "");
    const key = [campaignId, sku].join("|");
    const current = bySlice.get(key) || {
      campaignId,
      campaignName: row.campaignName || "",
      sku,
      offerId: String(row.offerId || ""),
      productName: row.productName || "",
      spend: 0,
      impressions: 0,
      clicks: 0,
      orders: 0,
      revenue: 0
    };

    current.campaignName = current.campaignName || row.campaignName || "";
    current.offerId = current.offerId || String(row.offerId || "");
    current.productName = current.productName || row.productName || "";
    current.spend += toNumber(row.spend);
    current.impressions += toNumber(row.impressions);
    current.clicks += toNumber(row.clicks);
    current.orders += toNumber(row.orders);
    current.revenue += toNumber(row.revenue);
    bySlice.set(key, current);
  }

  return Array.from(bySlice.values())
    .map(item => ({
      ...item,
      spend: round2(item.spend),
      orders: round2(item.orders),
      revenue: round2(item.revenue),
      ctr: item.impressions ? round2((item.clicks / item.impressions) * 100) : 0,
      cpc: item.clicks ? round2(item.spend / item.clicks) : 0,
      drr: item.revenue ? round2((item.spend / item.revenue) * 100) : 0
    }))
    .sort((left, right) => right.spend - left.spend);
}

function detectCoverageCategory(group) {
  const operationType = String(group.operationType || "").toLowerCase();
  const operationName = String(group.operationTypeName || "").toLowerCase();
  const serviceName = String(group.serviceName || "").toLowerCase();
  const haystack = [operationType, operationName, serviceName].join(" ");

  if (
    haystack.includes("costperclick") ||
    haystack.includes("оплата за клик") ||
    /\bcpc\b/.test(haystack) ||
    haystack.includes("click")
  ) {
    return "cpc";
  }

  if (
    haystack.includes("promotionwithcostperorder") ||
    haystack.includes("продвижение с оплатой за заказ") ||
    haystack.includes("за заказ") ||
    haystack.includes("cost per order") ||
    haystack.includes("cpo")
  ) {
    return "order_promo";
  }

  if (
    haystack.includes("brandcommission") ||
    haystack.includes("продвижение бренда") ||
    haystack.includes("brand promotion") ||
    haystack.includes("brand")
  ) {
    return "brand_promo";
  }

  if (
    haystack.includes("acceleratedproductreviews") ||
    haystack.includes("ускоренный сбор отзывов") ||
    haystack.includes("reviews") ||
    haystack.includes("review")
  ) {
    return "reviews_promo";
  }

  if (
    haystack.includes("promotion") ||
    haystack.includes("продвижение") ||
    haystack.includes("advertising") ||
    haystack.includes("реклама")
  ) {
    return "generic_ads";
  }

  return "unknown";
}

function buildGapRecommendations(groups) {
  const recommendations = [];
  const categories = new Set(groups.map(item => item.coverageCategory));
  const hasPerformanceCoverage = groups.some(
    item => item.attributionStatus === "FULLY_COVERED" || item.attributionStatus === "PARTIALLY_COVERED"
  );

  if (hasPerformanceCoverage) {
    recommendations.push("Performance API currently covers only CPC campaigns.");
  }
  if (categories.has("brand_promo")) {
    recommendations.push("Brand promotion costs are not attributable.");
  }
  if (categories.has("reviews_promo")) {
    recommendations.push("Reviews promotion costs are not attributable.");
  }
  if (categories.has("order_promo")) {
    recommendations.push("Order-based promotion costs are not attributable.");
  }
  if (categories.has("generic_ads") || categories.has("unknown")) {
    recommendations.push("Some finance advertising groups still have no reliable campaign/SKU attribution.");
  }

  return uniqueSorted(recommendations);
}

function buildCoverageMapping(financeBreakdown, reconciliationTotals, campaignSummary) {
  const performanceSpend = round2(reconciliationTotals?.coveredByPerformance || 0);
  let availableCoveredSpend = performanceSpend;
  const assumptions = [
    "Coverage mapping is heuristic and read-only.",
    "Current Performance rows are treated as CPC-like coverage when finance operation type clearly matches click-based advertising.",
    "Brand, reviews, and order-based promotion costs are treated as not attributable unless explicit campaign-type attribution is available."
  ];
  const performanceCampaignGroups = [
    {
      group: "performance_rows",
      campaignCount: campaignSummary.length,
      spend: performanceSpend,
      note: performanceSpend > 0 ? "Observed Performance-attributed spend" : "No Performance-attributed spend"
    }
  ];

  const coverageGroups = (financeBreakdown?.groups || []).map(group => {
    const amount = round2(group.amount);
    const coverageCategory = detectCoverageCategory(group);
    let attributionStatus = "NOT_COVERED";
    let coveredAmount = 0;
    let uncoveredAmount = amount;
    let rationale = "No reliable match from current Performance attribution.";

    if (coverageCategory === "cpc" && performanceSpend > 0) {
      coveredAmount = round2(Math.min(amount, availableCoveredSpend));
      uncoveredAmount = round2(Math.max(0, amount - coveredAmount));
      attributionStatus = uncoveredAmount <= 10 ? "FULLY_COVERED" : "PARTIALLY_COVERED";
      availableCoveredSpend = round2(Math.max(0, availableCoveredSpend - coveredAmount));
      rationale =
        attributionStatus === "FULLY_COVERED"
          ? "Click-based finance advertising is fully represented by current Performance spend."
          : "Click-based finance advertising is only partly represented by current Performance spend.";
    } else if (coverageCategory === "cpc") {
      rationale = "Click-based finance advertising exists, but there is no Performance spend for the period.";
    } else if (coverageCategory === "order_promo") {
      rationale = "Order-based promotion appears in finance, but current Performance attribution does not isolate it.";
    } else if (coverageCategory === "brand_promo") {
      rationale = "Brand promotion appears only in finance diagnostics, not in current Performance attribution.";
    } else if (coverageCategory === "reviews_promo") {
      rationale = "Reviews promotion appears only in finance diagnostics, not in current Performance attribution.";
    } else if (coverageCategory === "generic_ads") {
      rationale = "Advertising group detected in finance, but current attribution is too generic to map safely.";
    }

    return {
      ...group,
      coverageCategory,
      attributionStatus,
      coveredAmount,
      uncoveredAmount,
      rationale
    };
  });

  return {
    groups: coverageGroups,
    assumptions,
    performanceCampaignGroups
  };
}

function buildAdsGapsSummary(reconciliationTotals) {
  return {
    performanceCoveredSpend: round2(reconciliationTotals?.coveredByPerformance || 0),
    financeAdvertisingTotal: round2(reconciliationTotals?.totalFinanceAdvertisingSpend || 0),
    uncoveredAdvertisingSpend: round2(reconciliationTotals?.uncoveredFinanceAdvertising || 0),
    coveragePercent: round2(reconciliationTotals?.coveragePercent || 0)
  };
}

function buildStockIndex(stockRows) {
  const bySku = new Map();
  const byOfferId = new Map();

  for (const row of stockRows || []) {
    const sku = String(row.sku || "").trim();
    const offerId = String(row.offerId || "").trim().toLowerCase();
    const available = toNumber(row.available);
    const nextSku = round2((bySku.get(sku) || 0) + available);
    const nextOfferId = round2((byOfferId.get(offerId) || 0) + available);

    if (sku) {
      bySku.set(sku, nextSku);
    }
    if (offerId) {
      byOfferId.set(offerId, nextOfferId);
    }
  }

  return { bySku, byOfferId };
}

function buildProductIndex(products) {
  const bySku = new Map();
  const byOfferId = new Map();

  for (const product of products || []) {
    const sku = String(product?.sku || "").trim();
    const offerId = String(product?.offerId || "").trim();
    if (sku) {
      bySku.set(sku, product);
    }
    if (offerId) {
      byOfferId.set(offerId.toLowerCase(), product);
    }
  }

  return { bySku, byOfferId };
}

function buildSalesIndex(rows) {
  const bySku = new Map();
  const byOfferId = new Map();

  for (const row of rows || []) {
    const sku = String(row?.sku || "").trim();
    const offerId = String(row?.offerId || "").trim();
    const next = current => {
      const item = current || {
        quantity: 0,
        revenue: 0,
        rowsMatched: 0,
        offerId,
        sku,
        productName: String(row?.productName || "")
      };
      item.quantity += toNumber(row?.quantity);
      item.revenue += toNumber(row?.revenue);
      item.rowsMatched += 1;
      item.offerId = item.offerId || offerId;
      item.sku = item.sku || sku;
      item.productName = item.productName || String(row?.productName || "");
      return item;
    };

    if (sku) {
      bySku.set(sku, next(bySku.get(sku)));
    }
    if (offerId) {
      const offerIdKey = offerId.toLowerCase();
      byOfferId.set(offerIdKey, next(byOfferId.get(offerIdKey)));
    }
  }

  return { bySku, byOfferId };
}

function resolveSliceIdentity(slice, productIndex, salesIndex, cogsService) {
  const sku = String(slice?.sku || "").trim();
  const rawOfferId = String(slice?.offerId || "").trim();
  const productBySku = sku ? productIndex.bySku.get(sku) : null;
  const productByOfferId = rawOfferId ? productIndex.byOfferId.get(rawOfferId.toLowerCase()) : null;
  const salesBySku = sku ? salesIndex.bySku.get(sku) : null;
  const salesByOfferId = rawOfferId ? salesIndex.byOfferId.get(rawOfferId.toLowerCase()) : null;
  const cogsResolved = cogsService ? cogsService.resolveCogs(sku, rawOfferId) : null;
  const cogsEntry = cogsResolved ? cogsResolved.match : null;

  const resolvedOfferId =
    rawOfferId ||
    String(productBySku?.offerId || "") ||
    String(salesBySku?.offerId || "") ||
    String(cogsEntry?.offerId || "") ||
    "";
  const resolvedOfferIdKey = resolvedOfferId.toLowerCase();
  const product =
    productBySku ||
    productByOfferId ||
    (resolvedOfferIdKey ? productIndex.byOfferId.get(resolvedOfferIdKey) : null) ||
    null;
  const salesMatch =
    salesBySku ||
    salesByOfferId ||
    (resolvedOfferIdKey ? salesIndex.byOfferId.get(resolvedOfferIdKey) : null) ||
    null;
  const productName =
    String(slice?.productName || "") ||
    String(product?.name || "") ||
    String(salesMatch?.productName || "") ||
    "";

  let offerIdSource = "none";
  if (rawOfferId) {
    offerIdSource = "ads_row";
  } else if (productBySku?.offerId) {
    offerIdSource = "product_catalog";
  } else if (salesBySku?.offerId) {
    offerIdSource = "sales_facts_sku";
  } else if (cogsEntry?.offerId) {
    offerIdSource = cogsResolved.source;
  }

  let salesMatchSource = "none";
  if (salesBySku) {
    salesMatchSource = "sku";
  } else if (rawOfferId && salesByOfferId) {
    salesMatchSource = "offerId";
  } else if (resolvedOfferIdKey && salesIndex.byOfferId.get(resolvedOfferIdKey)) {
    salesMatchSource = "offerId-case-insensitive";
  }

  return {
    sku,
    offerId: resolvedOfferId,
    offerIdSource,
    product,
    productName,
    salesMatch,
    salesMatchSource,
    cogsResolved,
    cogsEntry
  };
}

function getMonthFromDate(dateValue) {
  return formatDate(dateValue).slice(0, 7);
}

function getCoverageStatusForSlice(slice, reconcileTotals) {
  if (!slice || toNumber(slice.spend) <= 0) {
    return "UNKNOWN";
  }

  if (!reconcileTotals || toNumber(reconcileTotals.totalFinanceAdvertisingSpend) <= 0) {
    return "UNKNOWN";
  }

  if (reconcileTotals.status === "OK") {
    return "FULLY_COVERED";
  }

  if (reconcileTotals.status === "PARTIAL_COVERAGE") {
    return "PARTIALLY_COVERED";
  }

  if (reconcileTotals.status === "MISSING_FINANCE") {
    return "UNKNOWN";
  }

  if (reconcileTotals.status === "MISSING_ADS") {
    return "NOT_COVERED";
  }

  return "UNKNOWN";
}

function classifyTrafficQuality(ctr) {
  const value = toNumber(ctr);
  if (value <= 0) {
    return "unknown";
  }
  if (value >= 5) {
    return "high";
  }
  if (value >= 2) {
    return "medium";
  }
  return "low";
}

function classifyClickCost(cpc) {
  const value = toNumber(cpc);
  if (value <= 0) {
    return "unknown";
  }
  if (value >= 100) {
    return "high";
  }
  if (value >= 30) {
    return "medium";
  }
  return "low";
}

function classifyConversion(slice) {
  if (toNumber(slice.orders) > 0 || toNumber(slice.revenue) > 0) {
    return "present";
  }
  return "missing";
}

function classifyEconomics(grossProfitEstimate) {
  if (grossProfitEstimate === null || grossProfitEstimate === undefined) {
    return "unknown";
  }
  if (toNumber(grossProfitEstimate) >= 0) {
    return "positive";
  }
  return "negative";
}

function classifyStockRisk(stockAvailable, salesQuantity, days) {
  if (stockAvailable === null || stockAvailable === undefined) {
    return "unknown stock";
  }
  const velocity = days > 0 ? toNumber(salesQuantity) / days : 0;
  if (toNumber(stockAvailable) <= 0) {
    return "low stock";
  }
  if (velocity > 0) {
    const daysOfStock = toNumber(stockAvailable) / velocity;
    if (daysOfStock < 7) {
      return "low stock";
    }
  }
  return "in stock";
}

function classifyDataQuality({ hasSales, hasCogs, hasStock, coverageStatus }) {
  if (!hasSales && !hasCogs && !hasStock) {
    return "insufficient";
  }
  if (coverageStatus === "PARTIALLY_COVERED" || coverageStatus === "NOT_COVERED") {
    return "partial";
  }
  if (hasSales && hasCogs && hasStock) {
    return "reliable";
  }
  if (hasSales || hasCogs || hasStock) {
    return "partial";
  }
  return "insufficient";
}

function getConfidenceLevel({ hasAds, hasSales, hasCogs, hasStock }) {
  if (hasAds && hasSales && hasCogs && hasStock) {
    return "HIGH";
  }
  if (hasAds && hasSales && hasCogs) {
    return "MEDIUM";
  }
  return "LOW";
}

function buildFinanceAdvertisingBreakdown(financeRows, diagnostics) {
  const financeByDate = new Map(
    (financeRows || []).map(row => [formatDate(row.date), Math.abs(round2(row.advertising))])
  );
  const periodTotal = round2(
    Array.from(financeByDate.values()).reduce((sum, value) => sum + toNumber(value), 0)
  );
  const periodGroups = (diagnostics?.advertisingGroups || []).map(item => ({
    operationType: item.operationType || "",
    operationTypeName: item.operationTypeName || "",
    serviceName: item.serviceName || "",
    amount: round2(Math.abs(item.totalAmount)),
    sharePercent: periodTotal ? round2((Math.abs(toNumber(item.totalAmount)) / periodTotal) * 100) : 0
  }));
  const byDate = (diagnostics?.advertisingGroupsByDate || []).map(entry => {
    const dateTotal = financeByDate.get(formatDate(entry.date)) || 0;
    const groups = (entry.groups || []).map(item => ({
      date: formatDate(entry.date),
      operationType: item.operationType || "",
      operationTypeName: item.operationTypeName || "",
      serviceName: item.serviceName || "",
      amount: round2(Math.abs(item.totalAmount)),
      sharePercent: dateTotal ? round2((Math.abs(toNumber(item.totalAmount)) / dateTotal) * 100) : 0
    }));

    return {
      date: formatDate(entry.date),
      count: groups.length,
      totalAmount: dateTotal,
      groups
    };
  });

  return {
    periodCount: periodGroups.length,
    periodTotal,
    groups: periodGroups.sort((left, right) => right.amount - left.amount),
    byDate
  };
}

function summarizeWarnings({ performanceRows, financeRows, availableFields }) {
  const warnings = [];

  if (!performanceRows.length) {
    warnings.push("Нет локальных Performance rows за период.");
  }

  if (!financeRows.length) {
    warnings.push("Нет finance advertising за период.");
  }

  if (performanceRows.length) {
    warnings.push("Raw CSV rows are not stored separately. Diagnostics use persisted normalized Performance rows.");
  }

  if (!availableFields.includes("offerId")) {
    warnings.push("Offer ID attribution unavailable in current Performance rows.");
  }

  if (!availableFields.includes("campaignType") && !availableFields.includes("advObjectType")) {
    warnings.push("Campaign type attribution unavailable in stored stats rows.");
  }

  const hasOrders = availableFields.includes("orders");
  const hasRevenue = availableFields.includes("revenue");
  if (!hasOrders || !hasRevenue) {
    warnings.push("Orders/revenue attribution is partially unavailable.");
  }

  return warnings;
}

function createAdsDiagnosticsService({
  cogsService,
  externalTrafficPlanService,
  financeFactsService,
  ozonService,
  performanceService,
  prioritySkusService,
  salesFactsService
}) {
  async function loadInputs(dateFrom, dateTo) {
    const performanceRows = await performanceService.getStoredRowsForDateRange(dateFrom, dateTo);
    const deduped = dedupePerformanceRows(performanceRows);
    let financeRows = financeFactsService.getFinanceRowsForDateRange(dateFrom, dateTo);
    let financeSource = "stored";
    let financeDiagnostics = null;
    let financeBreakdownSource = "unavailable";
    let financeFetchWarning = "";

    if (ozonService && typeof ozonService.getFinanceFacts === "function") {
      try {
        const live = await ozonService.getFinanceFacts({
          dateFrom: dateFrom + "T00:00:00+03:00",
          dateTo: dateTo + "T23:59:59.999+03:00"
        });
        financeDiagnostics = live?.diagnostics || null;
        financeBreakdownSource = financeDiagnostics ? "live_fetch" : "live_fetch_empty";
        if (!financeRows.length) {
          financeRows = Array.isArray(live?.rows) ? live.rows : [];
          financeSource = financeRows.length ? "live_fetch" : "live_fetch_empty";
        }
      } catch (err) {
        financeBreakdownSource = "live_fetch_failed";
        financeFetchWarning = err.userMessage || err.message;
      }
    }

    const availableFields = getAvailableFields(deduped.dedupedRows);
    const reconciliation = buildReconciliationRows({
      dateFrom,
      dateTo,
      performanceRows: deduped.dedupedRows,
      financeRows
    });
    const warnings = summarizeWarnings({
      performanceRows: deduped.dedupedRows,
      financeRows,
      availableFields
    });
    if (financeFetchWarning) {
      warnings.push("Finance advertising breakdown unavailable: " + financeFetchWarning);
    }
    const financeBreakdown = buildFinanceAdvertisingBreakdown(financeRows, financeDiagnostics);

    return {
      performanceRows: deduped.dedupedRows,
      financeRows,
      financeSource,
      financeBreakdownSource,
      financeBreakdown,
      rawRowsCount: performanceRows.length,
      normalizedRowsCount: deduped.normalizedRows.length,
      dedupedRowsCount: deduped.dedupedRows.length,
      duplicatesRemovedCount: deduped.duplicatesRemovedCount,
      availableFields,
      reconciliation,
      warnings
    };
  }

  async function buildDebug({ dateFrom, dateTo }) {
    const loaded = await loadInputs(dateFrom, dateTo);

    return {
      dateFrom,
      dateTo,
      endpoints: [
        "Performance CSV report endpoint: GET /api/client/statistics/report?UUID=<uuid>",
        "Performance campaigns endpoint: GET /api/client/campaign",
        "Finance endpoint: POST /v3/finance/transaction/list"
      ],
      rawRowsCount: loaded.rawRowsCount,
      normalizedRowsCount: loaded.normalizedRowsCount,
      dedupedRowsCount: loaded.dedupedRowsCount,
      duplicatesRemovedCount: loaded.duplicatesRemovedCount,
      financeRowsCount: loaded.financeRows.length,
      financeSource: loaded.financeSource,
      financeBreakdownSource: loaded.financeBreakdownSource,
      financeBreakdown: loaded.financeBreakdown,
      availableFields: loaded.availableFields,
      sampleRows: loaded.performanceRows.slice(0, 5),
      warnings: loaded.warnings,
      reconciliation: loaded.reconciliation
    };
  }

  async function buildReport({ dateFrom, dateTo }) {
    const loaded = await loadInputs(dateFrom, dateTo);
    const dailySummary = aggregateByDate(loaded.performanceRows, listDates(dateFrom, dateTo));
    const campaignSummary = aggregateCampaignSummary(loaded.performanceRows);

    const warnings = [...loaded.warnings];
    if (!campaignSummary.length) {
      warnings.push("Campaign summary unavailable because no Performance rows were found.");
    }

    return {
      dateFrom,
      dateTo,
      dailySummary,
      campaignSummary,
      reconciliation: loaded.reconciliation,
      financeBreakdown: loaded.financeBreakdown,
      warnings
    };
  }

  async function buildCampaigns({ dateFrom, dateTo }) {
    const loaded = await loadInputs(dateFrom, dateTo);
    const campaigns = aggregateCampaignSummary(loaded.performanceRows).slice(0, 20);
    const warnings = [...loaded.warnings];

    if (!campaigns.length) {
      warnings.push("Campaign attribution unavailable because no Performance rows were found.");
    }

    return {
      dateFrom,
      dateTo,
      campaigns,
      warnings
    };
  }

  async function buildSku({ dateFrom, dateTo }) {
    const loaded = await loadInputs(dateFrom, dateTo);
    const skuRows = aggregateSkuSummary(loaded.performanceRows).slice(0, 20);
    const warnings = [...loaded.warnings];

    if (!skuRows.length) {
      warnings.push("SKU attribution unavailable because no Performance rows were found.");
    }
    if (!loaded.availableFields.includes("offerId")) {
      warnings.push("Offer ID attribution unavailable in current Performance rows.");
    }

    return {
      dateFrom,
      dateTo,
      skuRows,
      warnings
    };
  }

  async function buildReconcile({ dateFrom, dateTo }) {
    const loaded = await loadInputs(dateFrom, dateTo);

    return {
      dateFrom,
      dateTo,
      rows: loaded.reconciliation,
      totals: summarizeReconciliation(loaded.reconciliation),
      financeBreakdown: loaded.financeBreakdown,
      warnings: loaded.warnings.filter(
        item =>
          item === "Нет локальных Performance rows за период." ||
          item === "Нет finance advertising за период."
      )
    };
  }

  async function buildGaps({ dateFrom, dateTo }) {
    const loaded = await loadInputs(dateFrom, dateTo);
    const totals = summarizeReconciliation(loaded.reconciliation);
    const campaignSummary = aggregateCampaignSummary(loaded.performanceRows);
    const coverageMapping = buildCoverageMapping(loaded.financeBreakdown, totals, campaignSummary);

    return {
      dateFrom,
      dateTo,
      summary: buildAdsGapsSummary(totals),
      uncoveredGroups: coverageMapping.groups
        .filter(item => item.uncoveredAmount > 0)
        .sort((left, right) => right.amount - left.amount),
      recommendations: buildGapRecommendations(coverageMapping.groups),
      warnings: loaded.warnings.filter(
        item =>
          item === "Нет локальных Performance rows за период." ||
          item === "Нет finance advertising за период."
      )
    };
  }

  async function buildGapsDebug({ dateFrom, dateTo }) {
    const loaded = await loadInputs(dateFrom, dateTo);
    const totals = summarizeReconciliation(loaded.reconciliation);
    const campaignSummary = aggregateCampaignSummary(loaded.performanceRows);
    const coverageMapping = buildCoverageMapping(loaded.financeBreakdown, totals, campaignSummary);

    return {
      dateFrom,
      dateTo,
      summary: buildAdsGapsSummary(totals),
      financeAdvertisingGroups: loaded.financeBreakdown.groups,
      performanceCampaignGroups: coverageMapping.performanceCampaignGroups,
      coverageMappingTable: coverageMapping.groups,
      coverageAssumptions: coverageMapping.assumptions,
      recommendations: buildGapRecommendations(coverageMapping.groups),
      warnings: loaded.warnings
    };
  }

  async function buildFactors({ dateFrom, dateTo }) {
    const loaded = await loadInputs(dateFrom, dateTo);
    const totals = summarizeReconciliation(loaded.reconciliation);
    const factorSlices = aggregateFactorSlices(loaded.performanceRows);
    const salesRows = salesFactsService ? salesFactsService.getSalesRowsForDateRange(dateFrom, dateTo) : [];
    const days = Math.max(1, listDates(dateFrom, dateTo).length);
    const warnings = [...loaded.warnings];
    const month = getMonthFromDate(dateFrom);
    const priorityItems = prioritySkusService ? prioritySkusService.list(month) : [];
    const trafficPlan = externalTrafficPlanService ? externalTrafficPlanService.getPlan(month) : null;
    const priorityOfferIdKeys = new Set(priorityItems.map(item => String(item.offerIdKey || "").toLowerCase()));
    const prioritySkus = new Set(priorityItems.map(item => String(item.sku || "").trim()).filter(Boolean));
    let stockRows = [];
    let stockSource = "unavailable";
    let products = [];
    let productSource = "unavailable";

    try {
      if (ozonService && typeof ozonService.getProducts === "function") {
        products = await ozonService.getProducts(1000);
        productSource = "product_catalog";
      }
    } catch (err) {
      warnings.push("Product catalog unavailable for ads factors: " + (err.userMessage || err.message));
      productSource = "unavailable";
    }

    try {
      if (ozonService && typeof ozonService.getNormalizedStockRows === "function") {
        const stockResult = await ozonService.getNormalizedStockRows(1000);
        stockRows = stockResult?.rows || [];
        stockSource = "normalized_stocks";
      }
    } catch (err) {
      warnings.push("Stock data unavailable for ads factors: " + (err.userMessage || err.message));
      stockSource = "unavailable";
    }

    const stockIndex = buildStockIndex(stockRows);
    const productIndex = buildProductIndex(products);
    const salesIndex = buildSalesIndex(salesRows);
    const rows = factorSlices.slice(0, 20).map(slice => {
      const identity = resolveSliceIdentity(slice, productIndex, salesIndex, cogsService);
      const sku = identity.sku;
      const offerId = identity.offerId;
      const offerIdKey = offerId.toLowerCase();
      const salesFact = identity.salesMatch;
      const cogsEntry = identity.cogsEntry;
      const cogsValue = cogsEntry ? toNumber(cogsEntry.cogs) : null;
      const stockAvailable =
        (sku && stockIndex.bySku.has(sku) ? stockIndex.bySku.get(sku) : null) ??
        (offerIdKey && stockIndex.byOfferId.has(offerIdKey) ? stockIndex.byOfferId.get(offerIdKey) : null);
      const prioritySku = prioritySkus.has(sku) || priorityOfferIdKeys.has(offerIdKey);
      const externalTraffic = Boolean(prioritySku && trafficPlan && toNumber(trafficPlan.budget) > 0);
      const grossProfitEstimate =
        cogsValue !== null && salesFact && toNumber(salesFact.revenue) > 0
          ? round2(toNumber(salesFact.revenue) - toNumber(slice.spend) - cogsValue * toNumber(salesFact.quantity))
          : null;
      const coverageStatus = getCoverageStatusForSlice(slice, totals);
      const stockRisk = classifyStockRisk(stockAvailable, salesFact?.quantity || 0, days);
      const hasAds = toNumber(slice.spend) > 0 || toNumber(slice.impressions) > 0 || toNumber(slice.clicks) > 0;
      const hasSales = Boolean(salesFact);
      const hasCogs = cogsValue !== null;
      const hasStock = stockAvailable !== null && stockAvailable !== undefined;
      const dataQuality = classifyDataQuality({ hasSales, hasCogs, hasStock, coverageStatus });
      const warningsForRow = [];

      if (!offerId) {
        warningsForRow.push("offerId unavailable");
      }
      if (!hasSales) {
        warningsForRow.push("sales facts unavailable");
      }
      if (!hasCogs) {
        warningsForRow.push("COGS unknown");
      }
      if (!hasStock) {
        warningsForRow.push("stock unknown");
      }

      return {
        sku,
        offerId,
        productName: identity.productName || "unknown",
        campaignId: slice.campaignId || "",
        campaignName: slice.campaignName || "",
        spend: slice.spend,
        impressions: slice.impressions,
        clicks: slice.clicks,
        ctr: slice.ctr,
        cpc: slice.cpc,
        orders: slice.orders,
        revenue: slice.revenue,
        drr: slice.drr,
        organicSalesQuantity: salesFact ? round2(salesFact.quantity) : 0,
        salesRevenue: salesFact ? round2(salesFact.revenue) : 0,
        salesRowsMatched: salesFact ? salesFact.rowsMatched : 0,
        grossProfitEstimate,
        grossProfitEstimateNote:
          grossProfitEstimate !== null ? "gross profit estimate excludes commission/logistics" : "",
        cogs: cogsValue,
        stockAvailable,
        prioritySku,
        externalTraffic,
        coverageStatus,
        trafficQuality: classifyTrafficQuality(slice.ctr),
        clickCost: classifyClickCost(slice.cpc),
        conversion: classifyConversion(slice),
        economics: classifyEconomics(grossProfitEstimate),
        stockRisk,
        dataQuality,
        confidence: getConfidenceLevel({ hasAds, hasSales, hasCogs, hasStock }),
        attribution: {
          adsSku: sku,
          resolvedOfferId: offerId,
          offerIdSource: identity.offerIdSource,
          salesMatchSource: identity.salesMatchSource,
          cogsSource: identity.cogsResolved ? identity.cogsResolved.source : "none",
          stockSource: stockAvailable !== null && stockAvailable !== undefined ? stockSource : "none",
          productSource
        },
        warnings: warningsForRow
      };
    });

    return {
      dateFrom,
      dateTo,
      rows,
      stockSource,
      productSource,
      warnings
    };
  }

  async function buildFactorsDebug({ dateFrom, dateTo }) {
    const report = await buildFactors({ dateFrom, dateTo });
    return {
      dateFrom,
      dateTo,
      stockSource: report.stockSource,
      productSource: report.productSource,
      rows: report.rows.map(item => ({
        sku: item.sku,
        offerId: item.offerId,
        productName: item.productName,
        campaignId: item.campaignId,
        salesRowsMatched: item.salesRowsMatched,
        salesRevenue: item.salesRevenue,
        organicSalesQuantity: item.organicSalesQuantity,
        cogs: item.cogs,
        coverageStatus: item.coverageStatus,
        confidence: item.confidence,
        attribution: item.attribution
      })),
      warnings: report.warnings
    };
  }

  return {
    aggregateByDate,
    aggregateCampaignSummary,
    aggregateFactorSlices,
    aggregateSkuSummary,
    buildCampaigns,
    buildDebug,
    buildFactors,
    buildFactorsDebug,
    buildGaps,
    buildGapsDebug,
    buildReconcile,
    buildReconciliationRows,
    buildReport,
    buildSku
  };
}

module.exports = {
  aggregateByDate,
  aggregateCampaignSummary,
  aggregateSkuSummary,
  buildReconciliationRows,
  createAdsDiagnosticsService,
  dedupePerformanceRows,
  getReconciliationStatus,
  normalizePerformanceRow,
  summarizeReconciliation
};
