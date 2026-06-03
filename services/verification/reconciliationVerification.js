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

function getDifferencePercent(leftValue, rightValue) {
  const denominator = leftValue || rightValue || 0;
  return denominator ? round2((Math.abs(leftValue - rightValue) / denominator) * 100) : 0;
}

function getReconciliationStatus(adsCabinetSpend, financeAdvertisingSpend, tolerance = {}) {
  const absoluteTolerance = toNumber(tolerance.absoluteTolerance) || 10;
  const percentTolerance = toNumber(tolerance.percentTolerance) || 1;
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

  if (difference <= absoluteTolerance || differencePercent <= percentTolerance) {
    return "OK";
  }

  if (hasAds && hasFinance && financeAdvertisingSpend > adsCabinetSpend) {
    return "PARTIAL_COVERAGE";
  }

  return "WARNING";
}

function buildReconciliationWarning(status) {
  if (status === "PARTIAL_COVERAGE") {
    return "Performance covers only part of finance advertising.";
  }
  if (status === "WARNING") {
    return "Mismatch exceeds tolerance.";
  }
  if (status === "MISSING_ADS") {
    return "Ads cabinet spend missing.";
  }
  if (status === "MISSING_FINANCE") {
    return "Finance advertising missing.";
  }
  return "";
}

function buildReconciliationRows({
  dateFrom,
  dateTo,
  performanceRows,
  financeRows,
  dailyInputAdsByDate = new Map(),
  tolerance
}) {
  const dates = listDates(dateFrom, dateTo);
  const financeAdvertisingByDate = new Map(dates.map(date => [date, 0]));
  const adsCabinetByDate = new Map(dates.map(date => [date, 0]));

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
    const differencePercent = getDifferencePercent(adsCabinetSpend, financeAdvertisingSpend);
    const coveredByPerformance = round2(Math.min(adsCabinetSpend, financeAdvertisingSpend));
    const uncoveredFinanceAdvertising = round2(Math.max(0, financeAdvertisingSpend - adsCabinetSpend));
    const coveragePercent = financeAdvertisingSpend
      ? round2((coveredByPerformance / financeAdvertisingSpend) * 100)
      : adsCabinetSpend
        ? 100
        : 0;
    const status = getReconciliationStatus(adsCabinetSpend, financeAdvertisingSpend, tolerance);

    return {
      date,
      adsCabinetSpend,
      financeAdvertisingSpend,
      dailyInputAds,
      difference,
      differencePercent,
      coveredByPerformance,
      uncoveredFinanceAdvertising,
      coveragePercent,
      status,
      warning: buildReconciliationWarning(status)
    };
  });
}

function summarizeReconciliation(rows, tolerance) {
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
  const coveredByPerformance = round2(Math.min(totalAdsCabinetSpend, totalFinanceAdvertisingSpend));
  const uncoveredFinanceAdvertising = round2(Math.max(0, totalFinanceAdvertisingSpend - totalAdsCabinetSpend));
  const coveragePercent = totalFinanceAdvertisingSpend
    ? round2((coveredByPerformance / totalFinanceAdvertisingSpend) * 100)
    : totalAdsCabinetSpend
      ? 100
      : 0;

  return {
    totalAdsCabinetSpend,
    totalFinanceAdvertisingSpend,
    totalDifference,
    totalDifferencePercent: getDifferencePercent(totalAdsCabinetSpend, totalFinanceAdvertisingSpend),
    coveredByPerformance,
    uncoveredFinanceAdvertising,
    coveragePercent,
    status: getReconciliationStatus(totalAdsCabinetSpend, totalFinanceAdvertisingSpend, tolerance)
  };
}

module.exports = {
  buildReconciliationRows,
  getReconciliationStatus,
  summarizeReconciliation
};
