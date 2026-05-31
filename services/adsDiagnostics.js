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

function getReconciliationStatus(adsCabinetSpend, financeAdvertisingSpend) {
  const hasAds = adsCabinetSpend > 0;
  const hasFinance = financeAdvertisingSpend > 0;

  if (!hasAds && hasFinance) {
    return "MISSING_ADS";
  }

  if (hasAds && !hasFinance) {
    return "MISSING_FINANCE";
  }

  if (!hasAds && !hasFinance) {
    return "OK";
  }

  const difference = Math.abs(adsCabinetSpend - financeAdvertisingSpend);
  const differencePercent = adsCabinetSpend
    ? (difference / adsCabinetSpend) * 100
    : financeAdvertisingSpend
      ? 100
      : 0;

  return difference <= 10 || differencePercent <= 1 ? "OK" : "WARNING";
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

function buildReconciliationRows({ dateFrom, dateTo, performanceRows, financeRows, dailyInputAdsByDate = new Map() }) {
  const dates = listDates(dateFrom, dateTo);
  const financeAdvertisingByDate = new Map(
    dates.map(date => [date, 0])
  );
  const adsCabinetByDate = new Map(
    dates.map(date => [date, 0])
  );

  for (const row of performanceRows) {
    const date = formatDate(row.date);
    if (adsCabinetByDate.has(date)) {
      adsCabinetByDate.set(date, adsCabinetByDate.get(date) + toNumber(row.spend));
    }
  }

  for (const row of financeRows) {
    const date = formatDate(row.date);
    if (financeAdvertisingByDate.has(date)) {
      financeAdvertisingByDate.set(date, financeAdvertisingByDate.get(date) + Math.abs(toNumber(row.advertising)));
    }
  }

  return dates.map(date => {
    const adsCabinetSpend = round2(adsCabinetByDate.get(date) || 0);
    const financeAdvertisingSpend = round2(financeAdvertisingByDate.get(date) || 0);
    const dailyInputAds = round2(dailyInputAdsByDate.get(date) || 0);
    const difference = round2(adsCabinetSpend - financeAdvertisingSpend);
    const denominator = adsCabinetSpend || financeAdvertisingSpend || 0;
    const differencePercent = denominator ? round2((Math.abs(difference) / denominator) * 100) : 0;
    const status = getReconciliationStatus(adsCabinetSpend, financeAdvertisingSpend);

    return {
      date,
      adsCabinetSpend,
      financeAdvertisingSpend,
      dailyInputAds,
      difference,
      differencePercent,
      status,
      warning:
        status === "WARNING"
          ? "Mismatch exceeds tolerance."
          : status === "MISSING_ADS"
            ? "Ads cabinet spend missing."
            : status === "MISSING_FINANCE"
              ? "Finance advertising missing."
              : ""
    };
  });
}

function summarizeReconciliation(rows) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.adsCabinetSpend += toNumber(row.adsCabinetSpend);
      acc.financeAdvertisingSpend += toNumber(row.financeAdvertisingSpend);
      return acc;
    },
    {
      adsCabinetSpend: 0,
      financeAdvertisingSpend: 0
    }
  );

  const totalAdsCabinetSpend = round2(totals.adsCabinetSpend);
  const totalFinanceAdvertisingSpend = round2(totals.financeAdvertisingSpend);
  const totalDifference = round2(totalAdsCabinetSpend - totalFinanceAdvertisingSpend);
  const denominator = totalAdsCabinetSpend || totalFinanceAdvertisingSpend || 0;
  const totalDifferencePercent = denominator
    ? round2((Math.abs(totalDifference) / denominator) * 100)
    : 0;

  return {
    totalAdsCabinetSpend,
    totalFinanceAdvertisingSpend,
    totalDifference,
    totalDifferencePercent,
    status: getReconciliationStatus(totalAdsCabinetSpend, totalFinanceAdvertisingSpend)
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

function createAdsDiagnosticsService({ financeFactsService, performanceService }) {
  async function loadInputs(dateFrom, dateTo) {
    const performanceRows = await performanceService.getStoredRowsForDateRange(dateFrom, dateTo);
    const financeRows = financeFactsService.getFinanceRowsForDateRange(dateFrom, dateTo);
    const availableFields = getAvailableFields(performanceRows);
    const reconciliation = buildReconciliationRows({
      dateFrom,
      dateTo,
      performanceRows,
      financeRows
    });
    const warnings = summarizeWarnings({
      performanceRows,
      financeRows,
      availableFields
    });

    return {
      performanceRows,
      financeRows,
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
      rawRowsCount: loaded.performanceRows.length,
      normalizedRowsCount: loaded.performanceRows.length,
      financeRowsCount: loaded.financeRows.length,
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

  async function buildReconcile({ dateFrom, dateTo }) {
    const loaded = await loadInputs(dateFrom, dateTo);

    return {
      dateFrom,
      dateTo,
      rows: loaded.reconciliation,
      totals: summarizeReconciliation(loaded.reconciliation),
      warnings: loaded.warnings.filter(
        item =>
          item === "Нет локальных Performance rows за период." ||
          item === "Нет finance advertising за период."
      )
    };
  }

  return {
    aggregateByDate,
    aggregateCampaignSummary,
    buildCampaigns,
    buildDebug,
    buildReconcile,
    buildReconciliationRows,
    buildReport
  };
}

module.exports = {
  aggregateByDate,
  aggregateCampaignSummary,
  buildReconciliationRows,
  createAdsDiagnosticsService,
  getReconciliationStatus,
  summarizeReconciliation
};
