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

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const parsed = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildDailySyncSummary({ date, dailyInput, writeResult, errors }) {
  const metrics = dailyInput?.metrics || {};
  const lines = [
    "Daily " + date,
    "Заказы: " + toNumber(metrics.orderedRevenue),
    "Продажи: " + toNumber(metrics.sales),
    "Комиссия: " + Math.abs(toNumber(metrics.ozonCommission)),
    "Реклама: " + Math.abs(toNumber(metrics.advertising)),
    "Себестоимость: " + toNumber(metrics.cogsTotal),
    "Логистика: " + Math.abs(toNumber(metrics.logisticsActual)),
    "Услуги партнёров: " + Math.abs(toNumber(metrics.partnerServices)),
    "Услуги FBO: " + Math.abs(toNumber(metrics.fboServices)),
    "ВП: " + toNumber(metrics.grossProfit),
    "Статус: " + (metrics.status || "NO DATA")
  ];

  if (writeResult) {
    lines.push(
      writeResult.appended
        ? "Добавил новую строку Daily Input"
        : "Обновил Daily Input, строка " + (writeResult.matchedRow || "?")
    );
  }

  if (errors.length) {
    lines.push("");
    lines.push("Partial failures:");
    for (const error of errors) {
      lines.push("- " + error.step + ": " + error.message);
    }
  }

  return lines.join("\n");
}

function createDailySyncService({
  financeFactsService,
  managementWorkbookService,
  ozonService,
  salesFactsService
}) {
  async function fetchSalesForDate(date) {
    const result = await ozonService.getSalesFacts({
      dateFrom: date + "T00:00:00+03:00",
      dateTo: date + "T23:59:59.999+03:00"
    });
    salesFactsService.saveSalesRows(result.rows, {
      dateFrom: date,
      dateTo: date,
      savedAt: new Date().toISOString(),
      source: "daily-sync"
    });
    return result;
  }

  async function fetchFinanceForDate(date) {
    const result = await ozonService.getFinanceFacts({
      dateFrom: date + "T00:00:00+03:00",
      dateTo: date + "T23:59:59.999+03:00"
    });
    financeFactsService.saveFinanceRows(result.rows, {
      dateFrom: date,
      dateTo: date,
      savedAt: new Date().toISOString(),
      source: "daily-sync"
    });
    return result;
  }

  async function syncDaily({ dateInput, toSheet = false }) {
    const date = resolveDateInput(dateInput);
    const errors = [];
    let salesResult = null;
    let financeResult = null;
    let dailyInput = null;
    let writeResult = null;

    try {
      salesResult = await fetchSalesForDate(date);
    } catch (error) {
      errors.push({ step: "sales fetch", message: error.userMessage || error.message });
    }

    try {
      financeResult = await fetchFinanceForDate(date);
    } catch (error) {
      errors.push({ step: "finance fetch", message: error.userMessage || error.message });
    }

    try {
      if (toSheet) {
        const exported = await managementWorkbookService.exportDaily(date);
        dailyInput = exported.dailyInput;
        writeResult = exported.dailyWrite;
      } else {
        dailyInput = await managementWorkbookService.buildDailyInputRow(date);
      }
    } catch (error) {
      errors.push({ step: toSheet ? "daily write" : "daily build", message: error.message });
    }

    return {
      date,
      salesResult,
      financeResult,
      dailyInput,
      writeResult,
      errors,
      summaryText: buildDailySyncSummary({
        date,
        dailyInput,
        writeResult,
        errors
      })
    };
  }

  return {
    buildDailySyncSummary,
    resolveDateInput,
    syncDaily
  };
}

module.exports = {
  buildDailySyncSummary,
  createDailySyncService,
  resolveDateInput
};
