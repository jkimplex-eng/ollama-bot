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

function getRowKey(row) {
  return [row.date || "", row.sku || "", String(row.offerId || "").toLowerCase()].join("|");
}

function buildExpectedEffect(recommendation, row) {
  if (recommendation === "increase_budget") {
    return "Scale cautiously while GP, DRR and stock remain within gates.";
  }
  if (recommendation === "decrease_budget") {
    return "Reduce inefficient spend and protect gross profit.";
  }
  if (recommendation === "pause") {
    return "Stop spend until profitability or revenue signal recovers.";
  }
  if (recommendation === "restock_first") {
    return "Avoid demand growth before stock constraint is resolved.";
  }
  if (recommendation === "needs_data") {
    return "Improve data quality before optimizer decisions.";
  }
  if (recommendation === "test" && row.priorityFlag) {
    return "Run controlled strategic test with explicit stop-loss.";
  }
  return "Maintain current budget and monitor next period.";
}

function recommendForRow(row, verification, options = {}) {
  const targetDrr = toNumber(options.targetDrr || 20);
  const minScaleStockDays = toNumber(options.minScaleStockDays || 14);
  const lowStockDays = toNumber(options.lowStockDays || 5);
  const adSpend = round2(row.adSpend);
  const revenue = round2(row.totalRevenue);
  const grossProfitEstimate = round2(row.grossProfitEstimate);
  const margin = round2(row.margin);
  const drr = revenue > 0 ? round2((adSpend / revenue) * 100) : 0;
  const stockDays = row.stockDays === null || row.stockDays === undefined ? null : round2(row.stockDays);
  const reasons = [];
  const gates = {
    dataQuality: verification && !verification.blockOptimization,
    stock: stockDays !== null && stockDays > lowStockDays,
    profitability: grossProfitEstimate > 0 || Boolean(row.priorityFlag),
    priority: Boolean(row.priorityFlag),
    financeReconciliation: !verification || verification.mismatchFlags.length === 0
  };
  let recommendation = "keep";
  let confidence = row.confidence || "medium";
  let stopLoss = "";

  if (verification && verification.blockOptimization) {
    recommendation = "needs_data";
    confidence = "low";
    reasons.push("verification blocks optimization");
    if (verification.mismatchFlags.length) {
      reasons.push("finance mismatch: " + verification.mismatchFlags.join(", "));
    }
    if (verification.warnings.length) {
      reasons.push("warnings: " + verification.warnings.join(", "));
    }
  } else if (stockDays !== null && stockDays <= lowStockDays) {
    recommendation = "restock_first";
    confidence = "high";
    reasons.push("stock days below safety gate");
  } else if (adSpend > 0 && revenue <= 0 && !row.priorityFlag) {
    recommendation = "pause";
    confidence = "high";
    reasons.push("spend without revenue");
  } else if (grossProfitEstimate < 0 && !row.priorityFlag) {
    recommendation = adSpend > 0 ? "pause" : "decrease_budget";
    confidence = "high";
    reasons.push("unprofitable after ads");
  } else if (row.priorityFlag && grossProfitEstimate <= 0) {
    recommendation = "test";
    confidence = "medium";
    stopLoss = "pause if GP stays negative or DRR exceeds " + targetDrr + "% in next review window";
    reasons.push("strategic priority override: yes");
    reasons.push("risk: short-term GP is weak");
  } else if (
    adSpend > 0 &&
    revenue > 0 &&
    grossProfitEstimate > 0 &&
    drr <= targetDrr &&
    stockDays !== null &&
    stockDays >= minScaleStockDays &&
    (row.confidence === "high" || row.confidence === "medium")
  ) {
    recommendation = "increase_budget";
    confidence = row.confidence;
    reasons.push("profitable with acceptable DRR and sufficient stock");
  } else if (adSpend > 0 && revenue > 0 && (grossProfitEstimate <= 0 || drr > targetDrr * 1.5)) {
    recommendation = "decrease_budget";
    confidence = "medium";
    reasons.push("efficiency below target");
  } else {
    reasons.push("no safe scaling or reduction trigger");
  }

  return {
    date: row.date,
    sku: row.sku,
    offerId: row.offerId,
    campaignId: row.campaignId || (Array.isArray(row.campaignIds) ? row.campaignIds.join(", ") : ""),
    campaignName: row.campaignName || (Array.isArray(row.campaignNames) ? row.campaignNames.join(", ") : ""),
    currentSpend: adSpend,
    revenue,
    grossProfitEstimate,
    margin,
    drr,
    acos: drr,
    stockDays,
    priorityFlag: Boolean(row.priorityFlag),
    recommendation,
    reason: reasons.join("; "),
    expectedEffect: buildExpectedEffect(recommendation, row),
    confidence,
    stopLoss,
    gates
  };
}

function summarizeRecommendations(recommendations) {
  return recommendations.reduce(
    (acc, item) => {
      acc.total += 1;
      acc.byRecommendation[item.recommendation] = (acc.byRecommendation[item.recommendation] || 0) + 1;
      if (item.confidence === "low") {
        acc.lowConfidence += 1;
      }
      return acc;
    },
    {
      total: 0,
      byRecommendation: {},
      lowConfidence: 0
    }
  );
}

function getMonthRange(month) {
  const normalized = String(month || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error("Month must use YYYY-MM format.");
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));

  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10)
  };
}

function getRecommendedSpendDelta(item) {
  const spend = toNumber(item.currentSpend);
  if (item.recommendation === "increase_budget") {
    return round2(spend * 0.2);
  }
  if (item.recommendation === "decrease_budget") {
    return round2(spend * -0.2);
  }
  if (item.recommendation === "pause") {
    return round2(spend * -1);
  }
  return 0;
}

function buildBudgetPlanFromRecommendations(report, month) {
  const items = (report.recommendations || []).map(item => {
    const recommendedSpendDelta = getRecommendedSpendDelta(item);
    return {
      ...item,
      recommendedSpendDelta,
      plannedSpend: round2(toNumber(item.currentSpend) + recommendedSpendDelta)
    };
  });
  const summary = items.reduce(
    (acc, item) => {
      acc.currentSpend += toNumber(item.currentSpend);
      acc.recommendedSpendDelta += toNumber(item.recommendedSpendDelta);
      acc.plannedSpend += toNumber(item.plannedSpend);
      acc.byRecommendation[item.recommendation] = (acc.byRecommendation[item.recommendation] || 0) + 1;
      if (item.recommendation === "increase_budget") {
        acc.scaleCandidates += 1;
      }
      if (item.recommendation === "decrease_budget" || item.recommendation === "pause") {
        acc.reduceCandidates += 1;
      }
      if (item.recommendation === "restock_first") {
        acc.restockFirst += 1;
      }
      if (item.recommendation === "needs_data") {
        acc.needsData += 1;
      }
      return acc;
    },
    {
      currentSpend: 0,
      recommendedSpendDelta: 0,
      plannedSpend: 0,
      byRecommendation: {},
      scaleCandidates: 0,
      reduceCandidates: 0,
      restockFirst: 0,
      needsData: 0
    }
  );

  return {
    month,
    dateFrom: report.dateFrom,
    dateTo: report.dateTo,
    mode: "recommendation_only",
    items,
    skuDayVerification: report.skuDayVerification,
    summary: {
      ...summary,
      currentSpend: round2(summary.currentSpend),
      recommendedSpendDelta: round2(summary.recommendedSpendDelta),
      plannedSpend: round2(summary.plannedSpend)
    }
  };
}

function buildOptimizerAuditFromRecommendations(report) {
  const recommendations = report.recommendations || [];
  const blockedByReason = {};
  const gateFailures = {
    dataQuality: 0,
    stock: 0,
    profitability: 0,
    financeReconciliation: 0
  };
  const summary = recommendations.reduce(
    (acc, item) => {
      if (item.recommendation === "increase_budget") {
        acc.readyToScale += 1;
      }
      if (item.recommendation === "needs_data") {
        acc.blockedForData += 1;
      }
      if (item.recommendation === "restock_first") {
        acc.blockedForStock += 1;
      }
      if (item.recommendation === "pause" || item.recommendation === "decrease_budget") {
        acc.profitProtection += 1;
      }
      for (const [gate, passed] of Object.entries(item.gates || {})) {
        if (passed === false && gateFailures[gate] !== undefined) {
          gateFailures[gate] += 1;
        }
      }
      if (item.reason) {
        blockedByReason[item.reason] = (blockedByReason[item.reason] || 0) + 1;
      }
      return acc;
    },
    {
      rowsChecked: recommendations.length,
      readyToScale: 0,
      blockedForData: 0,
      blockedForStock: 0,
      profitProtection: 0
    }
  );

  return {
    dateFrom: report.dateFrom,
    dateTo: report.dateTo,
    mode: "recommendation_only",
    summary,
    gateFailures,
    blockedByReason,
    skuDayVerification: report.skuDayVerification
  };
}

function buildBudgetPlanSheetRows(plan) {
  return (plan.items || []).map(item => [
    plan.month,
    plan.dateFrom,
    plan.dateTo,
    item.offerId || "",
    item.sku || "",
    item.campaignId || "",
    item.campaignName || "",
    item.currentSpend,
    item.recommendedSpendDelta,
    item.plannedSpend,
    item.revenue,
    item.grossProfitEstimate,
    item.margin,
    item.drr,
    item.stockDays === null || item.stockDays === undefined ? "" : item.stockDays,
    item.priorityFlag ? "yes" : "no",
    item.recommendation,
    item.reason,
    item.expectedEffect,
    item.confidence,
    item.stopLoss || ""
  ]);
}

function buildRecommendationsFromSkuDay(skuDayResult, options = {}) {
  const verificationByKey = new Map(
    (skuDayResult.verification?.rows || []).map(item => [getRowKey(item), item])
  );
  const recommendations = (skuDayResult.rows || []).map(row =>
    recommendForRow(row, verificationByKey.get(getRowKey(row)) || null, options)
  );

  return {
    dateFrom: skuDayResult.dateFrom,
    dateTo: skuDayResult.dateTo,
    recommendations,
    skuDayVerification: skuDayResult.verification,
    summary: summarizeRecommendations(recommendations),
    mode: "recommendation_only"
  };
}

function createAdsOptimizerService({ sheetsService, skuDayService, options = {} }) {
  async function buildRecommendations({ dateFrom, dateTo }) {
    const skuDayResult = await skuDayService.buildRows({ dateFrom, dateTo });
    return buildRecommendationsFromSkuDay(skuDayResult, options);
  }

  async function buildSkuDecision({ offerId, dateFrom, dateTo }) {
    const report = await buildRecommendations({ dateFrom, dateTo });
    const offerIdKey = String(offerId || "").trim().toLowerCase();
    const recommendations = report.recommendations.filter(item =>
      String(item.offerId || "").trim().toLowerCase() === offerIdKey
    );

    return {
      ...report,
      offerId,
      recommendations,
      summary: summarizeRecommendations(recommendations)
    };
  }

  async function buildBudgetPlan({ month }) {
    const range = getMonthRange(month);
    const report = await buildRecommendations(range);
    return buildBudgetPlanFromRecommendations(report, month);
  }

  async function buildAudit({ dateFrom, dateTo }) {
    const report = await buildRecommendations({ dateFrom, dateTo });
    return buildOptimizerAuditFromRecommendations(report);
  }

  async function exportBudgetPlan({ month }) {
    if (!sheetsService || typeof sheetsService.clearAndWriteMappedRows !== "function") {
      throw new Error("Sheets service is not configured.");
    }
    const plan = await buildBudgetPlan({ month });
    const rows = buildBudgetPlanSheetRows(plan);
    const writeResult = await sheetsService.clearAndWriteMappedRows("ads_budget_plan", rows);
    return {
      plan,
      writeResult
    };
  }

  return {
    buildAudit,
    buildBudgetPlan,
    buildRecommendations,
    buildSkuDecision,
    exportBudgetPlan
  };
}

module.exports = {
  buildBudgetPlanFromRecommendations,
  buildBudgetPlanSheetRows,
  buildOptimizerAuditFromRecommendations,
  buildRecommendationsFromSkuDay,
  createAdsOptimizerService,
  getMonthRange,
  recommendForRow,
  summarizeRecommendations
};
