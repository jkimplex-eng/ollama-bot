const fs = require("fs");
const path = require("path");

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

function buildInsights(metrics) {
  const sales = toNumber(metrics.sales);
  const margin = toNumber(metrics.margin);
  const ads = Math.abs(toNumber(metrics.advertising));
  const commission = Math.abs(toNumber(metrics.ozonCommission));
  const grossProfit = toNumber(metrics.grossProfit);
  const insights = [];

  if (grossProfit > 0 && margin >= 30) {
    insights.push("Что хорошо: ВП положительный, маржа держится на хорошем уровне.");
  } else if (grossProfit > 0) {
    insights.push("Что хорошо: День закрыт в плюс по ВП.");
  } else {
    insights.push("Что хорошо: Базовые данные по дню собраны, можно быстро разобрать отклонения.");
  }

  if (sales > 0 && ads / sales > 0.2) {
    insights.push("Что плохо: Реклама занимает заметную долю от продаж.");
  } else if (commission > 0 && sales > 0 && commission / sales > 0.25) {
    insights.push("Что плохо: Комиссия Ozon съедает существенную часть продаж.");
  } else {
    insights.push("Что плохо: Явных критичных перекосов не видно, но стоит проверить расходы по категориям.");
  }

  if (margin < 20) {
    insights.push("На что обратить внимание: Маржа низкая, проверь цену, комиссию и рекламную нагрузку.");
  } else if (ads > commission) {
    insights.push("На что обратить внимание: Реклама выше комиссии, проверь окупаемость трафика.");
  } else {
    insights.push("На что обратить внимание: Сверь Daily Input с кабинетом и следи за трендом ВП день к дню.");
  }

  return insights;
}

function buildClientSummary({ date, dailyInput, writeResult, errors }) {
  const metrics = dailyInput?.metrics || {};
  const statusByStep = {
    salesFetch: errors.some(item => item.step === "sales fetch") ? "FAIL" : "OK",
    financeFetch: errors.some(item => item.step === "finance fetch") ? "FAIL" : "OK",
    sheetUpdate: writeResult ? "OK" : errors.some(item => item.step === "daily write") ? "FAIL" : "SKIP"
  };
  const lines = [
    "📊 Daily Summary · " + date,
    "",
    "Заказы ₽: " + toNumber(metrics.orderedRevenue),
    "Продажи ₽: " + toNumber(metrics.sales),
    "Комиссия Ozon ₽: " + Math.abs(toNumber(metrics.ozonCommission)),
    "Реклама ₽: " + Math.abs(toNumber(metrics.advertising)),
    "Себестоимость ₽: " + toNumber(metrics.cogsTotal),
    "Доставка до МП ₽: " + Math.abs(toNumber(metrics.logisticsActual)),
    "Услуги партнёров ₽: " + Math.abs(toNumber(metrics.partnerServices)),
    "Услуги FBO ₽: " + Math.abs(toNumber(metrics.fboServices)),
    "ВП ₽: " + toNumber(metrics.grossProfit),
    "Маржа ВП %: " + toNumber(metrics.margin),
    "Статус: " + (metrics.status || "NO DATA"),
    "",
    "sales fetch: " + statusByStep.salesFetch,
    "finance fetch: " + statusByStep.financeFetch,
    "sheet update: " + statusByStep.sheetUpdate
  ];

  if (writeResult) {
    lines.push(
      writeResult.appended
        ? "Добавил новую строку Daily Input"
        : "Обновил Daily Input, строка " + (writeResult.matchedRow || "?")
    );
  }

  lines.push("");
  lines.push(...buildInsights(metrics));

  if (errors.length) {
    lines.push("");
    lines.push("Ошибки:");
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
  salesFactsService,
  telegramService = null,
  auto = {}
}) {
  const autoConfig = {
    enabled: auto.enabled !== false,
    hour: Number(auto.hour ?? 8),
    minute: Number(auto.minute ?? 30),
    chatId: auto.chatId || "",
    timezone: auto.timezone || MOSCOW_TIMEZONE,
    stateFile: auto.stateFile || "",
    logger: auto.logger || console
  };

  function ensureAutoStateFile() {
    if (!autoConfig.stateFile) {
      return;
    }
    const dir = path.dirname(autoConfig.stateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(autoConfig.stateFile)) {
      fs.writeFileSync(autoConfig.stateFile, JSON.stringify({ lastRunDate: "" }, null, 2), "utf8");
    }
  }

  function readAutoState() {
    if (!autoConfig.stateFile) {
      return { lastRunDate: "" };
    }
    ensureAutoStateFile();
    try {
      return JSON.parse(fs.readFileSync(autoConfig.stateFile, "utf8"));
    } catch {
      return { lastRunDate: "" };
    }
  }

  function writeAutoState(state) {
    if (!autoConfig.stateFile) {
      return;
    }
    ensureAutoStateFile();
    fs.writeFileSync(autoConfig.stateFile, JSON.stringify(state, null, 2), "utf8");
  }

  function formatDateInTimezone(date, timezone) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function getYesterdayInTimezone(timezone) {
    const today = new Date(formatDateInTimezone(new Date(), timezone) + "T00:00:00+03:00");
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    return yesterday.toISOString().slice(0, 10);
  }

  function getScheduleSnapshot(now = new Date(), timezone = autoConfig.timezone) {
    const timeParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(now);
    const partMap = Object.fromEntries(timeParts.map(part => [part.type, part.value]));
    return {
      date: formatDateInTimezone(now, timezone),
      hour: Number(partMap.hour || 0),
      minute: Number(partMap.minute || 0)
    };
  }

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
      clientSummaryText: buildClientSummary({
        date,
        dailyInput,
        writeResult,
        errors
      }),
      summaryText: buildDailySyncSummary({
        date,
        dailyInput,
        writeResult,
        errors
      })
    };
  }

  async function buildSummaryForDate(dateInput) {
    const date = resolveDateInput(dateInput);
    const dailyInput = await managementWorkbookService.buildDailyInputRow(date);
    return {
      date,
      dailyInput,
      clientSummaryText: buildClientSummary({
        date,
        dailyInput,
        writeResult: null,
        errors: []
      })
    };
  }

  async function buildDebugForDate(dateInput) {
    const date = resolveDateInput(dateInput);
    const dailyInput = await managementWorkbookService.buildDailyInputRow(date);
    const debug =
      typeof managementWorkbookService.buildDailyInputDebug === "function"
        ? await managementWorkbookService.buildDailyInputDebug(date)
        : {
            date,
            rawFinance: [],
            rawSales: [],
            metrics: dailyInput?.metrics || {}
          };
    return {
      date,
      debug,
      summaryPayload: {
        orderedRevenue: dailyInput.metrics.orderedRevenue,
        sales: dailyInput.metrics.sales,
        ozonCommission: dailyInput.metrics.ozonCommission,
        advertising: dailyInput.metrics.advertising,
        cogsTotal: dailyInput.metrics.cogsTotal,
        logisticsActual: dailyInput.metrics.logisticsActual,
        partnerServices: dailyInput.metrics.partnerServices,
        fboServices: dailyInput.metrics.fboServices,
        grossProfit: dailyInput.metrics.grossProfit,
        margin: dailyInput.metrics.margin,
        status: dailyInput.metrics.status
      },
      clientSummaryText: buildClientSummary({
        date,
        dailyInput,
        writeResult: null,
        errors: []
      })
    };
  }

  function formatDebugResult(result) {
    return [
      "Daily debug " + result.date,
      "",
      "Raw values:",
      JSON.stringify(result.debug, null, 2),
      "",
      "Final summary payload:",
      JSON.stringify(result.summaryPayload, null, 2),
      "",
      result.clientSummaryText
    ].join("\n");
  }

  function startAutoSync() {
    if (!autoConfig.enabled || !telegramService || !autoConfig.chatId) {
      return { started: false };
    }

    let lastTickKey = "";
    const timer = setInterval(async () => {
      const snapshot = getScheduleSnapshot(new Date(), autoConfig.timezone);
      const tickKey = snapshot.date + " " + snapshot.hour + ":" + snapshot.minute;
      if (tickKey === lastTickKey) {
        return;
      }
      lastTickKey = tickKey;

      if (snapshot.hour !== autoConfig.hour || snapshot.minute !== autoConfig.minute) {
        return;
      }

      const targetDate = getYesterdayInTimezone(autoConfig.timezone);
      const state = readAutoState();
      if (state.lastRunDate === targetDate) {
        return;
      }

      try {
        const result = await syncDaily({ dateInput: targetDate, toSheet: true });
        await telegramService.sendText(autoConfig.chatId, result.clientSummaryText);
        writeAutoState({
          lastRunDate: targetDate,
          lastRunAt: new Date().toISOString()
        });
      } catch (error) {
        autoConfig.logger.error("[daily-auto] failed", error.message);
      }
    }, 60 * 1000);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    return {
      started: true,
      stop() {
        clearInterval(timer);
      }
    };
  }

  return {
    buildClientSummary,
    buildDebugForDate,
    buildDailySyncSummary,
    buildSummaryForDate,
    formatDebugResult,
    resolveDateInput,
    startAutoSync,
    getScheduleSnapshot,
    syncDaily
  };
}

module.exports = {
  buildClientSummary,
  buildDailySyncSummary,
  createDailySyncService,
  resolveDateInput
};
