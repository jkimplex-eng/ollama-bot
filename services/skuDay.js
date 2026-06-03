const { calculateDaysOfStock } = require("./replenishment");
const { buildReconciliationRows } = require("./verification/reconciliationVerification");
const { verifySkuDayRows } = require("./verification/skuDayVerification");

function formatDate(value) {
  const normalized = String(value || "").trim();
  const ruMatch = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ruMatch) {
    return ruMatch[3] + "-" + ruMatch[2] + "-" + ruMatch[1];
  }
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3];
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

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

function normalizeOfferIdKey(value) {
  return String(value || "").trim().toLowerCase();
}

function buildRowKey(date, sku, offerId) {
  return [formatDate(date), String(sku || "").trim(), normalizeOfferIdKey(offerId)].join("|");
}

function addUnique(list, value) {
  const normalized = String(value || "").trim();
  if (normalized && !list.includes(normalized)) {
    list.push(normalized);
  }
}

function createEmptyRow(date, sku, offerId, productName = "") {
  return {
    date: formatDate(date),
    sku: String(sku || "").trim(),
    offerId: String(offerId || "").trim(),
    productName: String(productName || "").trim(),
    campaignId: "",
    campaignName: "",
    campaignIds: [],
    campaignNames: [],
    adSpend: 0,
    adOrders: 0,
    adRevenue: 0,
    organicOrders: 0,
    organicRevenue: 0,
    totalOrders: 0,
    totalRevenue: 0,
    financeAdvertising: 0,
    spendMismatch: 0,
    spendMismatchStatus: "OK",
    cogs: 0,
    cogsTotal: 0,
    logisticsToMp: 0,
    grossProfitEstimate: 0,
    margin: 0,
    stock: null,
    stockDays: null,
    priorityFlag: false,
    warnings: []
  };
}

function getConfidenceLevel({ hasAds, hasSales, hasCogs, hasStock, reconciliationStatus }) {
  if (reconciliationStatus && reconciliationStatus !== "OK") {
    return "low";
  }
  if (hasAds && hasSales && hasCogs && hasStock) {
    return "high";
  }
  if ((hasAds || hasSales) && hasCogs) {
    return "medium";
  }
  return "low";
}

function createSkuDayService({
  cogsService,
  financeFactsService,
  ozonService,
  performanceService,
  prioritySkusService,
  salesFactsService
}) {
  async function buildRows({ dateFrom, dateTo }) {
    const dates = listDates(dateFrom, dateTo);
    const daysCount = Math.max(1, dates.length);
    const [performanceRows, salesRows, financeRows, stocks] = await Promise.all([
      Promise.resolve(performanceService ? performanceService.getStoredRowsForDateRange(dateFrom, dateTo) : []),
      Promise.resolve(salesFactsService ? salesFactsService.getSalesRowsForDateRange(dateFrom, dateTo) : []),
      Promise.resolve(financeFactsService ? financeFactsService.getFinanceRowsForDateRange(dateFrom, dateTo) : []),
      ozonService && typeof ozonService.getStocks === "function"
        ? Promise.resolve(ozonService.getStocks(1000)).catch(() => [])
        : Promise.resolve([])
    ]);

    const rowsByKey = new Map();
    const salesRevenueByDate = new Map(dates.map(date => [date, 0]));
    const adSpendByDate = new Map(dates.map(date => [date, 0]));
    const stockBySku = new Map();
    const stockByOfferId = new Map();

    for (const stock of stocks) {
      if (stock.sku) {
        stockBySku.set(String(stock.sku).trim(), stock);
      }
      if (stock.offerId) {
        stockByOfferId.set(normalizeOfferIdKey(stock.offerId), stock);
      }
    }

    for (const row of performanceRows) {
      const key = buildRowKey(row.date, row.sku, row.offerId);
      const current =
        rowsByKey.get(key) || createEmptyRow(row.date, row.sku, row.offerId, row.productName);
      current.productName = current.productName || String(row.productName || "").trim();
      addUnique(current.campaignIds, row.campaignId);
      addUnique(current.campaignNames, row.campaignName);
      current.campaignId = current.campaignIds.length === 1 ? current.campaignIds[0] : "";
      current.campaignName = current.campaignNames.length === 1 ? current.campaignNames[0] : "";
      current.adSpend += toNumber(row.spend);
      current.adOrders += toNumber(row.orders);
      current.adRevenue += toNumber(row.revenue);
      rowsByKey.set(key, current);

      const date = formatDate(row.date);
      if (adSpendByDate.has(date)) {
        adSpendByDate.set(date, adSpendByDate.get(date) + toNumber(row.spend));
      }
    }

    for (const row of salesRows) {
      const key = buildRowKey(row.date, row.sku, row.offerId);
      const current =
        rowsByKey.get(key) || createEmptyRow(row.date, row.sku, row.offerId, row.productName);
      const quantity = toNumber(row.quantity);
      const revenue = toNumber(row.revenue);
      current.productName = current.productName || String(row.productName || "").trim();
      current.totalOrders += quantity;
      current.totalRevenue += revenue;
      rowsByKey.set(key, current);

      const date = formatDate(row.date);
      if (salesRevenueByDate.has(date)) {
        salesRevenueByDate.set(date, salesRevenueByDate.get(date) + revenue);
      }
    }

    const reconciliationRows = buildReconciliationRows({
      dateFrom,
      dateTo,
      performanceRows,
      financeRows
    });
    const reconciliationByDate = new Map(reconciliationRows.map(row => [row.date, row]));
    const financeByDate = new Map(financeRows.map(row => [formatDate(row.date), row]));

    const finalRows = Array.from(rowsByKey.values())
      .map(row => {
        const date = formatDate(row.date);
        const finance = financeByDate.get(date) || null;
        const reconciliation = reconciliationByDate.get(date) || null;
        const dailyAdSpend = adSpendByDate.get(date) || 0;
        const dailySalesRevenue = salesRevenueByDate.get(date) || 0;
        const spendShare = dailyAdSpend > 0 ? toNumber(row.adSpend) / dailyAdSpend : 0;
        const revenueShare = dailySalesRevenue > 0 ? toNumber(row.totalRevenue) / dailySalesRevenue : 0;
        const financeShare = spendShare > 0 ? spendShare : revenueShare;
        const stockEntry =
          stockBySku.get(row.sku) ||
          stockByOfferId.get(normalizeOfferIdKey(row.offerId)) ||
          null;
        const cogsEntry =
          cogsService && typeof cogsService.resolveCogs === "function"
            ? cogsService.resolveCogs(row.sku, row.offerId)
            : null;
        const cogs = cogsEntry ? toNumber(cogsEntry.match.cogs) : 0;
        const logisticsToMp = cogsEntry ? toNumber(cogsEntry.match.logisticsToMp) : 0;
        const stock = stockEntry ? toNumber(stockEntry.stock) : null;
        const totalOrders = row.totalOrders || row.adOrders;
        const totalRevenue = row.totalRevenue || row.adRevenue;
        const organicOrders = Math.max(0, round2(totalOrders - row.adOrders));
        const organicRevenue = Math.max(0, round2(totalRevenue - row.adRevenue));
        const financeAdvertising = finance ? round2(Math.abs(toNumber(finance.advertising)) * financeShare) : 0;
        const financeReturns = finance ? toNumber(finance.returns) * revenueShare : 0;
        const financeCommission = finance ? toNumber(finance.ozonCommission) * revenueShare : 0;
        const financeLogistics = finance ? toNumber(finance.logistics) * revenueShare : 0;
        const financePartner = finance ? toNumber(finance.partnerServices) * revenueShare : 0;
        const financeFbo = finance ? toNumber(finance.fboServices) * revenueShare : 0;
        const financeOther = finance ? toNumber(finance.otherServices) * revenueShare : 0;
        const cogsTotal = round2(cogs * totalOrders);
        const grossProfitEstimate = round2(
          totalRevenue +
            financeReturns +
            financeCommission -
            financeAdvertising +
            financeLogistics +
            financePartner +
            financeFbo +
            financeOther -
            cogsTotal
        );
        const margin = totalRevenue ? round2((grossProfitEstimate / totalRevenue) * 100) : 0;
        const stockDays = stock === null ? null : calculateDaysOfStock(stock, totalOrders / daysCount);
        const priorityMatch =
          prioritySkusService && row.offerId
            ? prioritySkusService.find(date.slice(0, 7), row.offerId)
            : null;
        const spendMismatch = reconciliation ? round2(toNumber(reconciliation.difference) * financeShare) : 0;
        const warnings = [];

        if (!row.adSpend && !row.totalRevenue) {
          warnings.push("no ads or sales data");
        }
        if (!cogsEntry) {
          warnings.push("COGS unknown");
        }
        if (!stockEntry) {
          warnings.push("stock unknown");
        }
        if (reconciliation && reconciliation.status !== "OK" && row.adSpend > 0) {
          warnings.push("ads reconciliation " + reconciliation.status);
        }
        if (!finance) {
          warnings.push("finance facts unavailable");
        }

        return {
          date,
          sku: row.sku,
          offerId: row.offerId,
          productName: row.productName || (stockEntry ? stockEntry.name : ""),
          campaignId: row.campaignId,
          campaignName: row.campaignName,
          campaignIds: row.campaignIds,
          campaignNames: row.campaignNames,
          adSpend: round2(row.adSpend),
          adOrders: round2(row.adOrders),
          adRevenue: round2(row.adRevenue),
          organicOrders,
          organicRevenue: round2(organicRevenue),
          totalOrders: round2(totalOrders),
          totalRevenue: round2(totalRevenue),
          financeAdvertising,
          spendMismatch,
          spendMismatchStatus: reconciliation ? reconciliation.status : "OK",
          cogs,
          cogsTotal,
          logisticsToMp,
          grossProfitEstimate,
          margin,
          stock,
          stockDays: stockDays === null ? null : round2(stockDays),
          priorityFlag: Boolean(priorityMatch),
          confidence: getConfidenceLevel({
            hasAds: row.adSpend > 0,
            hasSales: totalRevenue > 0,
            hasCogs: Boolean(cogsEntry),
            hasStock: stock !== null,
            reconciliationStatus: reconciliation ? reconciliation.status : "OK"
          }),
          warnings
        };
      })
      .sort((left, right) => {
        if (left.date !== right.date) {
          return left.date.localeCompare(right.date);
        }
        return right.totalRevenue - left.totalRevenue;
      });

    const verification = verifySkuDayRows(finalRows);

    return {
      dateFrom,
      dateTo,
      rows: finalRows,
      reconciliationRows,
      verification
    };
  }

  return {
    buildRows
  };
}

module.exports = {
  createSkuDayService
};
