const DAILY_CONTROL_HEADERS = [
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

function resolveControlDate(input) {
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

function getMonthStart(date) {
  return date.slice(0, 8) + "01";
}

function getDaysInMonth(date) {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getDayOfMonth(date) {
  return Number(date.slice(8, 10));
}

function getRussianWeekday(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TIMEZONE,
    weekday: "short"
  }).format(new Date(date + "T00:00:00+03:00"));
}

function indexByDate(rows, aggregator) {
  const map = new Map();
  for (const row of rows) {
    const date = formatDate(row.date);
    const current = map.get(date) || aggregator();
    map.set(date, current);
    row.__date = date;
  }
  return map;
}

function aggregateSalesByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    const date = formatDate(row.date);
    const current = map.get(date) || { orderedRevenue: 0, orderedQuantity: 0, ordersCount: 0 };
    current.orderedRevenue += toNumber(row.revenue);
    current.orderedQuantity += toNumber(row.quantity);
    current.ordersCount += toNumber(row.quantity);
    map.set(date, current);
  }
  return map;
}

function aggregatePerformanceByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    const date = formatDate(row.date);
    const current = map.get(date) || { spend: 0 };
    current.spend += toNumber(row.spend || row.adSpend || row.cost || 0);
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
      accruedTotal: 0
    };
    current.sales += toNumber(row.sales);
    current.returns += toNumber(row.returns);
    current.ozonCommission += toNumber(row.ozonCommission);
    current.logistics += toNumber(row.logistics);
    current.partnerServices += toNumber(row.partnerServices);
    current.fboServices += toNumber(row.fboServices);
    current.advertising += toNumber(row.advertising);
    current.accruedTotal += toNumber(row.accruedTotal);
    map.set(date, current);
  }
  return map;
}

function buildDayMetrics({ date, salesRows, financeRows, performanceRows, planVpPerDay = 0 }) {
  const orderedRevenue = round2(salesRows.orderedRevenue);
  const orderedQuantity = round2(salesRows.orderedQuantity);
  const sales = round2(financeRows.sales);
  const returns = round2(financeRows.returns);
  const ads = financeRows.hasFinance ? round2(financeRows.advertising) : round2(performanceRows.spend);
  const cogsTotal = round2(salesRows.cogsTotal);
  const logisticsToMp = round2(salesRows.logisticsToMpTotal);
  const grossProfit = round2(
    sales +
      returns +
      toNumber(ads) +
      toNumber(financeRows.ozonCommission) +
      toNumber(financeRows.logistics) +
      toNumber(financeRows.partnerServices) +
      toNumber(financeRows.fboServices) -
      cogsTotal
  );
  const margin = sales ? round2((grossProfit / sales) * 100) : 0;
  const plan = round2(planVpPerDay);
  const deviation = round2(grossProfit - plan);
  const status = !salesRows.hasSales || !financeRows.hasFinance
    ? "NO DATA"
    : grossProfit >= plan
      ? "OK"
      : "BELOW PLAN";

  const comments = [];
  if (!salesRows.hasSales) {
    comments.push("Нет sales facts.");
  }
  if (!financeRows.hasFinance) {
    comments.push("Нет finance facts.");
  }
  if (status === "OK" && salesRows.hasSales && financeRows.hasFinance) {
    comments.push("План выполнен.");
  }
  if (status === "BELOW PLAN") {
    comments.push("Ниже дневного плана.");
  }

  return {
    date,
    day: getRussianWeekday(date),
    orderedRevenue,
    orderedQuantity,
    sales,
    returns,
    ads,
    cogsTotal,
    logisticsToMp,
    grossProfit,
    margin,
    plan,
    deviation,
    accruedTotal: round2(financeRows.accruedTotal),
    status,
    comment: comments.join(" ").trim()
  };
}

function buildControlRow(metrics, cumulativeGrossProfit) {
  const dayOfMonth = getDayOfMonth(metrics.date);
  const daysInMonth = getDaysInMonth(metrics.date);
  const runRate = dayOfMonth > 0 ? round2((cumulativeGrossProfit / dayOfMonth) * daysInMonth) : 0;

  return [
    metrics.date,
    metrics.day,
    metrics.orderedRevenue,
    metrics.sales,
    metrics.ads,
    metrics.cogsTotal,
    metrics.logisticsToMp,
    metrics.grossProfit,
    metrics.margin,
    metrics.plan,
    metrics.deviation,
    round2(cumulativeGrossProfit),
    runRate,
    metrics.status,
    metrics.comment
  ];
}

function formatDailyControlSummary(result) {
  return [
    "Daily Control " + result.date,
    "Заказы: " + result.metrics.orderedRevenue,
    "Продажи: " + result.metrics.sales,
    "Реклама: " + result.metrics.ads,
    "Себестоимость: " + result.metrics.cogsTotal,
    "ВП: " + result.metrics.grossProfit,
    "План: " + result.metrics.plan,
    "Отклонение: " + result.metrics.deviation,
    "Run-rate: " + result.row[12],
    "Статус: " + result.metrics.status,
    result.warning || result.metrics.comment || ""
  ]
    .filter(Boolean)
    .join("\n");
}

function createDailyControlService({
  cogsService,
  financeFactsService,
  performanceService,
  salesFactsService,
  sheetsService,
  planVpPerDay = 0
}) {
  async function buildDailyControl(dateInput) {
    const date = resolveControlDate(dateInput);
    const monthStart = getMonthStart(date);
    const salesRowsRaw = salesFactsService ? salesFactsService.getSalesRowsForDateRange(monthStart, date) : [];
    const salesRows = cogsService ? cogsService.mergeCogsIntoPerformanceRows(salesRowsRaw).rows : salesRowsRaw;
    const financeRows = financeFactsService ? financeFactsService.getFinanceRowsForDateRange(monthStart, date) : [];
    const performanceRows = await performanceService.getStoredRowsForDateRange(monthStart, date);

    const salesByDate = aggregateSalesByDate(
      salesRows.map(row => ({
        ...row,
        cogsTotal: toNumber(row.cogs) * toNumber(row.quantity),
        logisticsToMpTotal: toNumber(row.logisticsToMp) * toNumber(row.quantity)
      }))
    );
    const performanceByDate = aggregatePerformanceByDate(performanceRows);
    const financeByDate = aggregateFinanceByDate(financeRows);

    const allDates = new Set([
      ...salesByDate.keys(),
      ...financeByDate.keys(),
      ...performanceByDate.keys()
    ]);
    allDates.add(date);

    const orderedDates = Array.from(allDates).sort();
    let cumulativeGrossProfit = 0;
    let targetMetrics = null;

    for (const currentDate of orderedDates) {
      const salesFacts = salesByDate.get(currentDate) || { orderedRevenue: 0, orderedQuantity: 0, ordersCount: 0 };
      const salesRowsFacts = salesRows
        .filter(row => formatDate(row.date) === currentDate);
      const cogsTotal = round2(
        salesRowsFacts.reduce((sum, row) => sum + toNumber(row.cogs) * toNumber(row.quantity), 0)
      );
      const logisticsToMpTotal = round2(
        salesRowsFacts.reduce((sum, row) => sum + toNumber(row.logisticsToMp) * toNumber(row.quantity), 0)
      );
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

      const metrics = buildDayMetrics({
        date: currentDate,
        salesRows: {
          orderedRevenue: salesFacts.orderedRevenue,
          orderedQuantity: salesFacts.orderedQuantity,
          cogsTotal,
          logisticsToMpTotal,
          hasSales: salesRowsFacts.length > 0
        },
        financeRows: {
          ...financeFacts,
          hasFinance: financeByDate.has(currentDate)
        },
        performanceRows: performanceFacts,
        planVpPerDay
      });

      cumulativeGrossProfit = round2(cumulativeGrossProfit + metrics.grossProfit);
      if (currentDate === date) {
        targetMetrics = metrics;
      }
    }

    const metrics = targetMetrics || buildDayMetrics({
      date,
      salesRows: { orderedRevenue: 0, orderedQuantity: 0, cogsTotal: 0, logisticsToMpTotal: 0, hasSales: false },
      financeRows: { sales: 0, returns: 0, ozonCommission: 0, logistics: 0, partnerServices: 0, fboServices: 0, advertising: 0, accruedTotal: 0, hasFinance: false },
      performanceRows: { spend: 0 },
      planVpPerDay
    });

    const row = buildControlRow(metrics, cumulativeGrossProfit);
    const warning = !financeByDate.has(date) || !salesByDate.has(date)
      ? "Нет sales facts или finance facts за дату. Часть значений неполная."
      : "";

    return {
      date,
      headers: DAILY_CONTROL_HEADERS,
      row,
      metrics,
      warning,
      summaryText: formatDailyControlSummary({
        date,
        row,
        metrics,
        warning
      })
    };
  }

  async function exportDailyControl(dateInput) {
    const result = await buildDailyControl(dateInput);
    const writeResult = await sheetsService.updateMappedRowByDate("daily_control", result.date, result.row, {
      headers: DAILY_CONTROL_HEADERS,
      dateColumn: "Дата"
    });
    return {
      ...result,
      writeResult
    };
  }

  return {
    buildDailyControl,
    exportDailyControl,
    formatDailyControlSummary,
    resolveControlDate
  };
}

module.exports = {
  DAILY_CONTROL_HEADERS,
  buildControlRow,
  buildDayMetrics,
  createDailyControlService,
  formatDailyControlSummary,
  resolveControlDate
};
