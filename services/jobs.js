const fs = require("fs");
const path = require("path");

const PRODUCT_SHEET = "products";
const STOCKS_SHEET = "stocks";

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function productToSheetRow(product) {
  return [
    product.name ?? "",
    product.sku ?? product.offerId ?? product.productId ?? "",
    product.offerId ?? "",
    product.price ?? "",
    product.stock ?? ""
  ];
}

function stockToSheetRow(product) {
  return [
    product.name ?? "",
    product.sku ?? product.offerId ?? product.productId ?? "",
    product.offerId ?? "",
    product.stock ?? ""
  ];
}

function createJobsService({
  ozonService,
  sheetsService,
  logFile,
  productsIntervalMs = 30 * 60 * 1000,
  stocksIntervalMs = 60 * 60 * 1000,
  retryAttempts = 3,
  retryDelayMs = 5000,
  productLimit = 100,
  stockLimit = 100,
  logger = console
}) {
  const timers = new Map();
  const runningJobs = new Set();
  const state = {
    running: false,
    startedAt: null,
    stoppedAt: null,
    lastRunAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    runs: {
      products: null,
      stocks: null
    }
  };

  function ensureLogFile() {
    const dir = path.dirname(logFile);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(logFile)) {
      fs.writeFileSync(logFile, "", "utf8");
    }
  }

  function writeLog(level, job, message, extra = {}) {
    ensureLogFile();

    const entry = {
      time: new Date().toISOString(),
      level,
      job,
      message,
      ...extra
    };

    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", "utf8");

    const logMethod = level === "error" ? "error" : "log";
    logger[logMethod]("[jobs][" + job + "] " + message);
  }

  async function withRetry(job, action) {
    let lastError;
    const attempts = Math.max(1, Number(retryAttempts || 1));

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        if (attempt > 1) {
          writeLog("info", job, "Retrying job", { attempt, attempts });
        }

        return await action();
      } catch (err) {
        lastError = err;
        writeLog("error", job, "Job attempt failed", {
          attempt,
          attempts,
          error: err.message
        });

        if (attempt < attempts) {
          await delay(Number(retryDelayMs || 0) * attempt);
        }
      }
    }

    throw lastError;
  }

  async function runJob(job, action) {
    if (runningJobs.has(job)) {
      writeLog("info", job, "Skipped because previous run is still active");
      return { job, skipped: true };
    }

    runningJobs.add(job);
    const startedAt = new Date().toISOString();
    state.lastRunAt = startedAt;
    state.runs[job] = {
      status: "running",
      startedAt,
      finishedAt: null,
      rows: 0,
      error: null
    };

    writeLog("info", job, "Job started");

    try {
      const result = await withRetry(job, action);
      const finishedAt = new Date().toISOString();

      state.lastSuccessAt = finishedAt;
      state.runs[job] = {
        status: "success",
        startedAt,
        finishedAt,
        rows: result.rows,
        error: null
      };

      writeLog("info", job, "Job finished", { rows: result.rows });
      return { job, ...result };
    } catch (err) {
      const finishedAt = new Date().toISOString();

      state.lastErrorAt = finishedAt;
      state.lastError = err.message;
      state.runs[job] = {
        status: "error",
        startedAt,
        finishedAt,
        rows: 0,
        error: err.message
      };

      writeLog("error", job, "Job failed", { error: err.message });
      return { job, rows: 0, error: err.message };
    } finally {
      runningJobs.delete(job);
    }
  }

  async function syncProducts() {
    return runJob("products", async () => {
      const products = await ozonService.getProducts(productLimit);
      const rows = products.map(productToSheetRow);

      await sheetsService.clearAndWriteMappedRows(PRODUCT_SHEET, rows);
      return { rows: products.length };
    });
  }

  async function syncStocks() {
    return runJob("stocks", async () => {
      try {
        const stocks = await ozonService.getStocks(stockLimit);
        const rows = stocks.map(stockToSheetRow);

        await sheetsService.clearAndWriteMappedRows(STOCKS_SHEET, rows);
        return { rows: stocks.length };
      } catch (error) {
        console.error(error.stack || error);
        return { rows: 0, error: error.message };
      }
    });
  }

  function scheduleJob(name, intervalMs, action) {
    const timer = setInterval(() => {
      action().catch(err => {
        writeLog("error", name, "Unhandled scheduled job error", { error: err.message });
      });
    }, intervalMs);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    timers.set(name, timer);
  }

  function start() {
    if (state.running) return;

    ensureLogFile();
    state.running = true;
    state.startedAt = new Date().toISOString();
    state.stoppedAt = null;

    scheduleJob("products", productsIntervalMs, syncProducts);
    scheduleJob("stocks", stocksIntervalMs, syncStocks);
    writeLog("info", "scheduler", "Scheduler started", {
      productsIntervalMs,
      stocksIntervalMs
    });
  }

  function stop() {
    for (const timer of timers.values()) {
      clearInterval(timer);
    }

    timers.clear();
    state.running = false;
    state.stoppedAt = new Date().toISOString();
    writeLog("info", "scheduler", "Scheduler stopped");
  }

  async function runAll() {
    const products = await syncProducts();
    const stocks = await syncStocks();

    return { products, stocks };
  }

  function getStatus() {
    return {
      ...state,
      activeJobs: Array.from(runningJobs),
      productsIntervalMs,
      stocksIntervalMs,
      productLimit,
      stockLimit,
      logFile
    };
  }

  function formatStatus() {
    const status = getStatus();
    const products = status.runs.products;
    const stocks = status.runs.stocks;

    return [
      "Jobs: " + (status.running ? "running" : "stopped"),
      "Started: " + (status.startedAt || "-"),
      "Stopped: " + (status.stoppedAt || "-"),
      "Last success: " + (status.lastSuccessAt || "-"),
      "Last error: " + (status.lastError || "-"),
      "Products job: " + (products ? products.status + ", rows: " + products.rows : "-"),
      "Stocks job: " + (stocks ? stocks.status + ", rows: " + stocks.rows : "-"),
      "Log: " + status.logFile
    ].join("\n");
  }

  return {
    formatStatus,
    getStatus,
    runAll,
    start,
    stop,
    syncProducts,
    syncStocks
  };
}

module.exports = {
  PRODUCT_SHEET,
  STOCKS_SHEET,
  createJobsService,
  productToSheetRow,
  stockToSheetRow
};
