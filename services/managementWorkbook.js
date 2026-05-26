const DAILY_INPUT_HEADERS = [
  "Дата",
  "День",
  "Заказы ₽",
  "Продажи ₽",
  "Комиссия Ozon ₽",
  "Реклама ₽",
  "Себестоимость ₽",
  "Доставка до МП ₽",
  "Услуги партнёров ₽",
  "Услуги FBO ₽",
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
const MAX_BACKFILL_DAYS = 31;
const DAILY_INPUT_WRITE_COLUMNS = [
  "Дата",
  "День",
  "Заказы ₽",
  "Продажи ₽",
  "Комиссия Ozon ₽",
  "Реклама ₽",
  "Себестоимость ₽",
  "Доставка до МП ₽",
  "Услуги партнёров ₽",
  "Услуги FBO ₽",
  "ВП ₽",
  "Маржа ВП %",
  "Статус",
  "Комментарий"
];

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

function protectValue(val) {
  if (val === null || val === undefined || String(val).trim() === "" || String(val).trim() === "-") {
    return 0;
  }
  const cleaned = String(val).replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
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
  const advertisingRaw = financeFacts.hasFinance
    ? protectValue(financeFacts.advertising)
    : protectValue(performanceFacts.spend);
  const advertising = advertisingRaw > 0 ? -advertisingRaw : advertisingRaw;
  const cogsTotal = round2(salesFacts.cogsTotal);
  const logisticsToMp = round2(salesFacts.logisticsToMpTotal);

  const ozonCommission = round2(protectValue(financeFacts.ozonCommission));
  const logisticsActual = round2(protectValue(financeFacts.logistics));
  const partnerServices = round2(protectValue(financeFacts.partnerServices));
  const fboServices = round2(protectValue(financeFacts.fboServices));

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
  const hasPlan = toNumber(planVpPerDay) > 0;
  const plan = hasPlan ? round2(planVpPerDay) : "";
  const deviation = hasPlan ? round2(grossProfit - planVpPerDay) : "";
  const hasSales = salesFacts.hasSales;
  const hasFinance = financeFacts.hasFinance;
  const status = !hasSales || !hasFinance ? "NO DATA" : hasPlan ? (grossProfit >= planVpPerDay ? "OK" : "BELOW PLAN") : "OK";
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
    ozonCommission,
    cogsTotal,
    logisticsToMp,
    logisticsActual,
    partnerServices,
    fboServices,
    grossProfit,
    margin,
    plan,
    deviation,
    accruedTotal: round2(financeFacts.accruedTotal),
    status,
    comment:
      warnings.join(" ").trim() ||
      (!hasPlan ? "План считается формулой в шаблоне." : "") ||
      (status === "OK" ? "План выполнен." : status === "BELOW PLAN" ? "Ниже дневного плана." : "")
  };
}

function getSettingsDefaults(planVpPerDay = 0) {
  return [
    ["DAILY_CONTROL_PLAN_VP", round2(planVpPerDay), "Используется как дневной план ВП по умолчанию."]
  ];
}

function getCogsEntryForRow(cogsService, row) {
  if (!cogsService || !row) {
    return null;
  }

  const resolved = cogsService.resolveCogs(row.sku, row.offerId);
  return resolved ? resolved.match : null;
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
    const salesRows = salesMerged.rows.map(row => {
      if (row.cogsConfigured || !cogsService) {
        return row;
      }

      const cogsEntry = getCogsEntryForRow(cogsService, row);
      if (!cogsEntry) {
        return row;
      }

      return {
        ...row,
        cogs: toNumber(cogsEntry.cogs),
        logisticsToMp: toNumber(cogsEntry.logisticsToMp),
        cogsConfigured: true
      };
    });
    const financeRows = financeFactsService ? financeFactsService.getFinanceRowsForDateRange(dateFrom, dateTo) : [];
    const performanceRows = performanceService ? await performanceService.getStoredRowsForDateRange(dateFrom, dateTo) : [];
    return {
      salesRows,
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
      "",
      protectValue(metrics.orderedRevenue),
      protectValue(metrics.sales),
      Math.abs(protectValue(metrics.ozonCommission)),
      Math.abs(protectValue(metrics.advertising)),
      protectValue(metrics.cogsTotal),
      Math.abs(protectValue(metrics.logisticsActual)),
      Math.abs(protectValue(metrics.partnerServices)),
      Math.abs(protectValue(metrics.fboServices)),
      protectValue(metrics.grossProfit),
      protectValue(metrics.margin),
      metrics.plan === "" ? 0 : protectValue(metrics.plan),
      metrics.deviation === "" ? 0 : protectValue(metrics.deviation),
      protectValue(cumulativeGrossProfit),
      protectValue(runRate),
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
      "План: " + (result.metrics.plan === "" ? "по шаблону" : result.metrics.plan),
      "Отклонение: " + (result.metrics.deviation === "" ? "по шаблону" : result.metrics.deviation),
      "Run-rate: " + (result.metrics.plan === "" ? "по шаблону" : result.metrics.runRate),
      "Статус: " + result.metrics.status,
      ...(result.warnings || [])
    ].join("\n");
  }

  async function exportDaily(dateInput) {
    const dailyInput = await buildDailyInputRow(dateInput);
    const dailyWrite = await sheetsService.updateMappedRowByDate("daily_input", dailyInput.date, dailyInput.row, {
      headers: DAILY_INPUT_HEADERS,
      dateColumn: "Дата",
      writeColumns: DAILY_INPUT_WRITE_COLUMNS
    });
    return { dailyInput, dailyWrite };
  }

  async function backfillDailyInput({ dateFrom, dateTo, fetchSalesForDay, fetchFinanceForDay }) {
    const normalizedFrom = formatDate(dateFrom);
    const normalizedTo = formatDate(dateTo);
    const dates = listDates(normalizedFrom, normalizedTo);

    if (dates.length > MAX_BACKFILL_DAYS) {
      throw new Error("Backfill range is too large. Max " + MAX_BACKFILL_DAYS + " days.");
    }

    const failures = [];
    let daysUpdated = 0;

    for (const date of dates) {
      try {
        if (fetchSalesForDay) {
          const salesRows = await fetchSalesForDay(date);
          if (salesFactsService && Array.isArray(salesRows) && salesRows.length) {
            salesFactsService.saveSalesRows(salesRows, {
              dateFrom: date,
              dateTo: date,
              savedAt: new Date().toISOString(),
              source: "backfill"
            });
          }
        }

        if (fetchFinanceForDay) {
          const financeRows = await fetchFinanceForDay(date);
          if (financeFactsService && Array.isArray(financeRows) && financeRows.length) {
            financeFactsService.saveFinanceRows(financeRows, {
              dateFrom: date,
              dateTo: date,
              savedAt: new Date().toISOString(),
              source: "backfill"
            });
          }
        }

        const dailyInput = await buildDailyInputRow(date);

        await sheetsService.updateMappedRowByDate("daily_input", date, dailyInput.row, {
          headers: DAILY_INPUT_HEADERS,
          dateColumn: "Дата",
          writeColumns: DAILY_INPUT_WRITE_COLUMNS
        });

        daysUpdated += 1;
      } catch (error) {
        failures.push({
          date,
          reason: error.message
        });
      }
    }

    return {
      daysProcessed: dates.length,
      daysUpdated,
      daysFailed: failures.length,
      failures
    };
  }

  async function buildDailyInputDebug(dateInput) {
    const date = resolveDateInput(dateInput);
    const dailyInput = await buildDailyInputRow(date);
    
    const rawFinance = financeFactsService ? financeFactsService.getFinanceRowsForDateRange(date, date) : [];
    const rawSales = salesFactsService ? salesFactsService.getSalesRowsForDateRange(date, date) : [];
    
    const salesMerged = cogsService ? cogsService.mergeCogsIntoPerformanceRows(rawSales) : { rows: rawSales };
    const salesRows = salesMerged.rows.map(row => {
      if (row.cogsConfigured || !cogsService) {
        return row;
      }
      const cogsEntry = getCogsEntryForRow(cogsService, row);
      if (!cogsEntry) {
        return row;
      }
      return {
        ...row,
        cogs: toNumber(cogsEntry.cogs),
        logisticsToMp: toNumber(cogsEntry.logisticsToMp),
        cogsConfigured: true
      };
    });
    
    const cogsTotal = round2(salesRows.reduce((sum, row) => sum + toNumber(row.cogs) * toNumber(row.quantity), 0));
    
    return {
      date,
      rawFinance,
      salesFactsAggregate: {
        totalRevenue: round2(salesRows.reduce((sum, row) => sum + toNumber(row.revenue), 0)),
        totalQuantity: salesRows.reduce((sum, row) => sum + toNumber(row.quantity), 0),
        rowsCount: salesRows.length
      },
      cogsTotal,
      finalPayload: dailyInput.row,
      writeColumns: DAILY_INPUT_WRITE_COLUMNS
    };
  }

  return {
    backfillDailyInput,
    buildDailyInputDebug,
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
  DAILY_INPUT_WRITE_COLUMNS,
  MAX_BACKFILL_DAYS,
  getSettingsDefaults,
  MANAGEMENT_TEMPLATE_ONLY_MESSAGE
};
