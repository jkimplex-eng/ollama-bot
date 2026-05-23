const DAILY_INPUT_HEADERS = [
  "Дата",
  "День",
  "Заказы ₽",
  "Продажи ₽",
  "Реклама ₽",
  "Себестоимость ₽",
  "Доставка до МП ₽",
  "ВП ₽",
  "Маржа ВП %",
  "План ВП/день",
  "Отклонение ₽",
  "Накоп. ВП ₽",
  "Run-rate прогноз ₽",
  "Статус",
  "Комментарий"
];

const MOSCOW_TIMEZONE = "Europe/Moscow";
const MANAGEMENT_TEMPLATE_ONLY_MESSAGE =
  "Этот лист считается формулами в шаблоне. Бот заполняет только Daily Input.";

function formatMoscowDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

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

function resolveDateInput(input) {
  const normalized = String(input || "").trim().toLowerCase();
  if (!normalized || normalized === "today" || normalized === "сегодня") {
    return formatMoscowDate(new Date());
  }
  if (normalized === "yesterday" || normalized === "вчера") {
    const today = new Date(formatMoscowDate(new Date()) + "T00:00:00+03:00");
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    return yesterday.toISOString().slice(0, 10);
  }
  return formatDate(normalized);
}

function getDayOfMonth(date) {
  return Number(formatDate(date).slice(8, 10));
}

function getDaysInMonth(dateOrMonth) {
  const month = String(dateOrMonth).length === 7 ? dateOrMonth : formatDate(dateOrMonth).slice(0, 7);
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

function getRussianWeekday(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TIMEZONE,
    weekday: "short"
  }).format(new Date(formatDate(date) + "T00:00:00+03:00"));
}

function aggregateSalesByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    const date = formatDate(row.date);
    const current = map.get(date) || { orderedRevenue: 0, orderedQuantity: 0, ordersCount: 0, rows: [] };
    current.orderedRevenue += toNumber(row.revenue);
    current.orderedQuantity += toNumber(row.quantity);
    current.ordersCount += toNumber(row.quantity);
    current.rows.push(row);
    map.set(date, current);
  }
  return map;
}

function aggregateFinanceByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    const date = formatDate(row.date);
    const current = map.get(date) || {
      sales: 0,
      returns: 0,
      ozonCommission: 0,
      logistics: 0,
      partnerServices: 0,
      fboServices: 0,
      advertising: 0,
      otherServices: 0,
      accruedTotal: 0
    };
    current.sales += toNumber(row.sales);
    current.returns += toNumber(row.returns);
    current.ozonCommission += toNumber(row.ozonCommission);
    current.logistics += toNumber(row.logistics);
    current.partnerServices += toNumber(row.partnerServices);
    current.fboServices += toNumber(row.fboServices);
    current.advertising += toNumber(row.advertising);
    current.otherServices += toNumber(row.otherServices);
    current.accruedTotal += toNumber(row.accruedTotal);
    map.set(date, current);
  }
  return map;
}

function aggregatePerformanceByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    const date = formatDate(row.date);
    const current = map.get(date) || { spend: 0, impressions: 0, clicks: 0, addToCart: 0 };
    current.spend += toNumber(row.spend || row.adSpend || row.cost);
    current.impressions += toNumber(row.impressions);
    current.clicks += toNumber(row.clicks);
    current.addToCart += toNumber(row.addToCart);
    map.set(date, current);
  }
  return map;
}


function calculateGrossProfit({ sales, returns, advertising, ozonCommission, logistics, partnerServices, fboServices, cogs }) {
  return round2(
    toNumber(sales) +
      toNumber(returns) +
      toNumber(advertising) +
      toNumber(ozonCommission) +
      toNumber(logistics) +
      toNumber(partnerServices) +
      toNumber(fboServices) -
      toNumber(cogs)
  );
}

function buildMetricForDate({
  date,
  salesFacts,
  financeFacts,
  performanceFacts,
  planVpPerDay
}) {
  const orderedRevenue = round2(salesFacts.orderedRevenue);
  const quantity = round2(salesFacts.orderedQuantity);
  const sales = round2(financeFacts.sales);
  const returns = round2(financeFacts.returns);
  const advertising = financeFacts.hasFinance
    ? round2(financeFacts.advertising)
    : round2(performanceFacts.spend);
  const cogsTotal = round2(salesFacts.cogsTotal);
  const logisticsToMp = round2(salesFacts.logisticsToMpTotal);
  const grossProfit = calculateGrossProfit({
    sales,
    returns,
    advertising,
    ozonCommission: financeFacts.ozonCommission,
    logistics: financeFacts.logistics,
    partnerServices: financeFacts.partnerServices,
    fboServices: financeFacts.fboServices,
    cogs: cogsTotal
  });
  const margin = sales ? round2((grossProfit / sales) * 100) : 0;
  const plan = round2(planVpPerDay);
  const deviation = round2(grossProfit - plan);
  const hasSales = salesFacts.hasSales;
  const hasFinance = financeFacts.hasFinance;
  const status = !hasSales || !hasFinance ? "NO DATA" : grossProfit >= plan ? "OK" : "BELOW PLAN";
  const warnings = [];
  if (!hasSales) warnings.push("Нет sales facts.");
  if (!hasFinance) warnings.push("Нет finance facts.");
  return {
    date,
    day: getRussianWeekday(date),
    orderedRevenue,
    quantity,
    sales,
    returns,
    advertising,
    cogsTotal,
    logisticsToMp,
    grossProfit,
    margin,
    plan,
    deviation,
    accruedTotal: round2(financeFacts.accruedTotal),
    status,
    comment:
      warnings.join(" ").trim() ||
      (status === "OK" ? "План выполнен." : status === "BELOW PLAN" ? "Ниже дневного плана." : "")
  };
}

function getSettingsDefaults(planVpPerDay = 0) {
  return [
    ["DAILY_CONTROL_PLAN_VP", round2(planVpPerDay), "Используется как дневной план ВП по умолчанию."]
  ];
}

function createManagementWorkbookService({
  cogsService,
  financeFactsService,
  performanceService,
  salesFactsService,
  sheetsService,
  planVpPerDay = 0
}) {
  function listDates(dateFrom, dateTo) {
    const dates = [];
    const current = new Date(formatDate(dateFrom) + "T00:00:00Z");
    const end = new Date(formatDate(dateTo) + "T00:00:00Z");
    while (current <= end) {
      dates.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }

  async function loadFactsForRange(dateFrom, dateTo) {
    const salesRowsRaw = salesFactsService ? salesFactsService.getSalesRowsForDateRange(dateFrom, dateTo) : [];
    const salesMerged = cogsService ? cogsService.mergeCogsIntoPerformanceRows(salesRowsRaw) : { rows: salesRowsRaw, missingSkus: [] };
    const financeRows = financeFactsService ? financeFactsService.getFinanceRowsForDateRange(dateFrom, dateTo) : [];
    const performanceRows = performanceService ? await performanceService.getStoredRowsForDateRange(dateFrom, dateTo) : [];
    return {
      salesRows: salesMerged.rows,
      financeRows,
      performanceRows,
      missingSkus: salesMerged.missingSkus || []
    };
  }

  async function buildDailyInputRow(dateInput) {
    const date = resolveDateInput(dateInput);
    const monthStart = date.slice(0, 8) + "01";
    const { salesRows, financeRows, performanceRows, missingSkus } = await loadFactsForRange(monthStart, date);
    const salesByDate = aggregateSalesByDate(salesRows);
    const financeByDate = aggregateFinanceByDate(financeRows);
    const performanceByDate = aggregatePerformanceByDate(performanceRows);
    const dates = listDates(monthStart, date);
    let cumulativeGrossProfit = 0;
    let targetMetrics = null;

    for (const currentDate of dates) {
      const salesRowsFacts = salesRows.filter(row => formatDate(row.date) === currentDate);
      const salesFacts = salesByDate.get(currentDate) || { orderedRevenue: 0, orderedQuantity: 0, ordersCount: 0 };
      const financeFacts = financeByDate.get(currentDate) || {
        sales: 0,
        returns: 0,
        ozonCommission: 0,
        logistics: 0,
        partnerServices: 0,
        fboServices: 0,
        advertising: 0,
        accruedTotal: 0
      };
      const performanceFacts = performanceByDate.get(currentDate) || { spend: 0 };
      const metrics = buildMetricForDate({
        date: currentDate,
        salesFacts: {
          ...salesFacts,
          cogsTotal: round2(salesRowsFacts.reduce((sum, row) => sum + toNumber(row.cogs) * toNumber(row.quantity), 0)),
          logisticsToMpTotal: round2(salesRowsFacts.reduce((sum, row) => sum + toNumber(row.logisticsToMp) * toNumber(row.quantity), 0)),
          hasSales: salesRowsFacts.length > 0
        },
        financeFacts: {
          ...financeFacts,
          hasFinance: financeByDate.has(currentDate)
        },
        performanceFacts,
        planVpPerDay
      });
      cumulativeGrossProfit = round2(cumulativeGrossProfit + metrics.grossProfit);
      if (currentDate === date) {
        targetMetrics = metrics;
      }
    }

    const metrics = targetMetrics || buildMetricForDate({
      date,
      salesFacts: { orderedRevenue: 0, orderedQuantity: 0, cogsTotal: 0, logisticsToMpTotal: 0, hasSales: false },
      financeFacts: {
        sales: 0,
        returns: 0,
        ozonCommission: 0,
        logistics: 0,
        partnerServices: 0,
        fboServices: 0,
        advertising: 0,
        accruedTotal: 0,
        hasFinance: false
      },
      performanceFacts: { spend: 0 },
      planVpPerDay
    });

    const runRate = getDayOfMonth(date) > 0
      ? round2((cumulativeGrossProfit / getDayOfMonth(date)) * getDaysInMonth(date))
      : 0;

    const row = [
      metrics.date,
      metrics.day,
      metrics.orderedRevenue,
      metrics.sales,
      metrics.advertising,
      metrics.cogsTotal,
      metrics.logisticsToMp,
      metrics.grossProfit,
      metrics.margin,
      metrics.plan,
      metrics.deviation,
      cumulativeGrossProfit,
      runRate,
      metrics.status,
      metrics.comment
    ];

    const warnings = [];
    if (!salesByDate.has(date)) warnings.push("Нет sales facts за период.");
    if (!financeByDate.has(date)) warnings.push("Нет finance facts за период.");
    if (missingSkus.length) warnings.push("Себестоимость не задана для " + missingSkus.length + " SKU.");

    return {
      date,
      headers: DAILY_INPUT_HEADERS,
      row,
      metrics: {
        ...metrics,
        cumulativeGrossProfit,
        runRate
      },
      warnings
    };
  }

  function formatDailySummary(result) {
    return [
      "Management Daily " + result.date,
      "Заказы: " + result.metrics.orderedRevenue,
      "Продажи: " + result.metrics.sales,
      "Реклама: " + result.metrics.advertising,
      "Себестоимость: " + result.metrics.cogsTotal,
      "ВП: " + result.metrics.grossProfit,
      "План: " + result.metrics.plan,
      "Отклонение: " + result.metrics.deviation,
      "Run-rate: " + result.metrics.runRate,
      "Статус: " + result.metrics.status,
      ...(result.warnings || [])
    ].join("\n");
  }

  async function exportDaily(dateInput) {
    const dailyInput = await buildDailyInputRow(dateInput);
    const dailyWrite = await sheetsService.updateMappedRowByDate("daily_input", dailyInput.date, dailyInput.row, {
      headers: DAILY_INPUT_HEADERS,
      dateColumn: "Дата"
    });
    return { dailyInput, dailyWrite };
  }

  return {
    buildDailyInputRow,
    exportDaily,
    formatDailySummary,
    getSettingsDefaults: () => getSettingsDefaults(planVpPerDay),
    templateOnlyMessage: MANAGEMENT_TEMPLATE_ONLY_MESSAGE
  };
}

module.exports = {
  createManagementWorkbookService,
  DAILY_INPUT_HEADERS,
  getSettingsDefaults,
  MANAGEMENT_TEMPLATE_ONLY_MESSAGE
};
