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

function verifySkuDayRow(row) {
  const missingFields = [];
  const calculationErrors = [];
  const mismatchFlags = [];
  const warnings = Array.isArray(row.warnings) ? [...row.warnings] : [];

  const requiredFields = [
    "date",
    "sku",
    "offerId",
    "productName",
    "adSpend",
    "adOrders",
    "adRevenue",
    "organicOrders",
    "organicRevenue",
    "totalOrders",
    "totalRevenue",
    "financeAdvertising",
    "spendMismatch",
    "spendMismatchStatus",
    "cogs",
    "cogsTotal",
    "logisticsToMp",
    "grossProfitEstimate",
    "margin",
    "priorityFlag",
    "confidence"
  ];

  for (const field of requiredFields) {
    if (row[field] === undefined) {
      missingFields.push(field);
    }
  }

  if (!String(row.sku || "").trim() && !String(row.offerId || "").trim()) {
    missingFields.push("sku_or_offerId");
  }

  if (!String(row.productName || "").trim()) {
    warnings.push("product name missing");
  }

  const expectedTotalRevenue = round2(toNumber(row.adRevenue) + toNumber(row.organicRevenue));
  if (round2(row.totalRevenue) !== expectedTotalRevenue) {
    calculationErrors.push("totalRevenue");
  }

  const expectedTotalOrders = round2(toNumber(row.adOrders) + toNumber(row.organicOrders));
  if (round2(row.totalOrders) !== expectedTotalOrders) {
    calculationErrors.push("totalOrders");
  }

  const expectedCogsTotal = round2(toNumber(row.cogs) * toNumber(row.totalOrders));
  if (round2(row.cogsTotal) !== expectedCogsTotal) {
    calculationErrors.push("cogsTotal");
  }

  const expectedMargin = toNumber(row.totalRevenue)
    ? round2((toNumber(row.grossProfitEstimate) / toNumber(row.totalRevenue)) * 100)
    : 0;
  if (round2(row.margin) !== expectedMargin) {
    calculationErrors.push("margin");
  }

  if (row.stock !== null && row.stock !== undefined && toNumber(row.stock) < 0) {
    calculationErrors.push("stock");
  }

  if (
    row.stockDays !== null &&
    row.stockDays !== undefined &&
    (toNumber(row.stockDays) < 0 || !Number.isFinite(toNumber(row.stockDays)))
  ) {
    calculationErrors.push("stockDays");
  }

  if (row.spendMismatchStatus && row.spendMismatchStatus !== "OK") {
    mismatchFlags.push(row.spendMismatchStatus);
  }

  const blockOptimization =
    missingFields.length > 0 ||
    calculationErrors.length > 0 ||
    mismatchFlags.length > 0 ||
    warnings.includes("COGS unknown") ||
    warnings.includes("stock unknown") ||
    warnings.includes("finance facts unavailable");

  const confidence =
    blockOptimization || row.confidence === "low"
      ? "low"
      : calculationErrors.length === 0 && mismatchFlags.length === 0
        ? row.confidence || "medium"
        : "medium";

  return {
    date: row.date,
    sku: row.sku,
    offerId: row.offerId,
    status: blockOptimization ? "BLOCKED" : "OK",
    missingFields,
    calculationErrors,
    mismatchFlags,
    warnings,
    confidence,
    blockOptimization
  };
}

function summarizeSkuDayVerification(results) {
  return results.reduce(
    (acc, item) => {
      acc.rowsChecked += 1;
      if (item.status !== "OK") {
        acc.blockedRows += 1;
      }
      acc.missingFields += item.missingFields.length;
      acc.calculationErrors += item.calculationErrors.length;
      acc.mismatchFlags += item.mismatchFlags.length;
      if (item.confidence === "low") {
        acc.lowConfidenceRows += 1;
      }
      for (const warning of item.warnings) {
        acc.warnings.add(warning);
      }
      return acc;
    },
    {
      rowsChecked: 0,
      blockedRows: 0,
      missingFields: 0,
      calculationErrors: 0,
      mismatchFlags: 0,
      lowConfidenceRows: 0,
      warnings: new Set()
    }
  );
}

function verifySkuDayRows(rows) {
  const rowsVerification = rows.map(verifySkuDayRow);
  const summary = summarizeSkuDayVerification(rowsVerification);
  return {
    rows: rowsVerification,
    summary: {
      rowsChecked: summary.rowsChecked,
      blockedRows: summary.blockedRows,
      missingFields: summary.missingFields,
      calculationErrors: summary.calculationErrors,
      mismatchFlags: summary.mismatchFlags,
      lowConfidenceRows: summary.lowConfidenceRows,
      warnings: Array.from(summary.warnings).sort()
    }
  };
}

module.exports = {
  verifySkuDayRow,
  verifySkuDayRows
};
