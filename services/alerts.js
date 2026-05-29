const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactProduct(product) {
  return {
    name: product.name ?? "",
    sku: product.sku ?? product.offerId ?? product.productId ?? "",
    stock: toNumber(product.stock),
    price: toNumber(product.price),
    offerId: product.offerId ?? "",
    productId: product.productId ?? ""
  };
}

function signatureForAlerts(alerts) {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(alerts))
    .digest("hex");
}

async function loadPerformanceAlertStats(performanceService, logger = console) {
  if (!performanceService || typeof performanceService.isConfigured !== "function" || !performanceService.isConfigured()) {
    return [];
  }

  if (typeof performanceService.getCampaignStats === "function") {
    try {
      return await performanceService.getCampaignStats();
    } catch {
      return [];
    }
  }

  if (logger && typeof logger.warn === "function") {
    logger.warn("[alerts] performanceService.getCampaignStats is unavailable, skipping performance alerts");
  } else if (logger && typeof logger.log === "function") {
    logger.log("[alerts] performanceService.getCampaignStats is unavailable, skipping performance alerts");
  }

  return [];
}

function createAlertsService({
  intervalMs = 60 * 60 * 1000,
  jobsService,
  lowStockThreshold = 5,
  logFile,
  onAlert = async () => {},
  performanceService,
  productsLimit = 100,
  stateFile,
  logger = console,
  ozonService
}) {
  let notifier = onAlert;
  let timer = null;
  let running = false;

  function writeLog(level, message, extra = {}) {
    ensureParentDir(logFile);
    fs.appendFileSync(
      logFile,
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        message,
        ...extra
      }) + "\n",
      "utf8"
    );

    const method = level === "error" ? "error" : "log";
    logger[method]("[alerts] " + message);
  }

  function loadState() {
    ensureParentDir(stateFile);
    if (!fs.existsSync(stateFile)) {
      return { lastSignature: null, lastSentAt: null };
    }

    try {
      return JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      return { lastSignature: null, lastSentAt: null };
    }
  }

  function saveState(nextState) {
    ensureParentDir(stateFile);
    fs.writeFileSync(stateFile, JSON.stringify(nextState, null, 2), "utf8");
  }

  async function collectAlerts() {
    const [productsRaw, performanceStats] = await Promise.all([
      ozonService.getProducts(productsLimit),
      loadPerformanceAlertStats(performanceService, logger)
    ]);

    const products = productsRaw.map(compactProduct);
    const alerts = [];

    const lowStock = products
      .filter(product => product.stock !== null && product.stock > 0 && product.stock <= lowStockThreshold)
      .slice(0, 10);
    if (lowStock.length) {
      alerts.push({
        type: "low_stock",
        severity: "high",
        message: "Товары с низким остатком",
        items: lowStock
      });
    }

    const missingStock = products
      .filter(product => product.stock === null)
      .slice(0, 10);
    if (missingStock.length) {
      alerts.push({
        type: "missing_stock",
        severity: "medium",
        message: "Товары без данных по остаткам",
        items: missingStock
      });
    }

    const missingSku = products
      .filter(product => !product.sku || !product.offerId)
      .slice(0, 10);
    if (missingSku.length) {
      alerts.push({
        type: "missing_sku_offer",
        severity: "medium",
        message: "Товары без SKU или offer_id",
        items: missingSku
      });
    }

    const promotionCandidates = products
      .filter(product => product.price !== null && product.stock !== null && product.stock > 10)
      .sort((left, right) => (right.price ?? 0) - (left.price ?? 0))
      .slice(0, 10);
    if (promotionCandidates.length) {
      alerts.push({
        type: "promotion_candidates",
        severity: "low",
        message: "Товары, подходящие для продвижения",
        items: promotionCandidates
      });
    }

    const manualReview = products
      .filter(product => product.price === null || product.stock === null || product.stock === 0)
      .slice(0, 10);
    if (manualReview.length) {
      alerts.push({
        type: "manual_review",
        severity: "medium",
        message: "Товары, требующие ручной проверки",
        items: manualReview
      });
    }

    if (performanceStats.length) {
      const expensive = performanceStats
        .filter(row => toNumber(row.spend) !== null && toNumber(row.spend) > 3000)
        .slice(0, 10);
      if (expensive.length) {
        alerts.push({
          type: "expensive_campaigns",
          severity: "medium",
          message: "Дорогие рекламные кампании",
          items: expensive
        });
      }

      const noOrders = performanceStats
        .filter(row => (toNumber(row.spend) ?? 0) > 0 && (toNumber(row.orders) ?? 0) === 0)
        .slice(0, 10);
      if (noOrders.length) {
        alerts.push({
          type: "spend_without_orders",
          severity: "high",
          message: "Кампании с расходом без заказов",
          items: noOrders
        });
      }
    }

    return alerts;
  }

  function formatAlerts(alerts) {
    if (!alerts.length) {
      return "Сильных проблем не найдено.";
    }

    const lines = ["Важные алерты:"];

    for (const alert of alerts) {
      lines.push("");
      lines.push(alert.message + " [" + alert.severity + "]");
      for (const item of alert.items.slice(0, 5)) {
        const label =
          item.name ||
          item.campaignName ||
          item.campaignId ||
          item.sku ||
          "item";
        lines.push("- " + label);
      }
    }

    return lines.join("\n");
  }

  async function runChecks() {
    try {
      const alerts = await collectAlerts();
      const significantAlerts = alerts.filter(alert => alert.severity !== "low");
      const state = loadState();
      const signature = signatureForAlerts(significantAlerts);
      const isDuplicate = signature === state.lastSignature;

      writeLog("info", "Alerts check finished", {
        alerts: alerts.length,
        significantAlerts: significantAlerts.length
      });

      if (significantAlerts.length && !isDuplicate) {
        const message = formatAlerts(significantAlerts);
        await notifier(message);
        saveState({
          lastSignature: signature,
          lastSentAt: new Date().toISOString()
        });
        writeLog("info", "Alert message sent", { significantAlerts: significantAlerts.length });
      }

      return {
        alerts,
        significantAlerts,
        duplicate: isDuplicate
      };
    } catch (error) {
      console.error(error.stack || error);
      writeLog("error", "Alerts run failed with exception", { error: error.message });
      return {
        alerts: [],
        significantAlerts: [],
        duplicate: false,
        error: error.message
      };
    }
  }

  function start() {
    if (running) return;

    running = true;
    timer = setInterval(() => {
      runChecks().catch(error => {
        writeLog("error", "Alerts run failed", { error: error.message });
      });
    }, intervalMs);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    writeLog("info", "Alerts scheduler started", { intervalMs });
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    running = false;
    writeLog("info", "Alerts scheduler stopped");
  }

  function getStatus() {
    const state = loadState();

    return {
      running,
      intervalMs,
      lowStockThreshold,
      lastSignature: state.lastSignature,
      lastSentAt: state.lastSentAt,
      logFile,
      stateFile
    };
  }

  function formatStatus() {
    const status = getStatus();
    return [
      "Alerts: " + (status.running ? "running" : "stopped"),
      "Interval: " + status.intervalMs,
      "Low stock threshold: " + status.lowStockThreshold,
      "Last sent: " + (status.lastSentAt || "-"),
      "Log: " + status.logFile,
      "State: " + status.stateFile
    ].join("\n");
  }

  function formatSettings() {
    const status = getStatus();
    return [
      "Alerts settings:",
      "intervalMs=" + status.intervalMs,
      "lowStockThreshold=" + status.lowStockThreshold
    ].join("\n");
  }

  return {
    formatSettings,
    formatStatus,
    getStatus,
    runChecks,
    setNotifier: nextNotifier => {
      notifier = typeof nextNotifier === "function" ? nextNotifier : notifier;
    },
    start,
    stop
  };
}

module.exports = {
  createAlertsService
};
