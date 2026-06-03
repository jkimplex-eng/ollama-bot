const okVerification = {
  status: "OK",
  missingFields: [],
  calculationErrors: [],
  mismatchFlags: [],
  warnings: [],
  confidence: "high",
  blockOptimization: false
};

const profitableScaleRow = {
  date: "2026-05-13",
  sku: "111",
  offerId: "offer-111",
  campaignId: "101",
  campaignName: "Campaign A",
  adSpend: 100,
  totalRevenue: 1000,
  grossProfitEstimate: 350,
  margin: 35,
  stockDays: 20,
  priorityFlag: false,
  confidence: "high"
};

const unprofitablePauseRow = {
  ...profitableScaleRow,
  sku: "222",
  offerId: "offer-222",
  campaignId: "202",
  campaignName: "Campaign B",
  adSpend: 70,
  totalRevenue: 0,
  grossProfitEstimate: -70,
  margin: 0,
  stockDays: 20
};

function buildOptimizerSkuDayFixture({ dateFrom = "2026-05-13", dateTo = "2026-05-13" } = {}) {
  const rows = [profitableScaleRow, unprofitablePauseRow];
  return {
    dateFrom,
    dateTo,
    rows,
    verification: {
      rows: rows.map(item => ({
        ...okVerification,
        date: item.date,
        sku: item.sku,
        offerId: item.offerId
      })),
      summary: {
        rowsChecked: rows.length,
        blockedRows: 0,
        missingFields: 0,
        calculationErrors: 0,
        mismatchFlags: 0,
        lowConfidenceRows: 0,
        warnings: []
      }
    }
  };
}

module.exports = {
  buildOptimizerSkuDayFixture,
  okVerification,
  profitableScaleRow,
  unprofitablePauseRow
};
