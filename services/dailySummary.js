const fs = require("fs");
const path = require("path");

const MOSCOW_TIMEZONE = "Europe/Moscow";
const FINANCE_RAW_SHEET = "Ozon_Finance_Raw";
const ORDERS_RAW_SHEET = "Ozon_Orders_Raw";
const DIAGNOSTICS_SHEET = "Ozon_PL_Diagnostics";

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function formatMoscowDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getYesterdayRange() {
  const now = new Date();
  const moscowToday = formatMoscowDate(now);
  const startOfMoscowToday = new Date(moscowToday + "T00:00:00+03:00");
  const yesterday = new Date(startOfMoscowToday.getTime() - 24 * 60 * 60 * 1000);
  const label = formatDate(yesterday);

  return {
    dateFrom: label + "T00:00:00+03:00",
    dateTo: label + "T23:59:59.999+03:00",
    label
  };
}

function isSameDay(dateFrom, dateTo) {
  return formatDate(dateFrom) === formatDate(dateTo);
}

function parseDailyCommand(text) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!/^\/daily(\s|$)/i.test(normalized)) return null;

  const parts = normalized.split(" ").slice(1);
  const first = (parts[0] || "").toLowerCase();

  if (first === "debug" || first === "raw") {
    if (parts.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
      return { kind: "invalid", error: "Формат: /daily debug YYYY-MM-DD или /daily raw YYYY-MM-DD" };
    }

    return {
      kind: first,
      mode: "single",
      dateFrom: parts[1],
      dateTo: parts[1]
    };
  }

  if (!parts.length) {
    return { kind: "summary", mode: "yesterday" };
  }

  if (parts.length === 1 && /^(вчера|yesterday)$/i.test(parts[0])) {
    return { kind: "summary", mode: "yesterday" };
  }

  if (parts.length === 1 && /^(today|сегодня)$/i.test(parts[0])) {
    const today = formatMoscowDate(new Date());
    return {
      kind: "summary",
      mode: "single",
      dateFrom: today,
      dateTo: today
    };
  }

  if (parts.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
    return {
      kind: "summary",
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
      kind: "summary",
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

function stringifyServiceValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    operationType: String(item.operation_type || item.type || item.name || "").trim(),
    operationTypeName: String(item.operation_type_name || item.type_name || "").trim(),
    accrualsForSale: toNumber(item.accruals_for_sale),
    saleCommission: toNumber(item.sale_commission),
    amount: toNumber(item.amount),
    deliveryCharge: toNumber(item.delivery_charge),
    returnDeliveryCharge: toNumber(item.return_delivery_charge),
    services: item.services || null,
    postingNumber: item.posting?.posting_number || item.posting_number || "",
    sku: item.sku || item.item?.sku || item.product?.sku || item.offer_id || "",
    offerId: item.offer_id || item.item?.offer_id || "",
    itemName:
      item.item?.name ||
      item.product?.name ||
      item.name ||
      item.product_name ||
      "",
    quantity: toNumber(item.quantity || item.items),
    raw: item
  };
}

function hasExplicitAdSpend(operationType, operationTypeName) {
  const haystack = (operationType + " " + operationTypeName).toLowerCase();
  return haystack.includes("advert") || haystack.includes("реклам");
}

function getPostingDate(value) {
  return formatDate(value || new Date());
}

function normalizePostingProduct(product, fallback = {}) {
  const quantity = toNumber(product.quantity || product.qty || 1) || 1;
  const price = toNumber(
    product.price ||
      product.price_with_discount ||
      product.payout ||
      product.item_price ||
      0
  );

  return {
    sku: product.sku || product.item?.sku || fallback.sku || "",
    offerId: product.offer_id || product.offerId || fallback.offerId || "",
    name: product.name || product.product_name || product.item?.name || fallback.name || "",
    quantity,
    price,
    revenue: Number((price * quantity).toFixed(2))
  };
}

function normalizePostingItem(item, scheme) {
  const products = Array.isArray(item.products)
    ? item.products.map(product => normalizePostingProduct(product))
    : [];

  return {
    scheme,
    postingNumber: item.posting_number || "",
    status: item.status || "",
    date: getPostingDate(
      item.in_process_at ||
        item.created_at ||
        item.shipment_date ||
        item.delivering_date ||
        item.analytics_data?.delivery_date_begin
    ),
    products,
    raw: item
  };
}

function loadCostMap(dataDir) {
  const filePath = path.join(dataDir, "cogs.json");

  if (!fs.existsSync(filePath)) {
    return { costMap: {}, configured: false };
  }

  try {
    return {
      costMap: JSON.parse(fs.readFileSync(filePath, "utf8")),
      configured: true
    };
  } catch {
    return { costMap: {}, configured: false };
  }
}

function buildRange(inputDateFrom, inputDateTo) {
  if (!inputDateFrom && !inputDateTo) {
    return getYesterdayRange();
  }

  const from = inputDateFrom.length === 10 ? inputDateFrom + "T00:00:00+03:00" : inputDateFrom;
  const to = inputDateTo.length === 10 ? inputDateTo + "T23:59:59.999+03:00" : inputDateTo;
  const fromLabel = formatDate(inputDateFrom);
  const toLabel = formatDate(inputDateTo);

  return {
    dateFrom: from,
    dateTo: to,
    label: isSameDay(from, to) ? fromLabel : fromLabel + "_" + toLabel
  };
}

function summarizeOperationTypes(transactions) {
  const counts = new Map();

  for (const transaction of transactions) {
    const key = [
      transaction.operationType || "-",
      transaction.operationTypeName || "-"
    ].join(" | ");
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => ({ key, count }));
}

function buildFinanceSummary(transactions) {
  const summary = {
    transactionCount: transactions.length,
    totalAmount: 0,
    payout: 0,
    commission: 0,
    logistics: 0,
    adSpendFinance: 0
  };

  for (const transaction of transactions) {
    summary.totalAmount += transaction.amount;
    summary.payout += transaction.amount;
    summary.commission += Math.abs(transaction.saleCommission);
    summary.logistics += Math.abs(transaction.deliveryCharge) + Math.abs(transaction.returnDeliveryCharge);

    if (hasExplicitAdSpend(transaction.operationType, transaction.operationTypeName)) {
      summary.adSpendFinance += Math.abs(transaction.amount);
    }
  }

  return summary;
}

function buildOrdersSummary(postings, dataDir) {
  const { costMap, configured } = loadCostMap(dataDir);
  const bySku = new Map();
  let grossRevenue = 0;
  let ordersCount = 0;
  let cogs = 0;
  let hasMissingCost = false;
  const missingCostSkus = new Set();

  for (const posting of postings) {
    ordersCount += 1;

    for (const product of posting.products) {
      grossRevenue += product.revenue;

      const skuKey = product.sku || product.offerId || "unknown";
      const skuRow = bySku.get(skuKey) || {
        date: posting.date,
        sku: skuKey,
        offerId: product.offerId || "",
        name: product.name || "",
        quantity: 0,
        revenue: 0
      };

      skuRow.quantity += product.quantity;
      skuRow.revenue += product.revenue;
      bySku.set(skuKey, skuRow);

      if (configured) {
        if (costMap[skuKey] === undefined) {
          hasMissingCost = true;
          missingCostSkus.add(skuKey);
        } else {
          cogs += toNumber(costMap[skuKey]) * product.quantity;
        }
      }
    }
  }

  return {
    ordersCount,
    grossRevenue: Number(grossRevenue.toFixed(2)),
    bySku: Array.from(bySku.values()),
    cogs: Number(cogs.toFixed(2)),
    cogsConfigured: configured,
    missingCostSkus: Array.from(missingCostSkus),
    hasMissingCost
  };
}

function computeAdvertisingSpend(performanceRows, financeSummary) {
  if (performanceRows.length) {
    return {
      source: "performance",
      value: Number(
        performanceRows
          .reduce((sum, row) => sum + toNumber(row.spend), 0)
          .toFixed(2)
      )
    };
  }

  if (financeSummary.adSpendFinance > 0) {
    return {
      source: "finance",
      value: Number(financeSummary.adSpendFinance.toFixed(2))
    };
  }

  return {
    source: "missing",
    value: null
  };
}

function buildWarnings(financeSummary, ordersSummary, advertising, diagnostics) {
  const warnings = [];

  if (ordersSummary.ordersCount === 0 && ordersSummary.grossRevenue === 0 && financeSummary.totalAmount !== 0) {
    warnings.push("⚠️ Недостаточно данных для P&L. Найдены только списания/корректировки без продаж.");
  }

  if (!ordersSummary.ordersCount) {
    warnings.push("Данные по отправлениям не найдены или ещё не готовы.");
  }

  if (!financeSummary.transactionCount) {
    warnings.push("Финансовые транзакции не найдены за выбранную дату.");
  }

  if (!ordersSummary.cogsConfigured) {
    warnings.push("COGS не настроен: добавьте data/cogs.json для расчёта прибыли.");
  } else if (ordersSummary.hasMissingCost) {
    warnings.push(
      "Для части SKU нет себестоимости: " +
        ordersSummary.missingCostSkus.slice(0, 10).join(", ")
    );
  }

  if (advertising.source === "missing") {
    warnings.push("Прямые данные рекламы не подключены или не найдены за выбранную дату.");
  }

  if (diagnostics.endpointCalls.some(call => call.status === "error")) {
    warnings.push("Часть Ozon API вызовов завершилась ошибкой. Проверьте diagnostics.");
  }

  return warnings;
}

function buildSummary(financeSummary, ordersSummary, advertising, diagnostics) {
  const warnings = buildWarnings(financeSummary, ordersSummary, advertising, diagnostics);
  const feesAvailable = financeSummary.transactionCount > 0;
  const canCalculateProfit =
    ordersSummary.grossRevenue > 0 &&
    feesAvailable &&
    ordersSummary.cogsConfigured &&
    !ordersSummary.hasMissingCost;

  const knownFees =
    financeSummary.commission +
    financeSummary.logistics +
    (advertising.value || 0);

  const netProfit = canCalculateProfit
    ? Number((ordersSummary.grossRevenue - knownFees - ordersSummary.cogs).toFixed(2))
    : null;

  const margin = netProfit !== null && ordersSummary.grossRevenue > 0
    ? Number(((netProfit / ordersSummary.grossRevenue) * 100).toFixed(2))
    : null;

  const drr = advertising.value !== null && ordersSummary.grossRevenue > 0
    ? Number(((advertising.value / ordersSummary.grossRevenue) * 100).toFixed(2))
    : null;

  return {
    revenue: ordersSummary.grossRevenue,
    payout: Number(financeSummary.payout.toFixed(2)),
    orders: ordersSummary.ordersCount,
    commission: Number(financeSummary.commission.toFixed(2)),
    logistics: Number(financeSummary.logistics.toFixed(2)),
    adSpend: advertising.value,
    adSpendSource: advertising.source,
    cogs: ordersSummary.cogsConfigured && !ordersSummary.hasMissingCost
      ? Number(ordersSummary.cogs.toFixed(2))
      : null,
    cogsConfigured: ordersSummary.cogsConfigured,
    profitCalculated: netProfit !== null,
    netProfit,
    margin,
    drr,
    financeTransactionCount: financeSummary.transactionCount,
    postingCount: ordersSummary.ordersCount,
    timezone: MOSCOW_TIMEZONE,
    warnings
  };
}

function buildMarkdownReport(label, summary, diagnostics) {
  const lines = [
    "📊 Ozon · " + label,
    "",
    "🗓 Дата: " + diagnostics.label,
    "🕒 Таймзона: " + summary.timezone,
    "🧾 Финансовых транзакций: " + summary.financeTransactionCount,
    "📮 Отправлений: " + summary.postingCount,
    "",
    "💰 Выручка: " + summary.revenue.toFixed(2),
    "🏦 Выплата Ozon: " + summary.payout.toFixed(2),
    "📦 Заказов: " + summary.orders,
    "💸 Комиссия: " + summary.commission.toFixed(2),
    "🚚 Логистика: " + summary.logistics.toFixed(2),
    "📢 Реклама: " + (summary.adSpend === null ? "нет данных" : summary.adSpend.toFixed(2) + " (" + summary.adSpendSource + ")"),
    "🏭 Себестоимость: " + (summary.cogs === null ? "не настроено" : summary.cogs.toFixed(2)),
    "📉 ДРР: " + (summary.drr === null ? "не рассчитан" : summary.drr.toFixed(2) + "%"),
    "✅ Прибыль: " + (summary.profitCalculated ? summary.netProfit.toFixed(2) : "не рассчитана"),
    "📈 Маржа: " + (summary.margin === null ? "не рассчитана" : summary.margin.toFixed(2) + "%")
  ];

  if (summary.warnings.length) {
    lines.push("", "⚠️ Warnings:");
    for (const warning of summary.warnings) {
      lines.push("- " + warning);
    }
  }

  return lines.join("\n");
}

function buildDiagnosticsText(diagnostics, rawOnly = false) {
  const lines = [
    rawOnly ? "🧪 Ozon Daily Raw" : "🧪 Ozon Daily Diagnostics",
    "",
    "Дата: " + diagnostics.label,
    "Диапазон: " + diagnostics.dateFrom + " -> " + diagnostics.dateTo,
    "Таймзона: " + MOSCOW_TIMEZONE,
    "",
    "Вызванные endpoints:"
  ];

  for (const call of diagnostics.endpointCalls) {
    lines.push(
      "- " +
        call.endpoint +
        " | " +
        call.status +
        (call.count !== null && call.count !== undefined ? " | count=" + call.count : "") +
        (call.message ? " | " + call.message : "")
    );
  }

  lines.push(
    "",
    "Финансовых транзакций: " + diagnostics.financeTransactions.length,
    "Отправлений: " + diagnostics.postings.length,
    "",
    "Operation types:"
  );

  const operationTypes = summarizeOperationTypes(diagnostics.financeTransactions);

  if (!operationTypes.length) {
    lines.push("- нет данных");
  } else {
    for (const operationType of operationTypes) {
      lines.push("- " + operationType.key + " => " + operationType.count);
    }
  }

  lines.push("", "Sample 5 raw transactions:");

  const samples = diagnostics.financeTransactions.slice(0, 5);

  if (!samples.length) {
    lines.push("- нет транзакций");
  } else {
    for (const sample of samples) {
      lines.push(
        [
          "operation_type: " + (sample.operationType || "-"),
          "operation_type_name: " + (sample.operationTypeName || "-"),
          "accruals_for_sale: " + sample.accrualsForSale,
          "sale_commission: " + sample.saleCommission,
          "amount: " + sample.amount,
          "delivery_charge: " + sample.deliveryCharge,
          "return_delivery_charge: " + sample.returnDeliveryCharge,
          "services: " + stringifyServiceValue(sample.services),
          "posting_number: " + (sample.postingNumber || "-"),
          "sku: " + (sample.sku || "-"),
          "offer_id: " + (sample.offerId || "-"),
          "item_name: " + (sample.itemName || "-")
        ].join("\n")
      );
      lines.push("");
    }
  }

  if (!rawOnly) {
    lines.push("Warnings:");
    if (!diagnostics.summary.warnings.length) {
      lines.push("- нет");
    } else {
      for (const warning of diagnostics.summary.warnings) {
        lines.push("- " + warning);
      }
    }
  }

  return lines.join("\n").trim();
}

function buildFinanceRawRows(label, transactions) {
  return [
    [
      "Дата отчёта",
      "Дата операции",
      "operation_type",
      "operation_type_name",
      "accruals_for_sale",
      "sale_commission",
      "amount",
      "delivery_charge",
      "return_delivery_charge",
      "services",
      "posting_number",
      "sku",
      "offer_id",
      "item_name"
    ],
    ...transactions.map(item => [
      label,
      item.date,
      item.operationType,
      item.operationTypeName,
      item.accrualsForSale,
      item.saleCommission,
      item.amount,
      item.deliveryCharge,
      item.returnDeliveryCharge,
      stringifyServiceValue(item.services),
      item.postingNumber,
      item.sku,
      item.offerId,
      item.itemName
    ])
  ];
}

function buildOrdersRawRows(label, postings) {
  const rows = [
    [
      "Дата отчёта",
      "Дата отправления",
      "Схема",
      "posting_number",
      "status",
      "sku",
      "offer_id",
      "item_name",
      "quantity",
      "price",
      "gross_revenue"
    ]
  ];

  for (const posting of postings) {
    if (!posting.products.length) {
      rows.push([
        label,
        posting.date,
        posting.scheme,
        posting.postingNumber,
        posting.status,
        "",
        "",
        "",
        0,
        0,
        0
      ]);
      continue;
    }

    for (const product of posting.products) {
      rows.push([
        label,
        posting.date,
        posting.scheme,
        posting.postingNumber,
        posting.status,
        product.sku,
        product.offerId,
        product.name,
        product.quantity,
        product.price,
        product.revenue
      ]);
    }
  }

  return rows;
}

function buildDiagnosticsRows(label, diagnostics) {
  return [
    [
      "Дата отчёта",
      "Дата от",
      "Дата до",
      "Таймзона",
      "finance_transactions",
      "postings",
      "revenue",
      "orders",
      "payout",
      "profit_calculated",
      "warnings"
    ],
    [
      label,
      diagnostics.dateFrom,
      diagnostics.dateTo,
      MOSCOW_TIMEZONE,
      diagnostics.financeTransactions.length,
      diagnostics.postings.length,
      diagnostics.summary.revenue,
      diagnostics.summary.orders,
      diagnostics.summary.payout,
      diagnostics.summary.profitCalculated ? "yes" : "no",
      diagnostics.summary.warnings.join(" | ")
    ]
  ];
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
  async function fetchAllTransactions(dateFrom, dateTo, endpointCalls) {
    const all = [];
    let page = 1;

    while (true) {
      try {
        const result = await ozonService.getFinanceTransactions({
          dateFrom,
          dateTo,
          page,
          pageSize: 1000
        });

        const operations = result.operations || result.items || [];
        endpointCalls.push({
          endpoint: "/v3/finance/transaction/list?page=" + page,
          status: "ok",
          count: operations.length
        });
        all.push(...operations);

        const hasMore =
          Boolean(result.has_next_page) ||
          Boolean(result.hasNextPage) ||
          operations.length === 1000;

        if (!hasMore || !operations.length) {
          break;
        }

        page += 1;
      } catch (error) {
        endpointCalls.push({
          endpoint: "/v3/finance/transaction/list?page=" + page,
          status: "error",
          count: null,
          message: error.message
        });
        break;
      }
    }

    return all.map(normalizeTransactionItem);
  }

  async function fetchPostingsByScheme(fetcher, scheme, dateFrom, dateTo, endpointCalls) {
    const all = [];
    let pageToken = "";

    for (let iteration = 0; iteration < 20; iteration += 1) {
      try {
        const result = await fetcher({
          dateFrom,
          dateTo,
          lastId: pageToken,
          limit: 1000
        });

        const postings = result.postings || result.result || result.items || [];
        endpointCalls.push({
          endpoint: "/v3/posting/" + scheme + "/list" + (pageToken ? "?last_id=" + pageToken : ""),
          status: "ok",
          count: postings.length
        });
        all.push(...postings.map(item => normalizePostingItem(item, scheme.toUpperCase())));

        const nextId = result.last_id || result.lastId || "";
        const hasNext = Boolean(result.has_next || result.hasNext || nextId);

        if (!hasNext || !postings.length || nextId === pageToken) {
          break;
        }

        pageToken = nextId;
      } catch (error) {
        endpointCalls.push({
          endpoint: "/v3/posting/" + scheme + "/list",
          status: "error",
          count: null,
          message: error.message
        });
        break;
      }
    }

    return all;
  }

  async function fetchDiagnostics(inputDateFrom, inputDateTo) {
    const { dateFrom, dateTo, label } = buildRange(inputDateFrom, inputDateTo);
    const endpointCalls = [];

    const financeTransactions = await fetchAllTransactions(dateFrom, dateTo, endpointCalls);
    const fboPostings = await fetchPostingsByScheme(
      ozonService.getFboPostings,
      "fbo",
      dateFrom,
      dateTo,
      endpointCalls
    );
    const fbsPostings = await fetchPostingsByScheme(
      ozonService.getFbsPostings,
      "fbs",
      dateFrom,
      dateTo,
      endpointCalls
    );
    const postings = [...fboPostings, ...fbsPostings];

    let performanceRows = [];
    if (performanceService && performanceService.isConfigured()) {
      try {
        performanceRows = await performanceService.getCampaignStats({ dateFrom, dateTo });
        endpointCalls.push({
          endpoint: "/api/client/statistics/json",
          status: "ok",
          count: performanceRows.length
        });
      } catch (error) {
        endpointCalls.push({
          endpoint: "/api/client/statistics/json",
          status: "error",
          count: null,
          message: error.message
        });
      }
    }

    const financeSummary = buildFinanceSummary(financeTransactions);
    const ordersSummary = buildOrdersSummary(postings, dataDir);
    const advertising = computeAdvertisingSpend(performanceRows, financeSummary);
    const summary = buildSummary(financeSummary, ordersSummary, advertising, { endpointCalls });

    return {
      label,
      dateFrom,
      dateTo,
      endpointCalls,
      financeTransactions,
      postings,
      performanceRows,
      financeSummary,
      ordersSummary,
      summary
    };
  }

  async function writeSheets(label, diagnostics) {
    await sheetsService.addRow("daily_summary", [
      label,
      diagnostics.summary.revenue,
      diagnostics.summary.payout,
      diagnostics.summary.orders,
      diagnostics.summary.commission,
      diagnostics.summary.logistics,
      diagnostics.summary.adSpend === null ? "" : diagnostics.summary.adSpend,
      diagnostics.summary.cogs === null ? "" : diagnostics.summary.cogs,
      diagnostics.summary.profitCalculated ? diagnostics.summary.netProfit : "profit not calculated",
      diagnostics.summary.margin === null ? "" : diagnostics.summary.margin,
      diagnostics.summary.drr === null ? "" : diagnostics.summary.drr
    ]);

    await sheetsService.addRows(
      "daily_sku",
      diagnostics.ordersSummary.bySku.map(row => [
        row.date,
        row.sku,
        row.offerId,
        row.name,
        row.quantity,
        row.revenue
      ])
    );

    await sheetsService.addRow("daily_history", [
      label,
      diagnostics.summary.revenue,
      diagnostics.summary.payout,
      diagnostics.summary.orders,
      diagnostics.summary.financeTransactionCount,
      diagnostics.summary.postingCount,
      diagnostics.summary.profitCalculated ? diagnostics.summary.netProfit : "",
      diagnostics.summary.warnings.join(" | ")
    ]);

    await sheetsService.addRows("finance_raw", buildFinanceRawRows(label, diagnostics.financeTransactions).slice(1));
    await sheetsService.addRows("orders_raw", buildOrdersRawRows(label, diagnostics.postings).slice(1));
    await sheetsService.addRows("pl_diagnostics", buildDiagnosticsRows(label, diagnostics).slice(1));
  }

  async function sendReport(reportPath, reportText) {
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
    const diagnostics = await fetchDiagnostics(inputDateFrom, inputDateTo);
    const reportText = buildMarkdownReport(diagnostics.label, diagnostics.summary, diagnostics);
    ensureDirectory(dailyReportsDir);
    const reportPath = path.join(dailyReportsDir, diagnostics.label + ".md");
    fs.writeFileSync(reportPath, reportText, "utf8");

    await writeSheets(diagnostics.label, diagnostics);
    const delivery = await sendReport(reportPath, reportText);

    return {
      aggregated: diagnostics,
      dateFrom: diagnostics.dateFrom,
      dateTo: diagnostics.dateTo,
      label: diagnostics.label,
      reportPath,
      reportText,
      diagnostics,
      sentToTelegram: delivery.sent,
      targetChatId: delivery.targetChatId
    };
  }

  async function generateDiagnosticsReport(inputDateFrom, inputDateTo, options = {}) {
    const diagnostics = await fetchDiagnostics(inputDateFrom, inputDateTo);
    const reportText = buildDiagnosticsText(diagnostics, options.rawOnly);

    return {
      label: diagnostics.label,
      reportText,
      diagnostics
    };
  }

  return {
    generateDailySummary,
    generateDiagnosticsReport,
    parseDailyCommand
  };
}

module.exports = {
  createDailySummaryService,
  parseDailyCommand
};
