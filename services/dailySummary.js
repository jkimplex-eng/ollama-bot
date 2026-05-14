const fs = require("fs");
const path = require("path");

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function getYesterdayRange() {
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return {
    dateFrom: formatDate(yesterday) + "T00:00:00.000Z",
    dateTo: formatDate(yesterday) + "T23:59:59.999Z",
    label: formatDate(yesterday)
  };
}

function isSameDay(dateFrom, dateTo) {
  return formatDate(dateFrom) === formatDate(dateTo);
}

function parseDailyCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!/^\/daily(\s|$)/i.test(normalized)) return null;

  const parts = normalized.split(" ").slice(1);

  if (!parts.length) {
    return { mode: "yesterday" };
  }

  if (parts.length === 1 && /^(вчера|yesterday)$/i.test(parts[0])) {
    return { mode: "yesterday" };
  }

  if (parts.length === 1 && /^(today|сегодня)$/i.test(parts[0])) {
    return {
      mode: "single",
      dateFrom: parts[0].toLowerCase() === "today" ? formatDate(new Date()) : formatDate(new Date()),
      dateTo: parts[0].toLowerCase() === "today" ? formatDate(new Date()) : formatDate(new Date())
    };
  }

  if (parts.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
    return {
      mode: "single",
      dateFrom: parts[0],
      dateTo: parts[0]
    };
  }

  if (
    parts.length === 2 &&
    /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) &&
    /^\d{4}-\d{2}-\d{2}$/.test(parts[1])
  ) {
    return {
      mode: "range",
      dateFrom: parts[0],
      dateTo: parts[1]
    };
  }

  return null;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTransactionItem(item) {
  return {
    date: formatDate(
      item.operation_date ||
        item.transaction_date ||
        item.posting?.posting_date ||
        item.date ||
        new Date()
    ),
    sku: item.sku || item.item?.sku || item.product?.sku || item.offer_id || "",
    offerId: item.offer_id || item.item?.offer_id || "",
    operationType: String(item.operation_type || item.type || item.name || "").toLowerCase(),
    amount: toNumber(item.amount || item.accruals_for_sale || item.price || item.total || 0),
    payout: toNumber(item.sale_commission || item.payout || item.return_delivery || 0),
    quantity: toNumber(item.quantity || item.items || 0),
    raw: item
  };
}

function classifyTransaction(item) {
  const type = item.operationType;
  const amount = item.amount;

  if (type.includes("sale") || type.includes("продаж")) {
    return { bucket: "revenue", value: Math.abs(amount) };
  }

  if (type.includes("commission") || type.includes("комисс")) {
    return { bucket: "commission", value: Math.abs(amount) };
  }

  if (type.includes("delivery") || type.includes("logistic") || type.includes("логист")) {
    return { bucket: "logistics", value: Math.abs(amount) };
  }

  if (type.includes("advert") || type.includes("ad ") || type.includes("реклам")) {
    return { bucket: "adSpend", value: Math.abs(amount) };
  }

  if (type.includes("payout") || type.includes("выплат")) {
    return { bucket: "payout", value: Math.abs(amount) };
  }

  return { bucket: "other", value: amount };
}

function loadCostMap(dataDir) {
  const filePath = path.join(dataDir, "cogs.json");

  if (!fs.existsSync(filePath)) return {};

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function buildMarkdownReport(label, summary) {
  return [
    "📊 Ozon · " + label,
    "",
    "💰 Выручка: " + summary.revenue.toFixed(2),
    "🏦 Выплата Ozon: " + summary.payout.toFixed(2),
    "📦 Заказов: " + summary.orders,
    "🏭 Себестоимость: " + summary.cogs.toFixed(2),
    "📢 Реклама: " + summary.adSpend.toFixed(2),
    "📉 ДРР: " + summary.drr.toFixed(2) + "%",
    "✅ Прибыль: " + summary.netProfit.toFixed(2),
    "📈 Маржа: " + summary.margin.toFixed(2) + "%"
  ].join("\n");
}

function createDailySummaryService({
  dataDir,
  dailyReportsDir,
  dailySummaryChatId,
  ozonService,
  performanceService,
  sheetsService,
  telegramService
}) {
  function buildRange(inputDateFrom, inputDateTo) {
    if (!inputDateFrom && !inputDateTo) {
      return getYesterdayRange();
    }

    const from = inputDateFrom.length === 10 ? inputDateFrom + "T00:00:00.000Z" : inputDateFrom;
    const to = inputDateTo.length === 10 ? inputDateTo + "T23:59:59.999Z" : inputDateTo;
    const fromLabel = formatDate(inputDateFrom);
    const toLabel = formatDate(inputDateTo);

    return {
      dateFrom: from,
      dateTo: to,
      label: isSameDay(from, to) ? fromLabel : fromLabel + "_" + toLabel
    };
  }

  async function fetchAllTransactions(dateFrom, dateTo) {
    const all = [];
    let page = 1;

    while (true) {
      const result = await ozonService.getFinanceTransactions({
        dateFrom,
        dateTo,
        page,
        pageSize: 1000
      });

      const operations = result.operations || result.items || [];
      all.push(...operations);

      const hasMore =
        Boolean(result.has_next_page) ||
        Boolean(result.hasNextPage) ||
        operations.length === 1000;

      if (!hasMore || !operations.length) {
        break;
      }

      page += 1;
    }

    return all.map(normalizeTransactionItem);
  }

  function aggregateTransactions(transactions) {
    const costMap = loadCostMap(dataDir);
    const bySku = new Map();
    const byDay = new Map();
    const byStore = new Map();

    const summary = {
      revenue: 0,
      payout: 0,
      orders: 0,
      commission: 0,
      logistics: 0,
      adSpend: 0,
      cogs: 0,
      other: 0
    };

    for (const transaction of transactions) {
      const classified = classifyTransaction(transaction);
      summary[classified.bucket] += classified.value;

      if (classified.bucket === "revenue") {
        summary.orders += Math.max(1, transaction.quantity || 1);
      }

      const skuKey = transaction.sku || transaction.offerId || "unknown";
      const skuRow = bySku.get(skuKey) || {
        date: transaction.date,
        sku: skuKey,
        revenue: 0,
        payout: 0,
        orders: 0,
        commission: 0,
        logistics: 0,
        adSpend: 0,
        cogs: 0
      };

      skuRow[classified.bucket] = (skuRow[classified.bucket] || 0) + classified.value;
      if (classified.bucket === "revenue") {
        skuRow.orders += Math.max(1, transaction.quantity || 1);
      }

      const localCost = toNumber(costMap[skuKey]);
      if (classified.bucket === "revenue" && localCost > 0) {
        const cogsValue = localCost * Math.max(1, transaction.quantity || 1);
        summary.cogs += cogsValue;
        skuRow.cogs += cogsValue;
      }

      bySku.set(skuKey, skuRow);

      const dayRow = byDay.get(transaction.date) || {
        date: transaction.date,
        revenue: 0,
        payout: 0,
        orders: 0,
        commission: 0,
        logistics: 0,
        adSpend: 0,
        cogs: 0
      };
      dayRow[classified.bucket] = (dayRow[classified.bucket] || 0) + classified.value;
      if (classified.bucket === "revenue") {
        dayRow.orders += Math.max(1, transaction.quantity || 1);
      }
      byDay.set(transaction.date, dayRow);

      const storeKey = "main";
      const storeRow = byStore.get(storeKey) || {
        store: storeKey,
        revenue: 0,
        payout: 0,
        orders: 0,
        commission: 0,
        logistics: 0,
        adSpend: 0,
        cogs: 0
      };
      storeRow[classified.bucket] = (storeRow[classified.bucket] || 0) + classified.value;
      if (classified.bucket === "revenue") {
        storeRow.orders += Math.max(1, transaction.quantity || 1);
      }
      byStore.set(storeKey, storeRow);
    }

    summary.netProfit =
      summary.revenue -
      summary.commission -
      summary.logistics -
      summary.adSpend -
      summary.cogs;
    summary.margin = summary.revenue ? (summary.netProfit / summary.revenue) * 100 : 0;
    summary.drr = summary.revenue ? (summary.adSpend / summary.revenue) * 100 : 0;
    summary.payout =
      summary.payout ||
      (summary.revenue - summary.commission - summary.logistics - summary.adSpend);

    return {
      summary,
      byDay: Array.from(byDay.values()),
      bySku: Array.from(bySku.values()),
      byStore: Array.from(byStore.values())
    };
  }

  async function enrichWithPerformance(summary, dateFrom, dateTo) {
    if (!performanceService || !performanceService.isConfigured()) {
      return summary;
    }

    const stats = await performanceService.getCampaignStats().catch(() => []);
    if (!stats.length) return summary;

    const adSpend = stats.reduce((sum, row) => sum + toNumber(row.spend), 0);
    summary.summary.adSpend = Math.max(summary.summary.adSpend, adSpend);
    summary.summary.netProfit =
      summary.summary.revenue -
      summary.summary.commission -
      summary.summary.logistics -
      summary.summary.adSpend -
      summary.summary.cogs;
    summary.summary.margin = summary.summary.revenue
      ? (summary.summary.netProfit / summary.summary.revenue) * 100
      : 0;
    summary.summary.drr = summary.summary.revenue
      ? (summary.summary.adSpend / summary.summary.revenue) * 100
      : 0;

    return summary;
  }

  async function writeSheets(label, aggregated) {
    const summary = aggregated.summary;

    await sheetsService.addRow("Daily_PL", [
      label,
      summary.revenue,
      summary.payout,
      summary.orders,
      summary.commission,
      summary.logistics,
      summary.adSpend,
      summary.cogs,
      summary.netProfit,
      Number(summary.margin.toFixed(2)),
      Number(summary.drr.toFixed(2))
    ]);

    await sheetsService.addRows(
      "SKU_PL",
      aggregated.bySku.map(row => [
        row.date,
        row.sku,
        row.revenue,
        row.payout,
        row.orders,
        row.commission,
        row.logistics,
        row.adSpend,
        row.cogs,
        row.revenue - row.commission - row.logistics - row.adSpend - row.cogs
      ])
    );

    await sheetsService.addRows(
      "PL_History",
      aggregated.byDay.map(row => [
        row.date,
        row.revenue,
        row.payout,
        row.orders,
        row.commission,
        row.logistics,
        row.adSpend,
        row.cogs
      ])
    );
  }

  async function sendReport(label, reportPath, reportText) {
    if (!telegramService) {
      return { sent: false, targetChatId: null };
    }

    const chatId = dailySummaryChatId || telegramService.getPrimaryChatId();
    if (!chatId) {
      return { sent: false, targetChatId: null };
    }

    await telegramService.sendText(chatId, reportText);
    await telegramService.sendDocument(chatId, reportPath).catch(() => null);
    return { sent: true, targetChatId: chatId };
  }

  async function generateDailySummary(inputDateFrom, inputDateTo) {
    const { dateFrom, dateTo, label } = buildRange(inputDateFrom, inputDateTo);
    const transactions = await fetchAllTransactions(dateFrom, dateTo);
    const aggregated = aggregateTransactions(transactions);
    await enrichWithPerformance(aggregated, dateFrom, dateTo);

    const reportText = buildMarkdownReport(label, aggregated.summary);
    ensureDirectory(dailyReportsDir);
    const reportPath = path.join(dailyReportsDir, label + ".md");
    fs.writeFileSync(reportPath, reportText, "utf8");

    await writeSheets(label, aggregated);
    const delivery = await sendReport(label, reportPath, reportText);

    return {
      aggregated,
      dateFrom,
      dateTo,
      label,
      reportPath,
      reportText,
      sentToTelegram: delivery.sent,
      targetChatId: delivery.targetChatId
    };
  }

  return {
    generateDailySummary,
    parseDailyCommand
  };
}

module.exports = {
  createDailySummaryService,
  parseDailyCommand
};
