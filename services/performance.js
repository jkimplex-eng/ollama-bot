const fs = require("fs");
const path = require("path");

const MAX_CAMPAIGNS_PER_REQUEST = 10;

function createUnavailableError(message) {
  const error = new Error(message);
  error.code = "PERFORMANCE_UNAVAILABLE";
  return error;
}

function createPendingReportError(uuid, message = "") {
  const error = new Error(message || "Performance report is pending.");
  error.code = "PERFORMANCE_REPORT_PENDING";
  error.uuid = uuid;
  return error;
}

function createActiveLimitError(message = "") {
  const error = new Error(message || "Performance active report limit reached.");
  error.code = "PERFORMANCE_ACTIVE_LIMIT";
  return error;
}

function formatDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value)
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function createRequestGroupId() {
  return "perf-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseSemicolonCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ";" && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(current.trim());
      if (row.some(cell => cell !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current || row.length) {
    row.push(current.trim());
    if (row.some(cell => cell !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeCampaign(item) {
  return {
    campaignId: String(item.id ?? ""),
    campaignName: item.title ?? "",
    status: item.state ?? "",
    advObjectType: item.advObjectType ?? item.adv_object_type ?? "",
    paymentType: item.paymentType ?? "",
    fromDate: item.fromDate ?? "",
    toDate: item.toDate ?? "",
    budget: item.budget ?? "",
    dailyBudget: item.dailyBudget ?? "",
    placement: item.placement ?? ""
  };
}

function extractCampaignMeta(headerText) {
  const text = String(headerText || "");
  const idMatch = text.match(/№\s*(\d+)/);
  const nameMatch = text.match(/;\s*(.+?),\s*период/i);

  return {
    campaignId: idMatch ? idMatch[1] : "",
    campaignName: nameMatch ? nameMatch[1].trim() : ""
  };
}

function getCell(row, indexMap, key) {
  const index = indexMap.get(key);
  if (index === undefined) return "";
  return row[index] ?? "";
}

function normalizeStatsFromCsv(csvText) {
  const rows = parseSemicolonCsv(csvText);
  const result = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const hasHeader = row.includes("sku") || row.includes("SKU");

    if (!hasHeader) {
      continue;
    }

    const meta = extractCampaignMeta((rows[index - 1] || []).join(" "));
    const headers = row.map(cell => cell.trim());
    const indexMap = new Map(headers.map((header, headerIndex) => [header, headerIndex]));
    const dateHeader = headers.find(header => header.includes("Дата"));

    for (let dataIndex = index + 1; dataIndex < rows.length; dataIndex += 1) {
      const dataRow = rows[dataIndex];
      const nextHeader = dataRow.includes("sku") || dataRow.includes("SKU");

      if (nextHeader) {
        index = dataIndex - 1;
        break;
      }

      if (!dataRow.length || !getCell(dataRow, indexMap, "sku")) {
        continue;
      }

      result.push({
        date: dateHeader ? getCell(dataRow, indexMap, dateHeader) : "",
        campaignId: meta.campaignId,
        campaignName: meta.campaignName,
        sku: getCell(dataRow, indexMap, "sku"),
        productName: getCell(dataRow, indexMap, "Название товара"),
        price: toNumber(getCell(dataRow, indexMap, "Цена товара, Р")),
        impressions: toNumber(getCell(dataRow, indexMap, "Показы")),
        clicks: toNumber(getCell(dataRow, indexMap, "Клики")),
        ctr: toNumber(getCell(dataRow, indexMap, "CTR (%)")),
        addToCart: toNumber(getCell(dataRow, indexMap, "В корзину")),
        avgCpc: toNumber(getCell(dataRow, indexMap, "Ср. цена клика, г")),
        avgCpm: toNumber(getCell(dataRow, indexMap, "Ср. цена 1000 показов, Р")),
        spend: toNumber(getCell(dataRow, indexMap, "Расход, Р, с НДС")),
        orders: toNumber(getCell(dataRow, indexMap, "Заказы")),
        revenue: toNumber(getCell(dataRow, indexMap, "Выручка, Р")),
        modelOrders: toNumber(getCell(dataRow, indexMap, "Заказы модели")),
        modelRevenue: toNumber(getCell(dataRow, indexMap, "Выручка с заказов модели, Р")),
        drr:
          toNumber(getCell(dataRow, indexMap, "ДРР, %: Дата добавления")) ??
          toNumber(getCell(dataRow, indexMap, "ДРР, %"))
      });
    }
  }

  if (!result.length) {
    throw new Error("Performance API returned unexpected report shape.");
  }

  return result;
}

function createPerformanceService({
  baseUrl,
  clientId,
  clientSecret,
  queueFile,
  reportsFile,
  sheetsService,
  logger = console
}) {
  let tokenCache = null;

  function isConfigured() {
    return Boolean(clientId && clientSecret);
  }

  function assertConfigured() {
    if (!isConfigured()) {
      throw createUnavailableError(
        "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
      );
    }
  }

  function loadJsonArray(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      return [];
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function saveJsonArray(filePath, items) {
    if (!filePath) return;
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2), "utf8");
  }

  function loadReports() {
    return loadJsonArray(reportsFile);
  }

  function saveReports(records) {
    saveJsonArray(reportsFile, records);
  }

  function upsertReportRecord(record) {
    const reports = loadReports();
    const index = reports.findIndex(item => item.uuid === record.uuid);
    const next = {
      ...record,
      updatedAt: new Date().toISOString()
    };

    if (index >= 0) {
      reports[index] = {
        ...reports[index],
        ...next
      };
    } else {
      reports.push({
        createdAt: new Date().toISOString(),
        ...next
      });
    }

    saveReports(reports);
    return reports.find(item => item.uuid === record.uuid);
  }

  function loadQueue() {
    return loadJsonArray(queueFile);
  }

  function saveQueue(items) {
    saveJsonArray(queueFile, items);
  }

  function resetQueue() {
    saveQueue([]);
    return { ok: true };
  }

  function updateQueueItem(matcher, patch) {
    const queue = loadQueue();
    const index = queue.findIndex(matcher);

    if (index === -1) {
      return null;
    }

    queue[index] = {
      ...queue[index],
      ...patch,
      updatedAt: new Date().toISOString()
    };
    saveQueue(queue);
    return queue[index];
  }

  function listQueue() {
    return loadQueue().sort((left, right) => {
      if (left.requestGroupId === right.requestGroupId) {
        return left.chunkIndex - right.chunkIndex;
      }

      return String(left.createdAt).localeCompare(String(right.createdAt));
    });
  }

  function getCurrentPendingQueueItem() {
    return listQueue().find(item => item.status === "pending") || null;
  }

  function getNextQueuedItem() {
    return listQueue().find(item => item.status === "queued") || null;
  }

  async function safeJson(response, fallback = {}) {
    try {
      return await response.json();
    } catch {
      return fallback;
    }
  }

  async function getPerformanceToken() {
    assertConfigured();

    if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
      return tokenCache.accessToken;
    }

    const response = await fetch(baseUrl + "/api/client/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials"
      })
    });

    const data = await safeJson(response);

    if (!response.ok || !data.access_token) {
      logger.error("[performance] token request failed", {
        status: response.status
      });
      throw new Error(
        "Не удалось получить токен Performance API. Проверь client id, client secret и доступ к Ozon Performance."
      );
    }

    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + Number(data.expires_in || 1800) * 1000
    };

    return tokenCache.accessToken;
  }

  async function requestJson(endpoint, options = {}) {
    assertConfigured();
    const token = await getPerformanceToken();
    const method = options.method || "GET";
    const url = new URL(baseUrl + endpoint);

    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": "Bearer " + token
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await safeJson(response);

    if (!response.ok) {
      const message =
        data.message ||
        data.error_description ||
        data.error ||
        "Performance API returned " + response.status;

      if (String(message).toLowerCase().includes("максимум 1")) {
        throw createActiveLimitError(message);
      }

      throw new Error(message);
    }

    return data;
  }

  async function requestReportDownload(uuid) {
    const token = await getPerformanceToken();
    const url = new URL(baseUrl + "/api/client/statistics/report");
    url.searchParams.set("UUID", uuid);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "*/*",
        "Authorization": "Bearer " + token
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Performance API report download failed: " + response.status);
    }

    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();

    if (contentType.includes("application/zip")) {
      throw new Error(
        "Performance API returned ZIP report. Current implementation expects CSV report."
      );
    }

    if (!contentType.includes("csv") && !contentType.includes("text/plain")) {
      throw new Error("Performance API returned unexpected report content type: " + contentType);
    }

    return bodyText;
  }

  async function getCampaigns() {
    if (!isConfigured()) return [];

    const data = await requestJson("/api/client/campaign");
    const items = data.list;

    if (!Array.isArray(items)) {
      throw new Error("Performance API returned unexpected campaigns shape.");
    }

    return items.map(normalizeCampaign);
  }

  async function createStatisticsReportRequest({
    campaignIds,
    dateFrom,
    dateTo,
    reportType = "stats",
    requestGroupId = "",
    chunkIndex = 0,
    totalChunks = 1,
    activeOnly = false
  }) {
    if (campaignIds.length > MAX_CAMPAIGNS_PER_REQUEST) {
      throw new Error(
        "Performance statistics request cannot contain more than " +
          MAX_CAMPAIGNS_PER_REQUEST +
          " campaigns."
      );
    }

    const data = await requestJson("/api/client/statistics", {
      method: "POST",
      body: {
        campaigns: campaignIds,
        dateFrom: formatDate(dateFrom),
        dateTo: formatDate(dateTo),
        groupBy: "DATE"
      }
    });

    if (!data.UUID) {
      throw new Error("Performance API did not return UUID for statistics request.");
    }

    const record = upsertReportRecord({
      uuid: data.UUID,
      dateFrom: formatDate(dateFrom),
      dateTo: formatDate(dateTo),
      reportType,
      requestGroupId,
      chunkIndex,
      totalChunks,
      campaignIds,
      activeOnly,
      status: "pending"
    });

    return record;
  }

  async function getStatisticsList(page = 1, pageSize = 100) {
    const data = await requestJson("/api/client/statistics/list", {
      method: "GET",
      query: {
        page,
        pageSize
      }
    });

    if (!Array.isArray(data.items)) {
      throw new Error("Performance API returned unexpected statistics list shape.");
    }

    return data.items;
  }

  async function getReportListItem(uuid) {
    const items = await getStatisticsList(1, 100);
    return items.find(item => item.meta && item.meta.UUID === uuid) || null;
  }

  async function getReportStatus(uuid) {
    const found = await getReportListItem(uuid);

    if (!found) {
      const stored = loadReports().find(item => item.uuid === uuid);
      return {
        uuid,
        ready: false,
        status: stored ? stored.status || "pending" : "pending",
        message: "Отчёт ещё готовится."
      };
    }

    if (found.meta && found.meta.error) {
      upsertReportRecord({
        uuid,
        status: "error",
        error: found.meta.error
      });
      throw new Error("Performance report failed: " + found.meta.error);
    }

    if (found.meta && found.meta.link) {
      upsertReportRecord({
        uuid,
        status: "ready",
        link: found.meta.link
      });
      return {
        uuid,
        ready: true,
        status: "ready",
        item: found
      };
    }

    upsertReportRecord({
      uuid,
      status: "pending"
    });

    return {
      uuid,
      ready: false,
      status: "pending",
      item: found,
      message: "Отчёт ещё готовится."
    };
  }

  async function waitForReport(uuid, attempts = 12, delayMs = 5000) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const status = await getReportStatus(uuid);

      if (status.ready) {
        return status;
      }

      if (attempt < attempts) {
        await delay(delayMs);
      }
    }

    throw createPendingReportError(uuid, "Отчёт ещё готовится.");
  }

  async function resolveReport(uuid) {
    const status = await getReportStatus(uuid);

    if (!status.ready) {
      throw createPendingReportError(uuid, "Отчёт ещё готовится.");
    }

    const csvText = await requestReportDownload(uuid);
    const rows = normalizeStatsFromCsv(csvText);
    upsertReportRecord({
      uuid,
      status: "downloaded",
      rowsCount: rows.length,
      rows
    });

    return {
      uuid,
      rows,
      csvText
    };
  }

  function buildQueueItems({ dateFrom, dateTo, activeOnly, toSheet, campaigns }) {
    const requestGroupId = createRequestGroupId();
    const campaignChunks = chunkArray(
      campaigns.map(item => item.campaignId),
      MAX_CAMPAIGNS_PER_REQUEST
    );

    return {
      requestGroupId,
      campaignsCount: campaigns.length,
      totalChunks: campaignChunks.length,
      items: campaignChunks.map((campaignIds, index) => ({
        requestGroupId,
        chunkIndex: index + 1,
        totalChunks: campaignChunks.length,
        campaignIds,
        dateFrom: formatDate(dateFrom),
        dateTo: formatDate(dateTo),
        activeOnly,
        toSheet: Boolean(toSheet),
        status: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))
    };
  }

  async function startQueueItem(item) {
    try {
      const report = await createStatisticsReportRequest({
        campaignIds: item.campaignIds,
        dateFrom: item.dateFrom,
        dateTo: item.dateTo,
        reportType: "stats",
        requestGroupId: item.requestGroupId,
        chunkIndex: item.chunkIndex,
        totalChunks: item.totalChunks,
        activeOnly: item.activeOnly
      });

      return updateQueueItem(
        queueItem =>
          queueItem.requestGroupId === item.requestGroupId &&
          queueItem.chunkIndex === item.chunkIndex,
        {
          status: "pending",
          uuid: report.uuid
        }
      );
    } catch (error) {
      if (error.code === "PERFORMANCE_ACTIVE_LIMIT") {
        return updateQueueItem(
          queueItem =>
            queueItem.requestGroupId === item.requestGroupId &&
            queueItem.chunkIndex === item.chunkIndex,
          {
            status: "queued"
          }
        );
      }

      throw error;
    }
  }

  async function createStatsQueue({ dateFrom, dateTo, activeOnly = false, toSheet = false }) {
    if (!isConfigured()) return null;

    const allCampaigns = await getCampaigns();
    const filteredCampaigns = activeOnly
      ? allCampaigns.filter(item => String(item.status || "").toLowerCase().includes("active"))
      : allCampaigns;
    const queueGroup = buildQueueItems({
      dateFrom,
      dateTo,
      activeOnly,
      toSheet,
      campaigns: filteredCampaigns
    });

    const existingQueue = loadQueue();
    saveQueue([...existingQueue, ...queueGroup.items]);

    let firstItem = queueGroup.items[0] || null;
    const hasPending = existingQueue.some(item => item.status === "pending");
    let startedFirst = false;

    if (firstItem && !hasPending) {
      firstItem = await startQueueItem(firstItem);
      startedFirst = firstItem && firstItem.status === "pending";
    }

    return {
      requestGroupId: queueGroup.requestGroupId,
      campaignsCount: filteredCampaigns.length,
      totalCampaigns: allCampaigns.length,
      activeOnly,
      totalChunks: queueGroup.totalChunks,
      startedFirst,
      hasPendingBefore: hasPending,
      firstItem,
      queuedItems: listQueue().filter(item => item.requestGroupId === queueGroup.requestGroupId)
    };
  }

  async function continueQueue() {
    let current = getCurrentPendingQueueItem();

    if (!current) {
      const next = getNextQueuedItem();

      if (!next) {
        return {
          state: "empty"
        };
      }

      const started = await startQueueItem(next);

      if (started.status !== "pending") {
        return {
          state: "blocked"
        };
      }

      return {
        state: "started",
        current: started
      };
    }

    const status = await getReportStatus(current.uuid);

    if (!status.ready) {
      return {
        state: "pending",
        current
      };
    }

    const resolved = await resolveReport(current.uuid);
    current = updateQueueItem(
      item => item.requestGroupId === current.requestGroupId && item.chunkIndex === current.chunkIndex,
      {
        status: "ready",
        rowsCount: resolved.rows.length
      }
    );

    const next = listQueue().find(
      item => item.requestGroupId === current.requestGroupId && item.status === "queued"
    ) || getNextQueuedItem();

    if (!next) {
      return {
        state: "completed_chunk",
        completed: current,
        next: null
      };
    }

    const started = await startQueueItem(next);

    if (started.status !== "pending") {
      return {
        state: "active_limit",
        completed: current,
        next: started
      };
    }

    return {
      state: "completed_chunk",
      completed: current,
      next: started
    };
  }

  function getGroupItems(requestGroupId) {
    return listQueue().filter(item => item.requestGroupId === requestGroupId);
  }

  function getReportRows(uuid) {
    const record = loadReports().find(item => item.uuid === uuid);
    return Array.isArray(record?.rows) ? record.rows : [];
  }

  async function exportGroup(requestGroupId) {
    const items = getGroupItems(requestGroupId);

    if (!items.length) {
      throw new Error("Performance queue group not found: " + requestGroupId);
    }

    const missing = items
      .filter(item => item.status !== "ready")
      .map(item => ({
        chunkIndex: item.chunkIndex,
        totalChunks: item.totalChunks,
        uuid: item.uuid || ""
      }));

    if (missing.length) {
      return {
        ok: false,
        missing
      };
    }

    const combinedRows = items.flatMap(item => getReportRows(item.uuid));
    const writeResult = await sheetsService.clearAndWriteMappedRows(
      "performance_stats",
      statsToRows(combinedRows)
    );

    return {
      ok: true,
      rows: combinedRows,
      writeResult
    };
  }

  function campaignsToRows(campaigns) {
    return campaigns.map(campaign => [
      campaign.campaignId,
      campaign.campaignName,
      campaign.status,
      campaign.advObjectType,
      campaign.paymentType,
      campaign.fromDate,
      campaign.toDate,
      campaign.budget,
      campaign.dailyBudget,
      campaign.placement
    ]);
  }

  function statsToRows(stats) {
    return stats.map(row => [
      row.date ?? "",
      row.campaignId ?? "",
      row.campaignName ?? "",
      row.sku ?? "",
      row.productName ?? "",
      row.price ?? "",
      row.impressions ?? "",
      row.clicks ?? "",
      row.ctr ?? "",
      row.addToCart ?? "",
      row.avgCpc ?? "",
      row.avgCpm ?? "",
      row.spend ?? "",
      row.orders ?? "",
      row.revenue ?? "",
      row.modelOrders ?? "",
      row.modelRevenue ?? "",
      row.drr ?? ""
    ]);
  }

  function summarizeStats(rows) {
    const totals = rows.reduce(
      (acc, row) => {
        acc.impressions += row.impressions || 0;
        acc.clicks += row.clicks || 0;
        acc.spend += row.spend || 0;
        acc.orders += row.orders || 0;
        acc.revenue += row.revenue || 0;
        return acc;
      },
      { impressions: 0, clicks: 0, spend: 0, orders: 0, revenue: 0 }
    );

    return {
      rows: rows.length,
      impressions: totals.impressions,
      clicks: totals.clicks,
      spend: Number(totals.spend.toFixed(2)),
      orders: totals.orders,
      revenue: Number(totals.revenue.toFixed(2))
    };
  }

  async function writeCampaignsToMappedSheet() {
    const campaigns = await getCampaigns();
    const result = await sheetsService.clearAndWriteMappedRows(
      "performance_campaigns",
      campaignsToRows(campaigns)
    );

    return {
      campaigns,
      sheetResult: result
    };
  }

  async function debugSummary() {
    if (!isConfigured()) {
      return {
        configured: false,
        message: "Performance API credentials missing."
      };
    }

    const token = await getPerformanceToken();
    const campaigns = await getCampaigns();

    return {
      configured: true,
      tokenCached: Boolean(tokenCache),
      tokenExpiresAt: tokenCache ? new Date(tokenCache.expiresAt).toISOString() : null,
      campaignsCount: campaigns.length,
      sampleCampaigns: campaigns.slice(0, 5),
      queue: listQueue().slice(0, 20),
      authHeaderType: token ? "Bearer" : "missing"
    };
  }

  return {
    campaignsToRows,
    chunkArray,
    continueQueue,
    createStatsQueue,
    debugSummary,
    exportGroup,
    getCampaigns,
    getCurrentPendingQueueItem,
    getPerformanceToken,
    getReportStatus,
    getStatisticsList,
    getGroupItems,
    isConfigured,
    listQueue,
    normalizeStatsFromCsv,
    resetQueue,
    resolveReport,
    statsToRows,
    summarizeStats,
    waitForReport,
    writeCampaignsToMappedSheet
  };
}

module.exports = {
  createActiveLimitError,
  createPendingReportError,
  createPerformanceService,
  normalizeStatsFromCsv,
  parseSemicolonCsv
};
